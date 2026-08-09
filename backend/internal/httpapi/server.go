package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	tgauth "github.com/eqwertyry121/TL/backend/internal/auth"
	"github.com/eqwertyry121/TL/backend/internal/config"
	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/store"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
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
			r.Post("/courier/orders/{id}/delivered", s.markDelivered)

			r.Get("/admin/orders", s.adminOrders)
			r.Get("/admin/settings", s.adminSettings)
			r.Put("/admin/settings/manual-day-off", s.setManualDayOff)
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

func (s *Server) adminOrders(w http.ResponseWriter, r *http.Request) {
	orders, err := s.store.AdminOrders(r.Context(), mustSession(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"orders": orders})
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
