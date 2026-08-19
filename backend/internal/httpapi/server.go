package httpapi

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "image/jpeg"

	tgauth "github.com/eqwertyry121/TL/backend/internal/auth"
	"github.com/eqwertyry121/TL/backend/internal/config"
	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/menumedia"
	"github.com/eqwertyry121/TL/backend/internal/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"golang.org/x/sync/singleflight"
)

type Server struct {
	cfg                config.Config
	store              *store.Store
	logger             *slog.Logger
	now                func() time.Time
	publicCacheMu      sync.Mutex
	runtimeCache       runtimeCacheEntry
	menuCache          map[string]menuCacheEntry
	publicCacheGroup   singleflight.Group
	loadRuntime        func(context.Context) (core.Runtime, int, error)
	loadMenuRevision   func(context.Context, string) (int64, []core.Category, error)
	telegramHTTPClient *http.Client
	publicRateLimiter  *ipRateLimiter
}

type contextKey string

const sessionKey contextKey = "session"
const serverTimingKey contextKey = "server_timing"

const (
	runtimeCacheTTL = 5 * time.Second
	menuCacheTTL    = 30 * time.Second
)

type runtimeCacheEntry struct {
	runtime  core.Runtime
	revision int
	etag     string
	expires  time.Time
}

type menuCacheEntry struct {
	categories []core.Category
	revision   int64
	etag       string
	expires    time.Time
}

type rateLimitPolicy struct {
	name   string
	limit  int
	window time.Duration
}

type rateLimitBucket struct {
	count    int
	resetAt  time.Time
	lastSeen time.Time
}

type ipRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]rateLimitBucket
}

func newIPRateLimiter() *ipRateLimiter {
	return &ipRateLimiter{buckets: map[string]rateLimitBucket{}}
}

func (l *ipRateLimiter) allow(key string, now time.Time, policy rateLimitPolicy) bool {
	if l == nil || policy.limit <= 0 || policy.window <= 0 {
		return true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	bucket := l.buckets[key]
	if bucket.resetAt.IsZero() || now.After(bucket.resetAt) {
		bucket = rateLimitBucket{resetAt: now.Add(policy.window)}
	}
	bucket.count++
	bucket.lastSeen = now
	l.buckets[key] = bucket
	if len(l.buckets) > 4096 {
		for bucketKey, current := range l.buckets {
			if now.Sub(current.lastSeen) > 2*policy.window {
				delete(l.buckets, bucketKey)
			}
		}
		for len(l.buckets) > 4096 {
			var oldestKey string
			var oldestSeen time.Time
			for bucketKey, current := range l.buckets {
				if oldestKey == "" || current.lastSeen.Before(oldestSeen) {
					oldestKey = bucketKey
					oldestSeen = current.lastSeen
				}
			}
			if oldestKey == "" {
				break
			}
			delete(l.buckets, oldestKey)
		}
	}
	return bucket.count <= policy.limit
}

func New(cfg config.Config, st *store.Store, loggers ...*slog.Logger) *Server {
	logger := slog.Default()
	if len(loggers) > 0 && loggers[0] != nil {
		logger = loggers[0]
	}
	server := &Server{cfg: cfg, store: st, logger: logger, now: time.Now, menuCache: map[string]menuCacheEntry{}, publicRateLimiter: newIPRateLimiter()}
	server.loadRuntime = server.runtimePayload
	server.loadMenuRevision = func(ctx context.Context, locale string) (int64, []core.Category, error) {
		return server.store.MenuWithRevision(ctx, locale)
	}
	server.telegramHTTPClient = newTelegramHTTPClient()
	return server
}

func (s *Server) log() *slog.Logger {
	if s.logger != nil {
		return s.logger
	}
	return slog.Default()
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(s.withRequestLog)
	r.Use(withGzip)
	r.Use(s.withSecurityHeaders)
	r.Use(s.withCORS)
	if s.cfg.ServerTimingEnabled {
		r.Use(withServerTiming)
	}
	r.Get("/live", s.live)
	r.Get("/ready", s.ready)
	r.Get("/health", s.ready)
	if s.cfg.MediaDir != "" {
		r.Get("/media/*", s.serveMedia)
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(s.withPublicRateLimit)
		r.Get("/version", s.version)
		r.Get("/runtime", s.runtime)
		r.Get("/menu", s.menu)
		r.Get("/bootstrap/public", s.publicBootstrap)
		r.Post("/bootstrap/client", s.clientBootstrap)
		r.Post("/bootstrap/staff", s.staffBootstrap)
		r.Post("/bootstrap/admin", s.adminBootstrap)
		r.Post("/performance/beacon", s.performanceBeacon)
		r.Post("/auth/telegram", s.telegramAuth)
		r.Post("/dev/session", s.devSession)
		r.Post("/telegram/client/webhook", s.clientTelegramWebhook)

		r.Group(func(r chi.Router) {
			r.Use(s.withSession)
			r.Get("/me", s.me)
			r.Get("/contact", s.contact)
			r.Post("/cash-location/challenges", s.createCashLocationChallenge)
			r.Get("/cash-location/challenges/{id}", s.cashLocationChallenge)
			r.Post("/cash-location/challenges/{id}/telegram-webapp-location", s.verifyCashLocationChallenge)
			r.Post("/orders/calculate", s.calculate)
			r.Post("/orders", s.createOrder)
			r.Get("/orders", s.clientOrders)
			r.Get("/orders/{id}", s.clientOrder)
			r.Post("/orders/{id}/addition/calculate", s.calculateOrderAddition)
			r.Post("/orders/{id}/addition", s.addOrderItems)

			r.Get("/kitchen/orders", s.kitchenOrders)
			r.Post("/kitchen/orders/{id}/ready", s.markReady)
			r.Post("/kitchen/orders/{id}/picked-up", s.markPickupCollected)

			r.Get("/courier/orders", s.courierOrders)
			r.Post("/courier/orders/{id}/eta", s.courierETA)
			r.Post("/courier/orders/{id}/delivered", s.markDelivered)

			r.Get("/admin/orders", s.adminOrders)
			r.Post("/admin/orders/search", s.adminOrdersSearch)
			r.Get("/admin/orders/{id}", s.adminOrder)
			r.Post("/admin/orders/{id}/cancel", s.adminCancelOrder)
			r.Post("/admin/orders/{id}/return-to-new", s.adminReturnOrderToNew)
			r.Put("/admin/orders/{id}/contact", s.adminUpdateOrderContact)
			r.Post("/admin/orders/{id}/resend", s.adminResendOrderNotification)
			r.Post("/admin/orders/{id}/note", s.adminAddOrderNote)
			r.Get("/admin/dashboard", s.adminDashboard)
			r.Get("/admin/menu", s.adminMenu)
			r.Get("/admin/categories", s.adminCategories)
			r.Post("/admin/categories", s.adminCreateCategory)
			r.Put("/admin/categories/{id}", s.adminUpdateCategory)
			r.Post("/admin/categories/{id}/archive", s.adminArchiveCategory)
			r.Post("/admin/categories/{id}/restore", s.adminRestoreCategory)
			r.Delete("/admin/categories/{id}", s.adminDeleteCategory)
			r.Get("/admin/items", s.adminMenuItems)
			r.Post("/admin/items", s.adminCreateMenuItem)
			r.Put("/admin/items/{id}", s.adminUpdateMenuItem)
			r.Post("/admin/items/{id}/archive", s.adminArchiveMenuItem)
			r.Post("/admin/items/{id}/restore", s.adminRestoreMenuItem)
			r.Delete("/admin/items/{id}", s.adminDeleteMenuItem)
			r.Get("/admin/settings", s.adminSettings)
			r.Put("/admin/settings", s.adminUpdateSettings)
			r.Put("/admin/settings/manual-day-off", s.setManualDayOff)
			r.Get("/admin/schedule", s.adminSchedule)
			r.Put("/admin/schedule", s.adminUpdateSchedule)
			r.Get("/admin/staff", s.adminStaff)
			r.Post("/admin/staff", s.adminAddStaff)
			r.Put("/admin/staff/{id}", s.adminUpdateStaff)
			r.Get("/admin/analytics", s.adminAnalytics)
			r.Get("/admin/analytics.csv", s.adminAnalyticsCSV)
			r.Get("/admin/audit", s.adminAudit)
			r.Post("/admin/uploads/menu-photo", s.adminUploadMenuPhoto)
		})
	})
	return r
}

