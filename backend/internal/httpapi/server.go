package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "image/jpeg"

	tgauth "github.com/eqwertyry121/TL/backend/internal/auth"
	"github.com/eqwertyry121/TL/backend/internal/config"
	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"
)

type Server struct {
	cfg   config.Config
	store *store.Store
	now   func() time.Time
}

type contextKey string

const sessionKey contextKey = "session"

func New(cfg config.Config, st *store.Store) *Server {
	return &Server{cfg: cfg, store: st, now: time.Now}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Get("/health", s.health)
	if s.cfg.MediaDir != "" {
		fileServer := http.StripPrefix("/media/", http.FileServer(http.Dir(s.cfg.MediaDir)))
		r.Get("/media/*", func(w http.ResponseWriter, r *http.Request) {
			fileServer.ServeHTTP(w, r)
		})
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/runtime", s.runtime)
		r.Get("/menu", s.menu)
		r.Post("/auth/telegram", s.telegramAuth)
		r.Post("/dev/session", s.devSession)

		r.Group(func(r chi.Router) {
			r.Use(s.withSession)
			r.Get("/me", s.me)
			r.Post("/orders/calculate", s.calculate)
			r.Post("/orders", s.createOrder)
			r.Get("/orders", s.clientOrders)
			r.Get("/orders/{id}", s.clientOrder)

			r.Get("/kitchen/orders", s.kitchenOrders)
			r.Post("/kitchen/orders/{id}/ready", s.markReady)

			r.Get("/courier/orders", s.courierOrders)
			r.Post("/courier/orders/{id}/eta", s.courierETA)
			r.Post("/courier/orders/{id}/delivered", s.markDelivered)

			r.Get("/admin/orders", s.adminOrders)
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

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "tk-delivery"})
}

func (s *Server) runtime(w http.ResponseWriter, r *http.Request) {
	settings, err := s.store.Settings(r.Context())
	if err != nil {
		writeError(w, err)
		return
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
	writeJSON(w, http.StatusOK, core.Runtime{
		ServerTime:           now,
		Timezone:             settings.Timezone,
		AcceptingOrders:      accept.OK,
		Reason:               accept.Reason,
		NextOpening:          accept.NextOpening,
		DayOffBanner:         settings.DayOffBanner,
		FlatDeliveryFeeMinor: settings.FlatDeliveryFeeMinor,
		Currency:             settings.Currency,
		EnabledPayments:      payments,
		SupportedLocales:     []string{"ru", "sr", "en"},
		SupportText:          settings.SupportText,
	})
}

func (s *Server) menu(w http.ResponseWriter, r *http.Request) {
	menu, err := s.store.Menu(r.Context(), r.URL.Query().Get("locale"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": menu})
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
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "roles": roles})
}

func (s *Server) telegramAuth(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Audience core.Audience `json:"audience"`
		Role     core.Role     `json:"role"`
		InitData string        `json:"init_data"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	token := s.cfg.ClientBotToken
	if req.Audience == core.AudienceStaff || req.Role != core.RoleClient {
		token = s.cfg.StaffBotToken
	}
	tgUser, err := tgauth.VerifyTelegramInitData(req.InitData, token, s.cfg.InitDataMaxAge, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	user, err := s.store.UpsertTelegramUser(r.Context(), core.User{
		TelegramUserID: tgUser.ID,
		Username:       tgUser.Username,
		FirstName:      tgUser.FirstName,
		PhotoURL:       tgUser.PhotoURL,
		LanguageCode:   tgUser.LanguageCode,
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
	writeJSON(w, http.StatusOK, map[string]any{"session": session, "roles": roles})
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
		Items []core.CartItemInput `json:"items"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, err)
		return
	}
	calc, err := s.store.Calculate(r.Context(), mustSession(r), req.Items, s.now())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, calc)
}