func (s *Server) serveMedia(w http.ResponseWriter, r *http.Request) {
	relativePath := strings.TrimPrefix(r.URL.Path, "/media/")
	if !safeMediaRelativePath(relativePath) {
		http.NotFound(w, r)
		return
	}
	root, err := filepath.Abs(s.cfg.MediaDir)
	if err != nil {
		writeError(w, err)
		return
	}
	target := filepath.Join(root, filepath.FromSlash(relativePath))
	target, err = filepath.Abs(target)
	if err != nil {
		writeError(w, err)
		return
	}
	relToRoot, err := filepath.Rel(root, target)
	if err != nil || relToRoot == ".." || strings.HasPrefix(relToRoot, ".."+string(os.PathSeparator)) || filepath.IsAbs(relToRoot) {
		http.NotFound(w, r)
		return
	}
	info, err := os.Stat(target)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	file, err := os.Open(target)
	if err != nil {
		writeError(w, err)
		return
	}
	defer file.Close()
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("ETag", mediaETag(relativePath, info))
	http.ServeContent(w, r, filepath.Base(target), info.ModTime(), file)
}

func safeMediaRelativePath(relativePath string) bool {
	if relativePath == "" || strings.ContainsRune(relativePath, 0) {
		return false
	}
	for _, part := range strings.Split(relativePath, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

func (s *Server) live(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "tk-delivery"})
}

func (s *Server) version(w http.ResponseWriter, r *http.Request) {
	buildSHA := safeVersionToken(s.cfg.BuildSHA)
	payload := map[string]any{
		"service":      "tk-delivery",
		"build_sha":    buildSHA,
		"api_contract": "global-optimization-v1",
	}
	writeConditionalJSONWithETag(w, r, http.StatusOK, payload, "no-cache", fmt.Sprintf(`W/"version-%s"`, buildSHA))
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "service": "tk-delivery", "database": "unavailable"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "service": "tk-delivery", "database": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "tk-delivery"})
}

func (s *Server) runtime(w http.ResponseWriter, r *http.Request) {
	payload, err := s.cachedRuntimePayload(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSONWithETag(w, r, http.StatusOK, payload.runtime, "no-cache", payload.etag)
}

func (s *Server) runtimePayload(ctx context.Context) (core.Runtime, int, error) {
	started := time.Now()
	settings, err := s.store.Settings(ctx)
	addServerTiming(ctx, "db", time.Since(started))
	if err != nil {
		return core.Runtime{}, 0, err
	}
	now := s.now().UTC()
	accept := core.CanAcceptOrder(now, settings)
	payments := []string{}
	if settings.CashEnabled {
		payments = append(payments, "cash")
	}
	if settings.CardEnabled {
		payments = append(payments, "card")
	}
	if settings.CryptoEnabled {
		payments = append(payments, "crypto")
	}
	if s.fiscalSalesBlocked() {
		accept.OK = false
		accept.Reason = "fiscal_process_pending"
		payments = nil
	}
	return core.Runtime{
		ServerTime:               now,
		Timezone:                 settings.Timezone,
		AcceptingOrders:          accept.OK,
		Reason:                   accept.Reason,
		NextOpening:              accept.NextOpening,
		DayOffBanner:             settings.DayOffBanner,
		FlatDeliveryFeeMinor:     settings.FlatDeliveryFeeMinor,
		Currency:                 settings.Currency,
		EnabledPayments:          payments,
		SupportedLocales:         []string{"ru", "sr", "en"},
		SupportText:              settings.SupportText,
		TermsURL:                 settings.TermsURL,
		CashLocationRequired:     settings.CashLocationRequired,
		CashLocationRadiusMeters: settings.CashLocationRadiusMeters,
	}, settings.Version, nil
}

func (s *Server) menu(w http.ResponseWriter, r *http.Request) {
	payload, err := s.cachedMenuPayload(r.Context(), r.URL.Query().Get("locale"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSONWithETag(w, r, http.StatusOK, map[string]any{
		"categories":    payload.categories,
		"menu_revision": payload.revision,
	}, "public, max-age=0, must-revalidate", payload.etag)
}

func (s *Server) publicBootstrap(w http.ResponseWriter, r *http.Request) {
	locale := r.URL.Query().Get("locale")
	runtime, menu, err := s.publicBootstrapPayload(r.Context(), locale)
	if err != nil {
		writeError(w, err)
		return
	}
	etag := bootstrapETag(locale, runtime.revision, menu.revision, runtime.etag)
	writeConditionalJSONWithETag(w, r, http.StatusOK, map[string]any{
		"runtime":          runtime.runtime,
		"runtime_revision": runtime.revision,
		"categories":       menu.categories,
		"menu_revision":    menu.revision,
	}, "public, max-age=0, must-revalidate", etag)
}

func (s *Server) clientBootstrap(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Locale   string `json:"locale"`
		InitData string `json:"init_data"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	runtime, menu, err := s.publicBootstrapPayload(r.Context(), req.Locale)
	if err != nil {
		writeError(w, err)
		return
	}
	response := map[string]any{
		"runtime":          runtime.runtime,
		"runtime_revision": runtime.revision,
		"categories":       menu.categories,
		"menu_revision":    menu.revision,
		"orders":           []core.OrderSummary{},
		"contact":          core.VerifiedContact{Verified: false},
		"roles":            []core.Role{},
	}
	if strings.TrimSpace(req.InitData) == "" {
		writeJSON(w, http.StatusOK, response)
		return
	}
	session, roles, err := s.telegramSession(r.Context(), core.AudienceClient, core.RoleClient, req.InitData)
	if err != nil {
		writeError(w, err)
		return
	}
	contact, err := s.store.VerifiedContact(r.Context(), session)
	if err != nil {
		writeError(w, err)
		return
	}
	orders, err := s.store.ClientBootstrapOrders(r.Context(), session)
	if err != nil {
		writeError(w, err)
		return
	}
	response["session"] = session
	response["roles"] = roles
	response["contact"] = contact
	response["orders"] = orders
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) staffBootstrap(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Role     core.Role `json:"role"`
		InitData string    `json:"init_data"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	if req.Role != core.RoleKitchen && req.Role != core.RoleCourier {
		writeError(w, core.ErrInvalidRole)
		return
	}
	session, roles, err := s.bootstrapStaffSession(r.Context(), req.Role, req.InitData)
	if err != nil {
		writeError(w, err)
		return
	}
	var orders []core.Order
	if req.Role == core.RoleKitchen {
		orders, err = s.store.KitchenOrders(r.Context(), session)
	} else {
		orders, err = s.store.CourierOrders(r.Context(), session)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "roles": roles, "orders": orders})
}

func (s *Server) adminBootstrap(w http.ResponseWriter, r *http.Request) {
	var req struct {
		InitData string `json:"init_data"`
		Tab      string `json:"tab"`
		Range    string `json:"range"`
		Status   string `json:"status"`
		Query    string `json:"q"`
		Date     string `json:"date"`
		Limit    int    `json:"limit"`
		Offset   int    `json:"offset"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	session, roles, err := s.bootstrapStaffSession(r.Context(), core.RoleAdmin, req.InitData)
	if err != nil {
		writeError(w, err)
		return
	}
	dashboard, err := s.store.AdminDashboard(r.Context(), session, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	response := map[string]any{"session": session, "roles": roles, "dashboard": dashboard}
	switch req.Tab {
	case "menu":
		categories, items, err := s.store.AdminMenu(r.Context(), session)
		if err != nil {
			writeError(w, err)
			return
		}
		response["menu"] = map[string]any{"categories": categories, "items": items}
	case "orders":
		page, err := s.store.AdminOrders(r.Context(), session, store.AdminOrderFilter{
			Status: req.Status,
			Query:  req.Query,
			Date:   req.Date,
			Limit:  req.Limit,
			Offset: req.Offset,
		})
		if err != nil {
			writeError(w, err)
			return
		}
		response["orders"] = page
	case "settings":
		settings, err := s.store.Settings(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		response["settings"] = settings
	case "schedule":
		schedule, err := s.store.Schedule(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		response["schedule"] = map[string]any{"schedule": schedule}
	case "staff":
		staff, err := s.store.AdminStaff(r.Context(), session)
		if err != nil {
			writeError(w, err)
			return
		}
		response["staff"] = map[string]any{"staff": staff}
	case "analytics":
		if req.Range == "" {
			req.Range = "today"
		}
		from, to, err := s.analyticsPresetRange(req.Range, "", "")
		if err != nil {
			writeError(w, err)
			return
		}
		analytics, err := s.store.AdminAnalytics(r.Context(), session, from, to, s.now())
		if err != nil {
			writeError(w, err)
			return
		}
		response["analytics"] = analytics
	case "audit":
		page, err := s.store.AuditLog(r.Context(), session, store.AuditLogFilter{Limit: req.Limit, Offset: req.Offset})
		if err != nil {
			writeError(w, err)
			return
		}
		response["audit"] = page
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) performanceBeacon(w http.ResponseWriter, r *http.Request) {
	var req struct {
		App    string   `json:"app"`
		Route  string   `json:"route"`
		Build  string   `json:"build"`
		TTFBMS *float64 `json:"ttfb_ms"`
		LCPMS  *float64 `json:"lcp_ms"`
		CLS    *float64 `json:"cls"`
		INPMS  *float64 `json:"inp_ms"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	if !validBeaconApp(req.App) ||
		!validBeaconRoute(req.App, req.Route) ||
		!validBeaconText(req.Build, 80) ||
		!validBeaconMetric(req.TTFBMS, 60000) ||
		!validBeaconMetric(req.LCPMS, 60000) ||
		!validBeaconMetric(req.CLS, 10) ||
		!validBeaconMetric(req.INPMS, 60000) {
		writeError(w, core.ErrInvalidInput)
		return
	}
	s.log().Info("performance beacon",
		"app", req.App,
		"route", req.Route,
		"build", req.Build,
		"ttfb_ms", metricValue(req.TTFBMS),
		"lcp_ms", metricValue(req.LCPMS),
		"cls", metricValue(req.CLS),
		"inp_ms", metricValue(req.INPMS),
	)
	w.WriteHeader(http.StatusNoContent)
}

func validBeaconApp(app string) bool {
	switch app {
	case "client", "kitchen", "courier", "admin":
		return true
	default:
		return false
	}
}

func validBeaconRoute(app string, route string) bool {
	switch app {
	case "client":
		switch route {
		case "menu", "dish", "cart", "checkout", "order", "orders", "support", "terms", "returns", "privacy", "unknown":
			return true
		default:
			return false
		}
	case "kitchen", "courier":
		return route == "orders" || route == "unknown"
	case "admin":
		switch route {
		case "home", "orders", "menu", "schedule", "analytics", "settings", "audit", "staff", "unknown":
			return true
		default:
			return false
		}
	default:
		return false
	}
}

func validBeaconText(value string, maxLength int) bool {
	if value == "" || len(value) > maxLength {
		return false
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			char == '.' || char == '_' || char == '-' || char == '/' {
			continue
		}
		return false
	}
	return true
}

func validBeaconMetric(value *float64, maxValue float64) bool {
	if value == nil {
		return true
	}
	return !math.IsNaN(*value) && !math.IsInf(*value, 0) && *value >= 0 && *value <= maxValue
}

func metricValue(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func (s *Server) publicBootstrapPayload(ctx context.Context, locale string) (runtimeCacheEntry, menuCacheEntry, error) {
	runtime, err := s.cachedRuntimePayload(ctx)
	if err != nil {
		return runtimeCacheEntry{}, menuCacheEntry{}, err
	}
	menu, err := s.cachedMenuPayload(ctx, locale)
	if err != nil {
		return runtimeCacheEntry{}, menuCacheEntry{}, err
	}
	return runtime, menu, nil
}

func (s *Server) cachedRuntimePayload(ctx context.Context) (runtimeCacheEntry, error) {
	now := s.now()
	s.publicCacheMu.Lock()
	if !s.runtimeCache.expires.IsZero() && now.Before(s.runtimeCache.expires) {
		entry := s.runtimeCache
		s.publicCacheMu.Unlock()
		addServerTiming(ctx, "cache", 0)
		return entry, nil
	}
	s.publicCacheMu.Unlock()

	value, err, _ := s.publicCacheGroup.Do("runtime", func() (any, error) {
		loader := s.loadRuntime
		if loader == nil {
			loader = s.runtimePayload
		}
		runtime, revision, err := loader(ctx)
		if err != nil {
			return runtimeCacheEntry{}, err
		}
		entry := runtimeCacheEntry{
			runtime:  runtime,
			revision: revision,
			etag:     runtimeETag(revision, runtime, s.cfg.Timezone),
			expires:  s.now().Add(runtimeCacheTTL),
		}
		s.publicCacheMu.Lock()
		s.runtimeCache = entry
		s.publicCacheMu.Unlock()
		return entry, nil
	})
	if err != nil {
		return runtimeCacheEntry{}, err
	}
	return value.(runtimeCacheEntry), nil
}

func (s *Server) cachedMenuPayload(ctx context.Context, locale string) (menuCacheEntry, error) {
	key := strings.TrimSpace(locale)
	now := s.now()
	s.publicCacheMu.Lock()
	if entry, ok := s.menuCache[key]; ok && now.Before(entry.expires) {
		s.publicCacheMu.Unlock()
		addServerTiming(ctx, "cache", 0)
		return entry, nil
	}
	s.publicCacheMu.Unlock()

	value, err, _ := s.publicCacheGroup.Do("menu:"+key, func() (any, error) {
		started := time.Now()
		loader := s.loadMenuRevision
		if loader == nil {
			loader = func(ctx context.Context, locale string) (int64, []core.Category, error) {
				return s.store.MenuWithRevision(ctx, locale)
			}
		}
		revision, categories, err := loader(ctx, key)
		addServerTiming(ctx, "db", time.Since(started))
		if err != nil {
			return nil, err
		}
		entry := menuCacheEntry{
			categories: categories,
			revision:   revision,
			etag:       menuETag(key, revision),
			expires:    s.now().Add(menuCacheTTL),
		}
		s.publicCacheMu.Lock()
		if s.menuCache == nil {
			s.menuCache = map[string]menuCacheEntry{}
		}
		s.menuCache[key] = entry
		s.publicCacheMu.Unlock()
		return entry, nil
	})
	if err != nil {
		return menuCacheEntry{}, err
	}
	return value.(menuCacheEntry), nil
}

func (s *Server) invalidatePublicCache() {
	s.publicCacheMu.Lock()
	defer s.publicCacheMu.Unlock()
	s.runtimeCache = runtimeCacheEntry{}
	s.menuCache = map[string]menuCacheEntry{}
}

func (s *Server) devSession(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Env == "production" {
		writeError(w, core.ErrForbidden)
		return
	}
	var req struct {
		TelegramUserID int64     `json:"telegram_user_id"`
		Role           core.Role `json:"role"`
		Username       string    `json:"username"`
		FirstName      string    `json:"first_name"`
		PhotoURL       string    `json:"photo_url"`
		LanguageCode   string    `json:"language_code"`
		Phone          string    `json:"phone"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	if req.TelegramUserID == 0 {
		req.TelegramUserID = s.cfg.BootstrapOwnerTelegramID
	}
	if req.Role == "" {
		req.Role = core.RoleClient
	}
	user, err := s.store.UpsertTelegramUser(r.Context(), core.User{
		TelegramUserID: req.TelegramUserID,
		Username:       req.Username,
		FirstName:      req.FirstName,
		PhotoURL:       req.PhotoURL,
		LanguageCode:   req.LanguageCode,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	session, roles, err := s.store.CreateSession(r.Context(), user, req.Role, s.cfg.SessionTTL)
	if err != nil {
		writeError(w, err)
		return
	}
	if req.Role == core.RoleClient && strings.TrimSpace(req.Phone) != "" {
		if err := s.store.VerifyTelegramContact(r.Context(), req.TelegramUserID, req.TelegramUserID, req.Phone); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "roles": roles})
}

func (s *Server) telegramAuth(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Audience core.Audience `json:"audience"`
		Role     core.Role     `json:"role"`
		InitData string        `json:"init_data"`
		Locale   string        `json:"locale,omitempty"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	session, roles, err := s.telegramSession(r.Context(), req.Audience, req.Role, req.InitData)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "roles": roles})
}

func (s *Server) telegramSession(ctx context.Context, audience core.Audience, role core.Role, initData string) (core.Session, []core.Role, error) {
	if role == "" {
		role = core.RoleClient
	}
	if audience == "" {
		audience = core.AudienceClient
	}
	token := s.cfg.ClientBotToken
	if audience == core.AudienceStaff || role != core.RoleClient {
		token = s.cfg.StaffBotToken
		if strings.TrimSpace(token) == "" {
			token = s.cfg.ClientBotToken
		}
	}
	tgUser, err := tgauth.VerifyTelegramInitData(initData, token, s.cfg.InitDataMaxAge, s.now())
	if err != nil {
		return core.Session{}, nil, err
	}
	user, err := s.store.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: tgUser.ID,
		Username:       tgUser.Username,
		FirstName:      tgUser.FirstName,
		PhotoURL:       tgUser.PhotoURL,
		LanguageCode:   tgUser.LanguageCode,
	})
	if err != nil {
		return core.Session{}, nil, err
	}
	return s.store.CreateSession(ctx, user, role, s.cfg.SessionTTL)
}

func (s *Server) bootstrapStaffSession(ctx context.Context, role core.Role, initData string) (core.Session, []core.Role, error) {
	if strings.TrimSpace(initData) != "" || s.cfg.Env == "production" {
		return s.telegramSession(ctx, core.AudienceStaff, role, initData)
	}
	user, err := s.store.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: s.cfg.BootstrapOwnerTelegramID,
		Username:       "owner",
		FirstName:      "Owner",
		LanguageCode:   "ru",
	})
	if err != nil {
		return core.Session{}, nil, err
	}
	return s.store.CreateSession(ctx, user, role, s.cfg.SessionTTL)
}