func (s *Server) createOrder(w http.ResponseWriter, r *http.Request) {
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

func (s *Server) clientOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.store.ClientOrders(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
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

func (s *Server) kitchenOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.store.KitchenOrders(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
}

func (s *Server) courierOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.store.CourierOrders(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
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
	orders, err := s.store.AdminOrders(r.Context(), mustSession(r), store.AdminOrderFilter{
		Status: r.URL.Query().Get("status"),
		Query:  r.URL.Query().Get("q"),
		Date:   r.URL.Query().Get("date"),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
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
	writeJSON(w, http.StatusOK, category)
}

func (s *Server) adminDeleteCategory(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.store.DeleteOrArchiveCategory(r.Context(), mustSession(r), id, r.URL.Query().Get("reason"))
	if err != nil {
		writeError(w, err)
		return
	}
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
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) adminDeleteMenuItem(w http.ResponseWriter, r *http.Request) {
	id, err := parseUUIDParam(r, "id")
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.store.DeleteOrArchiveMenuItem(r.Context(), mustSession(r), id, r.URL.Query().Get("reason"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (s *Server) markReady(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, err)
		return
	}
	order, err := s.store.MarkReady(r.Context(), mustSession(r), id, r.Header.Get("Idempotency-Key"), bodyHash([]byte(id.String())))
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
	order, err := s.store.MarkDelivered(r.Context(), mustSession(r), id, r.Header.Get("Idempotency-Key"), bodyHash([]byte(id.String())))
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
	writer.Flush()
}

func (s *Server) adminAudit(w http.ResponseWriter, r *http.Request) {
	entries, err := s.store.AuditLog(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
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
	if header.Size > 5<<20 {
		writeError(w, core.ErrInvalidInput)
		return
	}
	img, _, err := image.Decode(io.LimitReader(file, 5<<20))
	if err != nil {
		writeError(w, core.ErrInvalidInput)
		return
	}
	bounds := img.Bounds()
	if bounds.Dx() < 64 || bounds.Dy() < 64 || bounds.Dx() > 4096 || bounds.Dy() > 4096 {
		writeError(w, core.ErrInvalidInput)
		return
	}
	mediaSubdir := filepath.Join(s.cfg.MediaDir, "menu")
	if err := os.MkdirAll(mediaSubdir, 0o755); err != nil {
		writeError(w, err)
		return
	}
	filename := uuid.NewString() + ".png"
	target := filepath.Join(mediaSubdir, filename)
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		writeError(w, err)
		return
	}
	defer out.Close()
	if err := png.Encode(out, img); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"photo_path": "/media/menu/" + filename})
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

func mustSession(r *http.Request) core.Session {
	return r.Context().Value(sessionKey).(core.Session)
}

func parseUUIDParam(r *http.Request, name string) (uuid.UUID, error) {
	return uuid.Parse(chi.URLParam(r, name))
}

func (s *Server) analyticsRange(r *http.Request) (time.Time, time.Time, error) {
	loc, err := time.LoadLocation(s.cfg.Timezone)
	if err != nil {
		loc = time.FixedZone("Europe/Belgrade", 3600)
	}
	now := s.now().In(loc)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	preset := r.URL.Query().Get("range")
	switch preset {
	case "", "today":
		return startOfToday, startOfToday.Add(24 * time.Hour), nil
	case "7d":
		return startOfToday.AddDate(0, 0, -6), startOfToday.Add(24 * time.Hour), nil
	case "month":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 1, 0), nil
	case "custom":
		from, err := time.ParseInLocation("2006-01-02", r.URL.Query().Get("from"), loc)
		if err != nil {
			return time.Time{}, time.Time{}, core.ErrInvalidInput
		}
		to, err := time.ParseInLocation("2006-01-02", r.URL.Query().Get("to"), loc)
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
	return dec.Decode(target)
}

func bodyHash(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	code := "BAD_REQUEST"
	messageKey := "bad_request"
	switch {
	case errors.Is(err, core.ErrForbidden):
		status, code, messageKey = http.StatusForbidden, "FORBIDDEN", "forbidden"
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
	case errors.Is(err, core.ErrIdempotencyConflict):
		status, code, messageKey = http.StatusConflict, "IDEMPOTENCY_CONFLICT", "idempotency_conflict"
	case errors.Is(err, core.ErrCalculationExpired):
		status, code, messageKey = http.StatusConflict, "CALCULATION_EXPIRED", "calculation_expired"
	case errors.Is(err, core.ErrPaymentNotConfirmed):
		status, code, messageKey = http.StatusConflict, "PAYMENT_NOT_CONFIRMED", "payment_not_confirmed"
	case errors.Is(err, core.ErrTermsRequired):
		status, code, messageKey = http.StatusBadRequest, "TERMS_REQUIRED", "terms_required"
	case errors.Is(err, tgauth.ErrInvalidInitData):
		status, code, messageKey = http.StatusUnauthorized, "AUTH_INVALID", "auth_invalid"
	}
	writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":        code,
			"message_key": messageKey,
		},
	})
}