func (s *Server) isBootstrapOwnerTelegramID(telegramUserID int64) bool {
	if telegramUserID == 0 {
		return false
	}
	for _, ownerID := range s.cfg.BootstrapOwnerTelegramIDs {
		if telegramUserID == ownerID {
			return true
		}
	}
	return telegramUserID == s.cfg.BootstrapOwnerTelegramID
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	sess := mustSession(r)
	roles, err := s.store.StaffRoles(r.Context(), sess.TelegramUserID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": sess, "roles": roles})
}

func (s *Server) calculate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Items           []core.CartItemInput `json:"items"`
		FulfillmentType core.FulfillmentType `json:"fulfillment_type"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	calc, err := s.store.CalculateForFulfillment(r.Context(), mustSession(r), req.Items, req.FulfillmentType, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, calc)
}

func (s *Server) createOrder(w http.ResponseWriter, r *http.Request) {
	if s.fiscalSalesBlocked() {
		writeError(w, core.ErrRestaurantClosed)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024))
	if err != nil {
		writeError(w, err)
		return
	}
	var req store.CreateOrderInput
	if err := json.Unmarshal(raw, &req); err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.CreateCashOrder(r.Context(), mustSession(r), req, r.Header.Get("Idempotency-Key"), bodyHash(raw), s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, order)
}

func (s *Server) fiscalSalesBlocked() bool {
	return s.cfg.Env == "production" && !s.cfg.FiscalProcessAccepted
}

func (s *Server) clientOrders(w http.ResponseWriter, r *http.Request) {
	limit, err := parsePositiveIntQuery(r, "limit", 20, 1, 50)
	if err != nil {
		writeError(w, err)
		return
	}
	offset, err := parsePositiveIntQuery(r, "offset", 0, 0, 10000)
	if err != nil {
		writeError(w, err)
		return
	}
	page, err := s.store.ClientOrders(r.Context(), mustSession(r), store.ClientOrderFilter{Limit: limit, Offset: offset})
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSON(w, r, http.StatusOK, page, "private, no-cache, no-store")
}

func (s *Server) clientOrder(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.ClientOrderByID(r.Context(), mustSession(r), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) calculateOrderAddition(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Items []core.CartItemInput `json:"items"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	calc, err := s.store.CalculateAddition(r.Context(), mustSession(r), id, req.Items, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, calc)
}

func (s *Server) addOrderItems(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024))
	if err != nil {
		writeError(w, err)
		return
	}
	var req store.AddOrderItemsInput
	if err := json.Unmarshal(raw, &req); err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.AddOrderItems(r.Context(), mustSession(r), id, req, r.Header.Get("Idempotency-Key"), bodyHash(raw), s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) kitchenOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.store.KitchenOrders(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSON(w, r, http.StatusOK, map[string]any{"orders": orders}, "private, no-cache, no-store")
}

func (s *Server) courierOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.store.CourierOrders(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSON(w, r, http.StatusOK, map[string]any{"orders": orders}, "private, no-cache, no-store")
}

func (s *Server) courierETA(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Minutes int `json:"minutes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	if err := s.store.SendCourierETA(r.Context(), mustSession(r), id, req.Minutes); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) adminOrders(w http.ResponseWriter, r *http.Request) {
	limit, err := parsePositiveIntQuery(r, "limit", 20, 1, 50)
	if err != nil {
		writeError(w, err)
		return
	}
	offset, err := parsePositiveIntQuery(r, "offset", 0, 0, 10000)
	if err != nil {
		writeError(w, err)
		return
	}
	page, err := s.store.AdminOrders(r.Context(), mustSession(r), store.AdminOrderFilter{
		Status: r.URL.Query().Get("status"),
		Query:  r.URL.Query().Get("q"),
		Date:   r.URL.Query().Get("date"),
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeConditionalJSON(w, r, http.StatusOK, page, "private, no-cache, no-store")
}

func (s *Server) adminOrdersSearch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Status string `json:"status"`
		Query  string `json:"q"`
		Date   string `json:"date"`
		Limit  int    `json:"limit"`
		Offset int    `json:"offset"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	page, err := s.store.AdminOrders(r.Context(), mustSession(r), store.AdminOrderFilter{
		Status: req.Status,
		Query:  req.Query,
		Date:   req.Date,
		Limit:  req.Limit,
		Offset: req.Offset,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) adminOrder(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.AdminOrderByID(r.Context(), mustSession(r), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) adminCancelOrder(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.CancelOrder(r.Context(), mustSession(r), id, req.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) adminReturnOrderToNew(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.ReturnOrderToNew(r.Context(), mustSession(r), id, req.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) adminUpdateOrderContact(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Phone   string `json:"phone"`
		Address string `json:"address"`
		Reason  string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.UpdateOrderContact(r.Context(), mustSession(r), id, req.Phone, req.Address, req.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) adminResendOrderNotification(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Recipient string `json:"recipient"`
		Reason    string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	if err := s.store.ResendOrderNotification(r.Context(), mustSession(r), id, req.Recipient, req.Reason); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) adminAddOrderNote(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	if err := s.store.AddOrderNote(r.Context(), mustSession(r), id, req.Reason); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) adminDashboard(w http.ResponseWriter, r *http.Request) {
	dashboard, err := s.store.AdminDashboard(r.Context(), mustSession(r), s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, dashboard)
}

func (s *Server) adminMenu(w http.ResponseWriter, r *http.Request) {
	categories, items, err := s.store.AdminMenu(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": categories, "items": items})
}

func (s *Server) adminCategories(w http.ResponseWriter, r *http.Request) {
	categories, err := s.store.AdminCategories(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": categories})
}

func (s *Server) adminCreateCategory(w http.ResponseWriter, r *http.Request) {
	var req store.UpsertCategoryInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	category, err := s.store.CreateCategory(r.Context(), mustSession(r), req)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusCreated, category)
}

func (s *Server) adminUpdateCategory(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req store.UpsertCategoryInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	category, err := s.store.UpdateCategory(r.Context(), mustSession(r), id, req)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, category)
}

func (s *Server) adminArchiveCategory(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	category, err := s.store.ArchiveCategory(r.Context(), mustSession(r), id, req.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, category)
}

func (s *Server) adminRestoreCategory(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	category, err := s.store.RestoreCategory(r.Context(), mustSession(r), id, req.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, category)
}

func (s *Server) adminDeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	reason, err := decodeReasonBodyOrQuery(r)
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.store.DeleteOrArchiveCategory(r.Context(), mustSession(r), id, reason)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) adminMenuItems(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.AdminMenuItems(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) adminCreateMenuItem(w http.ResponseWriter, r *http.Request) {
	var req store.UpsertMenuItemInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	item, err := s.store.CreateMenuItem(r.Context(), mustSession(r), req)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) adminUpdateMenuItem(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req store.UpsertMenuItemInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	item, err := s.store.UpdateMenuItem(r.Context(), mustSession(r), id, req)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) adminArchiveMenuItem(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	item, err := s.store.ArchiveMenuItem(r.Context(), mustSession(r), id, req.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) adminRestoreMenuItem(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	item, err := s.store.RestoreMenuItem(r.Context(), mustSession(r), id, req.Reason)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) adminDeleteMenuItem(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	reason, err := decodeReasonBodyOrQuery(r)
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.store.DeleteOrArchiveMenuItem(r.Context(), mustSession(r), id, reason)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) markReady(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024))
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		ExpectedVersion int `json:"expected_version"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		writeError(w, err)
		return
	}
	if req.ExpectedVersion <= 0 {
		writeError(w, core.ErrInvalidInput)
		return
	}
	order, err := s.store.MarkReady(r.Context(), mustSession(r), id, r.Header.Get("Idempotency-Key"), bodyHash(raw), req.ExpectedVersion)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) markPickupCollected(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024))
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		ExpectedVersion int `json:"expected_version"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		writeError(w, err)
		return
	}
	if req.ExpectedVersion <= 0 {
		writeError(w, core.ErrInvalidInput)
		return
	}
	order, err := s.store.MarkPickupCollected(r.Context(), mustSession(r), id, r.Header.Get("Idempotency-Key"), bodyHash(raw), req.ExpectedVersion)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) markDelivered(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024))
	if err != nil {
		writeError(w, err)
		return
	}
	var req struct {
		ExpectedVersion int `json:"expected_version"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		writeError(w, err)
		return
	}
	if req.ExpectedVersion <= 0 {
		writeError(w, core.ErrInvalidInput)
		return
	}
	order, err := s.store.MarkDelivered(r.Context(), mustSession(r), id, r.Header.Get("Idempotency-Key"), bodyHash(raw), req.ExpectedVersion)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, order)
}

func (s *Server) adminSettings(w http.ResponseWriter, r *http.Request) {
	if mustSession(r).ActiveRole != core.RoleAdmin {
		writeError(w, core.ErrForbidden)
		return
	}
	settings, err := s.store.Settings(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) adminUpdateSettings(w http.ResponseWriter, r *http.Request) {
	var req store.UpdateSettingsInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	settings, err := s.store.UpdateSettings(r.Context(), mustSession(r), req)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) setManualDayOff(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	settings, err := s.store.SetManualDayOff(r.Context(), mustSession(r), req.Enabled)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, settings)
}

func (s *Server) adminSchedule(w http.ResponseWriter, r *http.Request) {
	if mustSession(r).ActiveRole != core.RoleAdmin {
		writeError(w, core.ErrForbidden)
		return
	}
	days, err := s.store.Schedule(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"schedule": days})
}

func (s *Server) adminUpdateSchedule(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Schedule []core.ScheduleDay `json:"schedule"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	days, err := s.store.UpdateSchedule(r.Context(), mustSession(r), req.Schedule)
	if err != nil {
		writeError(w, err)
		return
	}
	s.invalidatePublicCache()
	writeJSON(w, http.StatusOK, map[string]any{"schedule": days})
}

func (s *Server) adminStaff(w http.ResponseWriter, r *http.Request) {
	staff, err := s.store.AdminStaff(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"staff": staff})
}

func (s *Server) adminAddStaff(w http.ResponseWriter, r *http.Request) {
	var req store.AddStaffInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	member, err := s.store.AddStaff(r.Context(), mustSession(r), req)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, member)
}

func (s *Server) adminUpdateStaff(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	var req store.UpdateStaffInput
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	member, err := s.store.UpdateStaff(r.Context(), mustSession(r), id, req)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, member)
}

func (s *Server) adminAnalytics(w http.ResponseWriter, r *http.Request) {
	from, to, err := s.analyticsRange(r)
	if err != nil {
		writeError(w, err)
		return
	}
	analytics, err := s.store.AdminAnalytics(r.Context(), mustSession(r), from, to, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, analytics)
}

func (s *Server) adminAnalyticsCSV(w http.ResponseWriter, r *http.Request) {
	from, to, err := s.analyticsRange(r)
	if err != nil {
		writeError(w, err)
		return
	}
	analytics, err := s.store.AdminAnalytics(r.Context(), mustSession(r), from, to, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=tk-analytics.csv")
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"day", "orders", "delivered", "cancelled", "revenue_minor"})
	for _, row := range analytics.DailyRows {
		_ = writer.Write([]string{
			row.Day,
			fmt.Sprintf("%d", row.Orders),
			fmt.Sprintf("%d", row.Delivered),
			fmt.Sprintf("%d", row.Cancelled),
			fmt.Sprintf("%d", row.RevenueMinor),
		})
	}
	_ = writer.Write([]string{})
	_ = writer.Write([]string{"payment_method", "orders", "delivered", "paid", "cancelled", "revenue_minor"})
	for _, row := range analytics.Payments {
		_ = writer.Write([]string{
			row.Key,
			fmt.Sprintf("%d", row.Count),
			fmt.Sprintf("%d", row.DeliveredCount),
			fmt.Sprintf("%d", row.PaidCount),
			fmt.Sprintf("%d", row.CancelledCount),
			fmt.Sprintf("%d", row.RevenueMinor),
		})
	}
	writer.Flush()
}

func (s *Server) adminAudit(w http.ResponseWriter, r *http.Request) {
	limit, err := parsePositiveIntQuery(r, "limit", 50, 1, 100)
	if err != nil {
		writeError(w, err)
		return
	}
	offset, err := parsePositiveIntQuery(r, "offset", 0, 0, 10000)
	if err != nil {
		writeError(w, err)
		return
	}
	page, err := s.store.AuditLog(r.Context(), mustSession(r), store.AuditLogFilter{Limit: limit, Offset: offset})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) adminUploadMenuPhoto(w http.ResponseWriter, r *http.Request) {
	if mustSession(r).ActiveRole != core.RoleAdmin {
		writeError(w, core.ErrForbidden)
		return
	}
	if s.cfg.MediaDir == "" {
		writeError(w, core.ErrInvalidInput)
		return
	}
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		writeError(w, core.ErrInvalidInput)
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, core.ErrInvalidInput)
		return
	}
	defer file.Close()
	if header.Size > menumedia.MaxInputBytes {
		writeError(w, core.ErrInvalidInput)
		return
	}
	img, err := menumedia.DecodeLimited(file)
	if err != nil {
		writeError(w, core.ErrInvalidInput)
		return
	}
	mediaSubdir := filepath.Join(s.cfg.MediaDir, "menu")
	if err := os.MkdirAll(mediaSubdir, 0o755); err != nil {
		writeError(w, err)
		return
	}
	id := uuid.NewString()
	filename := id + ".jpg"
	thumbFilename := id + "_thumb.jpg"
	target := filepath.Join(mediaSubdir, filename)
	thumbTarget := filepath.Join(mediaSubdir, thumbFilename)
	displayImage := menumedia.Resize(img, menumedia.DisplayMaxSide)
	thumbnailImage := menumedia.Resize(img, menumedia.ThumbnailMaxSide)
	displayWidth, displayHeight := menumedia.Dimensions(displayImage)
	thumbnailWidth, thumbnailHeight := menumedia.Dimensions(thumbnailImage)
	if err := menumedia.WriteJPEG(target, displayImage, menumedia.DisplayQuality); err != nil {
		writeError(w, err)
		return
	}
	if err := menumedia.WriteJPEG(thumbTarget, thumbnailImage, menumedia.ThumbnailQuality); err != nil {
		_ = os.Remove(target)
		writeError(w, err)
		return
	}
	displayInfo, err := os.Stat(target)
	if err != nil {
		_ = os.Remove(target)
		_ = os.Remove(thumbTarget)
		writeError(w, err)
		return
	}
	thumbnailInfo, err := os.Stat(thumbTarget)
	if err != nil {
		_ = os.Remove(target)
		_ = os.Remove(thumbTarget)
		writeError(w, err)
		return
	}
	photoPath := "/media/menu/" + filename
	thumbnailPath := "/media/menu/" + thumbFilename
	if err := s.store.RecordMenuMedia(r.Context(), store.MenuMediaInput{
		DisplayPath:     photoPath,
		ThumbnailPath:   thumbnailPath,
		DisplayWidth:    displayWidth,
		DisplayHeight:   displayHeight,
		DisplayBytes:    int(displayInfo.Size()),
		ThumbnailWidth:  thumbnailWidth,
		ThumbnailHeight: thumbnailHeight,
		ThumbnailBytes:  int(thumbnailInfo.Size()),
	}); err != nil {
		_ = os.Remove(target)
		_ = os.Remove(thumbTarget)
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"photo_path": photoPath,
		"photo_variants": core.PhotoVariants{
			Thumbnail: core.PhotoVariant{URL: thumbnailPath, Width: thumbnailWidth, Height: thumbnailHeight},
			Display:   core.PhotoVariant{URL: photoPath, Width: displayWidth, Height: displayHeight},
		},
	})
}

func (s *Server) withSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if strings.TrimSpace(token) == "" {
			writeError(w, core.ErrForbidden)
			return
		}
		sess, err := s.store.SessionByToken(r.Context(), token)
		if err != nil {
			writeError(w, err)
			return
		}
		ctx := context.WithValue(r.Context(), sessionKey, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) withPublicRateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		policy, ok := publicRateLimitPolicy(r.Method, r.URL.Path)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		key := policy.name + ":" + clientIP(r)
		if !s.publicRateLimiter.allow(key, s.now(), policy) {
			w.Header().Set("Retry-After", strconv.Itoa(int(policy.window.Seconds())))
			writeJSON(w, http.StatusTooManyRequests, map[string]any{
				"error": map[string]any{
					"code":        "RATE_LIMITED",
					"message_key": "rate_limited",
				},
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func publicRateLimitPolicy(method, path string) (rateLimitPolicy, bool) {
	switch {
	case method == http.MethodGet && (path == "/api/v1/bootstrap/public" || path == "/api/v1/menu" || path == "/api/v1/runtime" || path == "/api/v1/version"):
		return rateLimitPolicy{name: "public_read", limit: 240, window: time.Minute}, true
	case method == http.MethodPost && (path == "/api/v1/bootstrap/client" || path == "/api/v1/bootstrap/staff" || path == "/api/v1/bootstrap/admin"):
		return rateLimitPolicy{name: "bootstrap", limit: 120, window: time.Minute}, true
	case method == http.MethodPost && path == "/api/v1/auth/telegram":
		return rateLimitPolicy{name: "auth", limit: 60, window: time.Minute}, true
	case method == http.MethodPost && path == "/api/v1/dev/session":
		return rateLimitPolicy{name: "dev_session", limit: 30, window: time.Minute}, true
	case method == http.MethodPost && path == "/api/v1/telegram/client/webhook":
		return rateLimitPolicy{name: "telegram_webhook", limit: 300, window: time.Minute}, true
	case method == http.MethodPost && path == "/api/v1/performance/beacon":
		return rateLimitPolicy{name: "performance_beacon", limit: 120, window: time.Minute}, true
	default:
		return rateLimitPolicy{}, false
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func (s *Server) withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		duration := time.Since(started)
		routePattern := ""
		if routeCtx := chi.RouteContext(r.Context()); routeCtx != nil {
			routePattern = routeCtx.RoutePattern()
		}
		if routePattern == "" {
			routePattern = r.URL.Path
		}
		attrs := []any{
			"request_id", middleware.GetReqID(r.Context()),
			"method", r.Method,
			"route", routePattern,
			"status", recorder.status,
			"duration_ms", float64(duration.Microseconds()) / 1000,
			"response_bytes", recorder.bytes,
		}
		if duration >= 250*time.Millisecond {
			attrs = append(attrs, "slow", true)
		}
		logger := s.log()
		if recorder.status >= 500 {
			logger.Error("http request", attrs...)
			return
		}
		if recorder.status >= 400 || duration >= 250*time.Millisecond {
			logger.Warn("http request", attrs...)
			return
		}
		logger.Info("http request", attrs...)
	})
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	allowed := make(map[string]bool, len(s.cfg.AllowedOrigins))
	for _, origin := range s.cfg.AllowedOrigins {
		origin = strings.TrimRight(strings.TrimSpace(origin), "/")
		if origin != "" {
			allowed[origin] = true
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
		if origin != "" && allowed[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key,If-None-Match")
			w.Header().Set("Access-Control-Expose-Headers", "ETag,Server-Timing")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if origin != "" && !allowed[origin] {
				writeError(w, core.ErrForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withGzip(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead ||
			r.Method == http.MethodOptions ||
			!strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") ||
			strings.HasPrefix(r.URL.Path, "/media/") ||
			r.Header.Get("Range") != "" {
			next.ServeHTTP(w, r)
			return
		}
		writer := &gzipResponseWriter{ResponseWriter: w, status: http.StatusOK}
		defer writer.Close()
		next.ServeHTTP(writer, r)
	})
}

func withServerTiming(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		collector := &serverTimingCollector{}
		started := time.Now()
		writer := &timingResponseWriter{
			ResponseWriter: w,
			started:        started,
			collector:      collector,
		}
		next.ServeHTTP(writer, r.WithContext(context.WithValue(r.Context(), serverTimingKey, collector)))
		if !writer.wroteHeader {
			writer.WriteHeader(http.StatusOK)
		}
	})
}

type serverTimingCollector struct {
	mu      sync.Mutex
	metrics []string
}

func (c *serverTimingCollector) add(name string, duration time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.metrics = append(c.metrics, fmt.Sprintf("%s;dur=%.1f", name, float64(duration.Microseconds())/1000))
}

func (c *serverTimingCollector) values() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string{}, c.metrics...)
}

type timingResponseWriter struct {
	http.ResponseWriter
	started     time.Time
	collector   *serverTimingCollector
	wroteHeader bool
}

func (w *timingResponseWriter) addServerTiming(name string, duration time.Duration) {
	w.collector.add(name, duration)
}

func (w *timingResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	metrics := w.collector.values()
	metrics = append(metrics, fmt.Sprintf("total;dur=%.1f", float64(time.Since(w.started).Microseconds())/1000))
	w.Header().Set("Server-Timing", strings.Join(metrics, ", "))
	w.ResponseWriter.WriteHeader(status)
}

func (w *timingResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func addServerTiming(ctx context.Context, name string, duration time.Duration) {
	collector, ok := ctx.Value(serverTimingKey).(*serverTimingCollector)
	if !ok || collector == nil {
		return
	}
	collector.add(name, duration)
}

type serverTimingMetricWriter interface {
	addServerTiming(name string, duration time.Duration)
}

func addServerTimingFromWriter(w http.ResponseWriter, name string, duration time.Duration) {
	if metricWriter, ok := w.(serverTimingMetricWriter); ok {
		metricWriter.addServerTiming(name, duration)
	}
}

type gzipResponseWriter struct {
	http.ResponseWriter
	writer      *gzip.Writer
	status      int
	wroteHeader bool
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	if !statusAllowsBody(status) {
		w.wroteHeader = true
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *gzipResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		if statusAllowsBody(w.status) {
			w.startGzip()
		}
		w.wroteHeader = true
		w.ResponseWriter.WriteHeader(w.status)
	}
	if w.writer == nil {
		if statusAllowsBody(w.status) {
			return w.ResponseWriter.Write(data)
		}
		return 0, nil
	}
	return w.writer.Write(data)
}

func (w *gzipResponseWriter) Close() {
	if !w.wroteHeader {
		w.wroteHeader = true
		w.ResponseWriter.WriteHeader(w.status)
		return
	}
	if w.writer != nil {
		_ = w.writer.Close()
	}
}

func (w *gzipResponseWriter) startGzip() {
	writer, err := gzip.NewWriterLevel(w.ResponseWriter, gzip.BestSpeed)
	if err != nil {
		return
	}
	w.writer = writer
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Add("Vary", "Accept-Encoding")
	w.Header().Del("Content-Length")
}

func statusAllowsBody(status int) bool {
	return status != http.StatusNoContent && status != http.StatusNotModified && status >= 200
}

type loggingResponseWriter struct {
	http.ResponseWriter
	status      int
	bytes       int
	wroteHeader bool
}

func (w *loggingResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *loggingResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	n, err := w.ResponseWriter.Write(data)
	w.bytes += n
	return n, err
}

func (s *Server) withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		if s.cfg.Env == "production" {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func mustSession(r *http.Request) core.Session {
	return r.Context().Value(sessionKey).(core.Session)
}

func parseUUIDParam(r *http.Request, name string) (uuid.UUID, error) {
	return uuid.Parse(chi.URLParam(r, name))
}

func parsePositiveIntQuery(r *http.Request, name string, fallback, minValue, maxValue int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minValue || value > maxValue {
		return 0, core.ErrInvalidInput
	}
	return value, nil
}

func (s *Server) analyticsRange(r *http.Request) (time.Time, time.Time, error) {
	return s.analyticsPresetRange(r.URL.Query().Get("range"), r.URL.Query().Get("from"), r.URL.Query().Get("to"))
}

func (s *Server) analyticsPresetRange(preset, fromValue, toValue string) (time.Time, time.Time, error) {
	loc, err := time.LoadLocation(s.cfg.Timezone)
	if err != nil {
		loc = time.FixedZone("Europe/Belgrade", 3600)
	}
	now := s.now().In(loc)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	switch preset {
	case "", "today":
		return startOfToday, startOfToday.Add(24 * time.Hour), nil
	case "7d":
		return startOfToday.AddDate(0, 0, -6), startOfToday.Add(24 * time.Hour), nil
	case "month":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 1, 0), nil
	case "custom":
		from, err := time.ParseInLocation("2006-01-02", fromValue, loc)
		if err != nil {
			return time.Time{}, time.Time{}, core.ErrInvalidInput
		}
		to, err := time.ParseInLocation("2006-01-02", toValue, loc)
		if err != nil {
			return time.Time{}, time.Time{}, core.ErrInvalidInput
		}
		to = to.Add(24 * time.Hour)
		if !from.Before(to) || to.Sub(from) > 370*24*time.Hour {
			return time.Time{}, time.Time{}, core.ErrInvalidInput
		}
		return from, to, nil
	default:
		return time.Time{}, time.Time{}, core.ErrInvalidInput
	}
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 64*1024))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return core.ErrInvalidInput
	}
	return nil
}

func decodeReasonBodyOrQuery(r *http.Request) (string, error) {
	queryReason := r.URL.Query().Get("reason")
	if r.Body == nil || r.ContentLength == 0 {
		return queryReason, nil
	}
	var req struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(r, &req); err != nil {
		return "", err
	}
	if strings.TrimSpace(req.Reason) == "" {
		return queryReason, nil
	}
	return req.Reason, nil
}

func bodyHash(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	started := time.Now()
	raw, err := json.Marshal(payload)
	addServerTimingFromWriter(w, "encode", time.Since(started))
	if err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

func writeConditionalJSON(w http.ResponseWriter, r *http.Request, status int, payload any, cacheControl string) {
	started := time.Now()
	raw, err := json.Marshal(payload)
	addServerTiming(r.Context(), "encode", time.Since(started))
	if err != nil {
		writeError(w, err)
		return
	}
	sum := sha256.Sum256(raw)
	etag := `"` + hex.EncodeToString(sum[:]) + `"`
	writeRawConditionalJSON(w, r, status, raw, cacheControl, etag)
}

func writeConditionalJSONWithETag(w http.ResponseWriter, r *http.Request, status int, payload any, cacheControl, etag string) {
	started := time.Now()
	raw, err := json.Marshal(payload)
	addServerTiming(r.Context(), "encode", time.Since(started))
	if err != nil {
		writeError(w, err)
		return
	}
	if etag == "" {
		sum := sha256.Sum256(raw)
		etag = `"` + hex.EncodeToString(sum[:]) + `"`
	}
	writeRawConditionalJSON(w, r, status, raw, cacheControl, etag)
}

func writeRawConditionalJSON(w http.ResponseWriter, r *http.Request, status int, raw []byte, cacheControl, etag string) {
	header := w.Header()
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("ETag", etag)
	header.Set("Cache-Control", cacheControl)
	header.Add("Vary", "Accept-Encoding")
	if status == http.StatusOK && etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.WriteHeader(status)
	_, _ = w.Write(append(raw, '\n'))
}

func menuETag(locale string, revision int64) string {
	return fmt.Sprintf(`W/"menu-%s-%d"`, etagToken(locale, "ru"), revision)
}

func runtimeETag(revision int, runtime core.Runtime, fallbackTimezone string) string {
	timezone := runtime.Timezone
	if timezone == "" {
		timezone = fallbackTimezone
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		loc = time.UTC
	}
	local := runtime.ServerTime.In(loc)
	nextOpening := "none"
	if !runtime.NextOpening.IsZero() {
		nextOpening = runtime.NextOpening.In(loc).Format("20060102T1504")
	}
	stateKey := strings.Join([]string{
		local.Format("20060102"),
		strconv.FormatBool(runtime.AcceptingOrders),
		etagToken(runtime.Reason, "unknown"),
		nextOpening,
	}, "-")
	return fmt.Sprintf(`W/"runtime-%d-%s"`, revision, stateKey)
}

func bootstrapETag(locale string, runtimeRevision int, menuRevision int64, runtimeETagValue string) string {
	token := strings.Trim(runtimeETagValue, `W/"`)
	return fmt.Sprintf(`W/"bootstrap-%s-%d-%d-%s"`, etagToken(locale, "ru"), runtimeRevision, menuRevision, etagToken(token, "runtime"))
}

func mediaETag(relativePath string, info os.FileInfo) string {
	return fmt.Sprintf(`W/"media-%s-%x-%x"`, etagToken(relativePath, "file"), info.Size(), info.ModTime().UnixNano())
}

func etagToken(value, fallback string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		value = fallback
	}
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			builder.WriteRune(r)
		default:
			builder.WriteByte('-')
		}
	}
	if builder.Len() == 0 {
		return fallback
	}
	return builder.String()
}

func safeVersionToken(value string) string {
	return etagToken(value, "dev")
}

func etagMatches(headerValue, etag string) bool {
	for _, part := range strings.Split(headerValue, ",") {
		if strings.TrimSpace(part) == etag {
			return true
		}
	}
	return false
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	code := "INTERNAL"
	messageKey := "internal"
	known := true
	switch {
	case errors.Is(err, core.ErrForbidden):
		status, code, messageKey = http.StatusForbidden, "FORBIDDEN", "forbidden"
	case errors.Is(err, core.ErrInvalidRole):
		status, code, messageKey = http.StatusBadRequest, "INVALID_ROLE", "invalid_role"
	case errors.Is(err, core.ErrInvalidInput):
		status, code, messageKey = http.StatusBadRequest, "INVALID_INPUT", "invalid_input"
	case errors.Is(err, core.ErrRestaurantClosed):
		status, code, messageKey = http.StatusConflict, "RESTAURANT_CLOSED", "restaurant_closed"
	case errors.Is(err, core.ErrManualDayOff):
		status, code, messageKey = http.StatusConflict, "MANUAL_DAY_OFF", "manual_day_off"
	case errors.Is(err, core.ErrItemUnavailable):
		status, code, messageKey = http.StatusConflict, "ITEM_UNAVAILABLE", "item_unavailable"
	case errors.Is(err, core.ErrInvalidQuantity):
		status, code, messageKey = http.StatusBadRequest, "INVALID_QUANTITY", "invalid_quantity"
	case errors.Is(err, core.ErrOrderStatusConflict):
		status, code, messageKey = http.StatusConflict, "ORDER_STATUS_CONFLICT", "order_status_conflict"
	case errors.Is(err, core.ErrActiveOrderExists):
		status, code, messageKey = http.StatusConflict, "ACTIVE_ORDER_EXISTS", "active_order_exists"
	case errors.Is(err, core.ErrIdempotencyConflict):
		status, code, messageKey = http.StatusConflict, "IDEMPOTENCY_CONFLICT", "idempotency_conflict"
	case errors.Is(err, core.ErrCalculationExpired):
		status, code, messageKey = http.StatusConflict, "CALCULATION_EXPIRED", "calculation_expired"
	case errors.Is(err, core.ErrPaymentNotConfirmed):
		status, code, messageKey = http.StatusConflict, "PAYMENT_NOT_CONFIRMED", "payment_not_confirmed"
	case errors.Is(err, core.ErrTermsRequired):
		status, code, messageKey = http.StatusBadRequest, "TERMS_REQUIRED", "terms_required"
	case isBadJSONError(err):
		status, code, messageKey = http.StatusBadRequest, "INVALID_INPUT", "invalid_input"
	case errors.Is(err, core.ErrContactNotVerified):
		status, code, messageKey = http.StatusConflict, "CONTACT_NOT_VERIFIED", "contact_not_verified"
	case errors.Is(err, core.ErrCashLocationRequired):
		status, code, messageKey = http.StatusConflict, "CASH_LOCATION_REQUIRED", "cash_location_required"
	case errors.Is(err, core.ErrCashLocationOutside):
		status, code, messageKey = http.StatusConflict, "CASH_LOCATION_OUTSIDE", "cash_location_outside"
	case errors.Is(err, core.ErrCashLocationInaccurate):
		status, code, messageKey = http.StatusConflict, "CASH_LOCATION_INACCURATE", "cash_location_inaccurate"
	case errors.Is(err, tgauth.ErrInvalidInitData):
		status, code, messageKey = http.StatusUnauthorized, "AUTH_INVALID", "auth_invalid"
	default:
		known = false
	}
	if !known {
		slog.Default().Error("http handler error", "error", redactedInternalError(err))
	}
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":        code,
			"message_key": messageKey,
		},
	})
}

func redactedInternalError(err error) string {
	value := strings.TrimSpace(err.Error())
	if value == "" {
		return "unknown"
	}
	if strings.Contains(value, "api.telegram.org/bot") {
		return "telegram_request_error"
	}
	if len(value) > 240 {
		return value[:240]
	}
	return value
}

func isBadJSONError(err error) bool {
	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	return errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.As(err, &syntaxErr) ||
		errors.As(err, &typeErr) ||
		strings.HasPrefix(err.Error(), "json: unknown field ")
}
