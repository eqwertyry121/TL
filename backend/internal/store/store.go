package store

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	cryptobox "github.com/eqwertyry121/TL/backend/internal/crypto"
	"github.com/eqwertyry121/TL/backend/internal/geo"
	"github.com/eqwertyry121/TL/backend/internal/menumedia"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool                       *pgxpool.Pool
	box                        *cryptobox.Box
	piiHashKey                 []byte
	deliveryTimingBetaIDs      map[int64]struct{}
	persistentCityVerification bool
}

type ProductEventInput struct {
	EventName string
	Screen    string
	Target    string
}

const (
	phoneHashHMACPrefix       = "hmac-sha256:"
	deliveryAlertTelegramID   = int64(8609105840)
	orderAdditionWindow       = 5 * time.Minute
	pickupAddressSnapshot     = "Самовывоз"
	currentTermsVersion       = "2026-08-17"
	maxPhoneLength            = 32
	maxAddressLength          = 240
	maxCustomerCommentLength  = 300
	maxTitleLength            = 80
	maxDescriptionLength      = 700
	maxShortTextLength        = 120
	maxSupportTextLength      = 700
	maxURLLength              = 300
	maxReasonLength           = 300
	maxAdminSearchLength      = 80
	maxStaffDisplayLabelLimit = 80
	maxItemQuantityHardLimit  = 99
)

var ownerTesterTelegramIDs = map[int64]struct{}{
	1048084234: {},
	8241921060: {},
	8609105840: {},
	7604602332: {},
}

type CreateOrderInput struct {
	CalculationToken            string               `json:"calculation_token"`
	CashLocationChallengeID     string               `json:"cash_location_challenge_id"`
	Phone                       string               `json:"phone"`
	Address                     string               `json:"address"`
	Comment                     string               `json:"comment"`
	FulfillmentType             core.FulfillmentType `json:"fulfillment_type"`
	PickupAt                    *time.Time           `json:"pickup_at"`
	DeliveryTimeMode            string               `json:"delivery_time_mode"`
	DeliveryRequestedAt         *time.Time           `json:"delivery_requested_at"`
	PaymentMethod               core.PaymentMethod   `json:"payment_method"`
	TermsAccepted               bool                 `json:"terms_accepted"`
	TermsVersion                string               `json:"terms_version"`
	Locale                      string               `json:"locale"`
	AllowConcurrentActiveOrders bool                 `json:"-"`
}

type DeliveryTimingInput struct {
	Mode        string
	RequestedAt *time.Time
}

type EstimateReadyInput struct {
	ReadyInMinutes   *int       `json:"ready_in_minutes"`
	EstimatedReadyAt *time.Time `json:"estimated_ready_at"`
	ExpectedVersion  int        `json:"expected_version"`
}

type AddOrderItemsInput struct {
	CalculationToken string `json:"calculation_token"`
	ExpectedVersion  int    `json:"expected_version"`
}

type UpsertCategoryInput struct {
	TitleRU   string `json:"title_ru"`
	TitleSR   string `json:"title_sr"`
	TitleEN   string `json:"title_en"`
	SortOrder int    `json:"sort_order"`
	Visible   bool   `json:"visible"`
	Version   int    `json:"version"`
}

type UpsertMenuItemInput struct {
	CategoryID      uuid.UUID `json:"category_id"`
	TitleRU         string    `json:"title_ru"`
	TitleSR         string    `json:"title_sr"`
	TitleEN         string    `json:"title_en"`
	DescriptionRU   string    `json:"description_ru"`
	DescriptionSR   string    `json:"description_sr"`
	DescriptionEN   string    `json:"description_en"`
	PriceMinor      int       `json:"price_minor"`
	DiscountPercent int       `json:"discount_percent"`
	PhotoPath       string    `json:"photo_path"`
	WeightText      string    `json:"weight_text"`
	MinQuantity     int       `json:"min_quantity"`
	AllergenTextRU  string    `json:"allergen_text_ru"`
	AllergenTextSR  string    `json:"allergen_text_sr"`
	AllergenTextEN  string    `json:"allergen_text_en"`
	SortOrder       int       `json:"sort_order"`
	Visible         bool      `json:"visible"`
	Version         int       `json:"version"`
}

type UpdateSettingsInput struct {
	FlatDeliveryFeeMinor          int     `json:"flat_delivery_fee_minor"`
	SupportText                   string  `json:"support_text"`
	SupportPhone                  string  `json:"support_phone"`
	TermsURL                      string  `json:"terms_url"`
	MaxItemQuantity               int     `json:"max_item_quantity"`
	MaxCommentLength              int     `json:"max_comment_length"`
	CashEnabled                   bool    `json:"cash_enabled"`
	CardEnabled                   bool    `json:"card_enabled"`
	CryptoEnabled                 bool    `json:"crypto_enabled"`
	CashLocationRequired          bool    `json:"cash_location_required"`
	RestaurantLatitude            float64 `json:"restaurant_latitude"`
	RestaurantLongitude           float64 `json:"restaurant_longitude"`
	CashLocationRadiusMeters      int     `json:"cash_location_radius_meters"`
	CashLocationTTLSeconds        int     `json:"cash_location_ttl_seconds"`
	CashLocationMaxAccuracyMeters int     `json:"cash_location_max_accuracy_meters"`
	PickupEnabled                 bool    `json:"pickup_enabled"`
	PickupAddress                 string  `json:"pickup_address"`
	PickupMapURL                  string  `json:"pickup_map_url"`
	PickupInstructionsRU          string  `json:"pickup_instructions_ru"`
	PickupInstructionsSR          string  `json:"pickup_instructions_sr"`
	PickupInstructionsEN          string  `json:"pickup_instructions_en"`
	PickupMinLeadMinutes          int     `json:"pickup_min_lead_minutes"`
	PickupSlotMinutes             int     `json:"pickup_slot_minutes"`
	PickupMaxOrdersPerSlot        int     `json:"pickup_max_orders_per_slot"`
	PickupLastTime                string  `json:"pickup_last_time"`
	DeliveryTimingEnabled         bool    `json:"delivery_timing_enabled"`
	DeliveryMinLeadMinutes        int     `json:"delivery_min_lead_minutes"`
	DeliverySlotMinutes           int     `json:"delivery_slot_minutes"`
	DeliveryMaxOrdersPerSlot      int     `json:"delivery_max_orders_per_slot"`
	DeliveryLastTargetTime        string  `json:"delivery_last_target_time"`
	Version                       int     `json:"version"`
}

type CreateCashLocationChallengeInput struct {
	CalculationToken string `json:"calculation_token"`
	SendPrompt       *bool  `json:"send_prompt,omitempty"`
}

type AdminOrderFilter struct {
	Status string
	Query  string
	Date   string
	Limit  int
	Offset int
}

type AuditLogFilter struct {
	Limit  int
	Offset int
}

type ClientOrderFilter struct {
	Limit  int
	Offset int
}

type ClientOrdersPage struct {
	Orders  []core.OrderSummary `json:"orders"`
	Limit   int                 `json:"limit"`
	Offset  int                 `json:"offset"`
	HasMore bool                `json:"has_more"`
}

type AdminOrderCounts struct {
	Active  int `json:"active"`
	New     int `json:"new"`
	Ready   int `json:"ready"`
	History int `json:"history"`
}

type AdminOrdersPage struct {
	Orders  []core.Order     `json:"orders"`
	Limit   int              `json:"limit"`
	Offset  int              `json:"offset"`
	HasMore bool             `json:"has_more"`
	Counts  AdminOrderCounts `json:"counts"`
}

type AuditLogPage struct {
	Entries []core.AuditEntry `json:"entries"`
	Limit   int               `json:"limit"`
	Offset  int               `json:"offset"`
	HasMore bool              `json:"has_more"`
}

type MenuMediaInput struct {
	DisplayPath     string
	ThumbnailPath   string
	DisplayWidth    int
	DisplayHeight   int
	DisplayBytes    int
	ThumbnailWidth  int
	ThumbnailHeight int
	ThumbnailBytes  int
}

type AddStaffInput struct {
	TelegramUserID int64     `json:"telegram_user_id"`
	DisplayLabel   string    `json:"display_label"`
	Role           core.Role `json:"role"`
	Active         bool      `json:"active"`
}

type UpdateStaffInput struct {
	DisplayLabel string    `json:"display_label"`
	Role         core.Role `json:"role"`
	Active       bool      `json:"active"`
}

func New(pool *pgxpool.Pool, box *cryptobox.Box, piiHashKey []byte, deliveryTimingBetaIDs ...int64) *Store {
	key := append([]byte(nil), piiHashKey...)
	if len(key) == 0 {
		sum := sha256.Sum256([]byte("tk-delivery-local-dev-pii-hash-key"))
		key = append([]byte(nil), sum[:]...)
	}
	betaIDs := make(map[int64]struct{}, len(deliveryTimingBetaIDs))
	for _, telegramUserID := range deliveryTimingBetaIDs {
		if telegramUserID > 0 {
			betaIDs[telegramUserID] = struct{}{}
		}
	}
	return &Store{pool: pool, box: box, piiHashKey: key, deliveryTimingBetaIDs: betaIDs}
}

func (s *Store) deliveryTimingAccess(telegramUserID int64) bool {
	if len(s.deliveryTimingBetaIDs) == 0 {
		return true
	}
	_, ok := s.deliveryTimingBetaIDs[telegramUserID]
	return ok
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) MigrateLegacyPhoneHashes(ctx context.Context) error {
	if err := s.migrateLegacyPhoneHashesForTable(ctx, "users"); err != nil {
		return err
	}
	return s.migrateLegacyPhoneHashesForTable(ctx, "orders")
}

func (s *Store) migrateLegacyPhoneHashesForTable(ctx context.Context, table string) error {
	if table != "users" && table != "orders" {
		return core.ErrInvalidInput
	}
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, phone_ciphertext
		FROM %s
		WHERE phone_ciphertext <> ''
			AND (phone_hash = '' OR phone_hash NOT LIKE $1)
	`, table), phoneHashHMACPrefix+"%")
	if err != nil {
		return err
	}
	defer rows.Close()

	type legacyPhoneRow struct {
		id         uuid.UUID
		ciphertext string
	}
	pending := []legacyPhoneRow{}
	for rows.Next() {
		var current legacyPhoneRow
		if err := rows.Scan(&current.id, &current.ciphertext); err != nil {
			return err
		}
		pending = append(pending, current)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, current := range pending {
		phone, err := s.box.Decrypt(current.ciphertext)
		if err != nil {
			return fmt.Errorf("migrate legacy phone hash %s %s: %w", table, current.id, err)
		}
		if _, err := s.pool.Exec(ctx, fmt.Sprintf(`
			UPDATE %s
			SET phone_hash=$2, updated_at=now()
			WHERE id=$1 AND (phone_hash = '' OR phone_hash NOT LIKE $3)
		`, table), current.id, s.phoneHash(phone), phoneHashHMACPrefix+"%"); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) BootstrapOwner(ctx context.Context, telegramUserID int64) error {
	if telegramUserID == 0 {
		return nil
	}
	ownerTesterTelegramIDs[telegramUserID] = struct{}{}
	var user core.User
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (telegram_user_id, username, first_name, photo_url, language_code)
		VALUES ($1, 'owner', 'Owner', '', 'ru')
		ON CONFLICT (telegram_user_id)
		DO UPDATE SET telegram_user_id=EXCLUDED.telegram_user_id
		RETURNING id, telegram_user_id, username, first_name, photo_url, language_code
	`, telegramUserID).Scan(&user.ID, &user.TelegramUserID, &user.Username, &user.FirstName, &user.PhotoURL, &user.LanguageCode)
	if err != nil {
		return err
	}
	for _, role := range []core.Role{core.RoleAdmin, core.RoleKitchen, core.RoleCourier} {
		_, err := s.pool.Exec(ctx, `
			INSERT INTO staff (user_id, telegram_user_id, role, display_label, active, created_by)
			VALUES ($1, $2, $3, $4, true, $1)
			ON CONFLICT (telegram_user_id, role)
			DO UPDATE SET active=true, user_id=EXCLUDED.user_id, updated_at=now()
		`, user.ID, telegramUserID, string(role), "Owner "+string(role))
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) UpsertTelegramUser(ctx context.Context, user core.User) (core.User, error) {
	if user.LanguageCode == "" {
		user.LanguageCode = "ru"
	}
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (telegram_user_id, username, first_name, photo_url, language_code)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (telegram_user_id)
		DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, photo_url=EXCLUDED.photo_url,
			language_code=EXCLUDED.language_code, updated_at=now()
		RETURNING id, telegram_user_id, username, first_name, photo_url, language_code
	`, user.TelegramUserID, safe(user.Username), safe(user.FirstName), safe(user.PhotoURL), safe(user.LanguageCode)).
		Scan(&user.ID, &user.TelegramUserID, &user.Username, &user.FirstName, &user.PhotoURL, &user.LanguageCode)
	return user, err
}

func (s *Store) StaffRoles(ctx context.Context, telegramUserID int64) ([]core.Role, error) {
	rows, err := s.pool.Query(ctx, `SELECT role FROM staff WHERE telegram_user_id=$1 AND active=true ORDER BY role`, telegramUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	roles := []core.Role{core.RoleClient}
	for rows.Next() {
		var role core.Role
		if err := rows.Scan(&role); err != nil {
			return nil, err
		}
		roles = append(roles, role)
	}
	return roles, rows.Err()
}

func (s *Store) CreateSession(ctx context.Context, user core.User, role core.Role, ttl time.Duration) (core.Session, []core.Role, error) {
	if role == "" {
		role = core.RoleClient
	}
	roles, err := s.StaffRoles(ctx, user.TelegramUserID)
	if err != nil {
		return core.Session{}, nil, err
	}
	if !roleAllowed(role, roles) {
		return core.Session{}, nil, core.ErrForbidden
	}
	audience := core.AudienceClient
	if role != core.RoleClient {
		audience = core.AudienceStaff
	}
	token, tokenHash, err := randomToken()
	if err != nil {
		return core.Session{}, nil, err
	}
	expiresAt := time.Now().UTC().Add(ttl)
	_, err = s.pool.Exec(ctx, `
		WITH created_session AS (
			INSERT INTO sessions (token_hash, user_id, telegram_user_id, audience, active_role, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING user_id
		)
		INSERT INTO client_app_visits (user_id)
		SELECT user_id FROM created_session WHERE $4 = 'client' AND $5 = 'CLIENT'
	`, tokenHash, user.ID, user.TelegramUserID, string(audience), string(role), expiresAt)
	if err != nil {
		return core.Session{}, nil, err
	}
	return core.Session{
		Token:                token,
		TokenHash:            tokenHash,
		UserID:               user.ID,
		TelegramUserID:       user.TelegramUserID,
		Username:             user.Username,
		FirstName:            user.FirstName,
		PhotoURL:             user.PhotoURL,
		DeliveryTimingAccess: s.deliveryTimingAccess(user.TelegramUserID),
		Audience:             audience,
		ActiveRole:           role,
		ExpiresAt:            expiresAt,
	}, roles, nil
}

func (s *Store) RecordProductEvents(ctx context.Context, sess core.Session, events []ProductEventInput, now time.Time) error {
	if sess.ActiveRole != core.RoleClient {
		return core.ErrForbidden
	}
	if len(events) == 0 {
		return nil
	}
	names := make([]string, len(events))
	screens := make([]string, len(events))
	targets := make([]string, len(events))
	for index, event := range events {
		names[index] = event.EventName
		screens[index] = event.Screen
		targets[index] = event.Target
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO client_product_events (user_id, event_name, screen, target, occurred_at)
		SELECT $1, input.event_name, input.screen, input.target, $5
		FROM unnest($2::text[], $3::text[], $4::text[]) AS input(event_name, screen, target)
	`, sess.UserID, names, screens, targets, now.UTC())
	return err
}

func (s *Store) SessionByToken(ctx context.Context, token string) (core.Session, error) {
	hash := hashString(token)
	var sess core.Session
	err := s.pool.QueryRow(ctx, `
		SELECT s.token_hash, s.user_id, s.telegram_user_id, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''), s.audience, s.active_role, s.expires_at
		FROM sessions s
		JOIN users u ON u.id=s.user_id
		WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()
			AND (
				s.active_role='CLIENT'
				OR EXISTS (
					SELECT 1
					FROM staff st
					WHERE st.telegram_user_id=s.telegram_user_id
						AND st.role=s.active_role
						AND st.active=true
				)
			)
	`, hash).Scan(
		&sess.TokenHash,
		&sess.UserID,
		&sess.TelegramUserID,
		&sess.Username,
		&sess.FirstName,
		&sess.PhotoURL,
		&sess.Audience,
		&sess.ActiveRole,
		&sess.ExpiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Session{}, core.ErrForbidden
	}
	sess.DeliveryTimingAccess = s.deliveryTimingAccess(sess.TelegramUserID)
	return sess, err
}

func (s *Store) Settings(ctx context.Context) (core.Settings, error) {
	var settings core.Settings
	err := s.pool.QueryRow(ctx, `
		SELECT timezone, currency, manual_day_off, day_off_banner, flat_delivery_fee_minor,
			support_text, support_phone, terms_url, max_item_quantity, max_comment_length,
			cash_enabled, card_enabled, crypto_enabled, cash_location_required, restaurant_latitude,
			restaurant_longitude, cash_location_radius_meters, cash_location_ttl_seconds,
			cash_location_max_accuracy_meters, pickup_enabled, pickup_address, pickup_map_url,
			pickup_instructions_ru, pickup_instructions_sr, pickup_instructions_en,
			pickup_min_lead_minutes, pickup_slot_minutes, pickup_max_orders_per_slot,
			to_char(pickup_last_time, 'HH24:MI'), delivery_timing_enabled,
			delivery_min_lead_minutes, delivery_slot_minutes, delivery_max_orders_per_slot,
			to_char(delivery_last_target_time, 'HH24:MI'), version
		FROM app_settings WHERE id=true
	`).Scan(
		&settings.Timezone,
		&settings.Currency,
		&settings.ManualDayOff,
		&settings.DayOffBanner,
		&settings.FlatDeliveryFeeMinor,
		&settings.SupportText,
		&settings.SupportPhone,
		&settings.TermsURL,
		&settings.MaxItemQuantity,
		&settings.MaxCommentLength,
		&settings.CashEnabled,
		&settings.CardEnabled,
		&settings.CryptoEnabled,
		&settings.CashLocationRequired,
		&settings.RestaurantLatitude,
		&settings.RestaurantLongitude,
		&settings.CashLocationRadiusMeters,
		&settings.CashLocationTTLSeconds,
		&settings.CashLocationMaxAccuracyMeters,
		&settings.PickupEnabled,
		&settings.PickupAddress,
		&settings.PickupMapURL,
		&settings.PickupInstructionsRU,
		&settings.PickupInstructionsSR,
		&settings.PickupInstructionsEN,
		&settings.PickupMinLeadMinutes,
		&settings.PickupSlotMinutes,
		&settings.PickupMaxOrdersPerSlot,
		&settings.PickupLastTime,
		&settings.DeliveryTimingEnabled,
		&settings.DeliveryMinLeadMinutes,
		&settings.DeliverySlotMinutes,
		&settings.DeliveryMaxOrdersPerSlot,
		&settings.DeliveryLastTargetTime,
		&settings.Version,
	)
	if err != nil {
		return core.Settings{}, err
	}
	settings.Schedule, err = s.Schedule(ctx)
	return settings, err
}

func (s *Store) Schedule(ctx context.Context) ([]core.ScheduleDay, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT day_of_week, closed, to_char(open_time, 'HH24:MI'), to_char(order_cutoff_time, 'HH24:MI'),
			to_char(close_time, 'HH24:MI'), version
		FROM restaurant_schedule
		ORDER BY day_of_week
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := []core.ScheduleDay{}
	for rows.Next() {
		var day core.ScheduleDay
		if err := rows.Scan(&day.DayOfWeek, &day.Closed, &day.OpenTime, &day.OrderCutoffTime, &day.CloseTime, &day.Version); err != nil {
			return nil, err
		}
		days = append(days, day)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(days) == 0 {
		return core.DefaultSchedule(), nil
	}
	return days, nil
}

func (s *Store) PickupSlots(ctx context.Context, sess core.Session, now time.Time) (core.PickupSlots, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.PickupSlots{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.PickupSlots{}, err
	}
	if !settings.PickupEnabled {
		return core.PickupSlots{}, core.ErrPickupUnavailable
	}
	accept := core.CanAcceptOrder(now, settings)
	if !accept.OK {
		return core.PickupSlots{Timezone: settings.Timezone, Slots: []core.PickupSlot{}}, nil
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return core.PickupSlots{}, err
	}
	localNow := now.In(loc)
	lastHour, lastMinute, ok := parseClock(settings.PickupLastTime)
	if !ok {
		return core.PickupSlots{}, core.ErrInvalidInput
	}
	last := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), lastHour, lastMinute, 0, 0, loc)
	interval := time.Duration(settings.PickupSlotMinutes) * time.Minute
	earliest := localNow.Add(time.Duration(settings.PickupMinLeadMinutes) * time.Minute)
	first := earliest.Truncate(interval)
	if first.Before(earliest) {
		first = first.Add(interval)
	}
	counts := map[time.Time]int{}
	rows, err := s.pool.Query(ctx, `
		SELECT pickup_at, COUNT(*)::int
		FROM orders
		WHERE fulfillment_type='pickup' AND fulfillment_status IN ('NEW', 'READY_FOR_PICKUP')
			AND pickup_at >= $1 AND pickup_at <= $2
		GROUP BY pickup_at
	`, first.UTC(), last.UTC())
	if err != nil {
		return core.PickupSlots{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var at time.Time
		var count int
		if err := rows.Scan(&at, &count); err != nil {
			return core.PickupSlots{}, err
		}
		counts[at.UTC()] = count
	}
	if err := rows.Err(); err != nil {
		return core.PickupSlots{}, err
	}
	result := core.PickupSlots{Timezone: settings.Timezone, Date: localNow.Format("2006-01-02"), Slots: []core.PickupSlot{}}
	for slot := first; !slot.After(last); slot = slot.Add(interval) {
		if counts[slot.UTC()] >= settings.PickupMaxOrdersPerSlot {
			continue
		}
		result.Slots = append(result.Slots, core.PickupSlot{PickupAt: slot.UTC(), Label: slot.Format("15:04")})
	}
	return result, nil
}

func (s *Store) DeliverySlots(ctx context.Context, sess core.Session, now time.Time) (core.DeliverySlots, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.DeliverySlots{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.DeliverySlots{}, err
	}
	if !settings.DeliveryTimingEnabled || !s.deliveryTimingAccess(sess.TelegramUserID) {
		return core.DeliverySlots{}, core.ErrDeliveryTimingUnavailable
	}
	accept := core.CanAcceptOrder(now, settings)
	if !accept.OK {
		return core.DeliverySlots{Timezone: settings.Timezone, Slots: []core.DeliverySlot{}}, nil
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return core.DeliverySlots{}, err
	}
	localNow := now.In(loc)
	first, last, err := deliverySlotBounds(localNow, settings)
	if err != nil {
		return core.DeliverySlots{}, err
	}
	result := core.DeliverySlots{Timezone: settings.Timezone, Date: localNow.Format("2006-01-02"), Slots: []core.DeliverySlot{}}
	if first.After(last) {
		return result, nil
	}
	interval := time.Duration(settings.DeliverySlotMinutes) * time.Minute
	counts, err := s.deliverySlotLoads(ctx, first, last, interval)
	if err != nil {
		return core.DeliverySlots{}, err
	}
	all := make([]time.Time, 0, int(last.Sub(first)/interval)+1)
	for slot := first; !slot.After(last); slot = slot.Add(interval) {
		all = append(all, slot)
	}
	for index, slot := range all {
		available := counts[slot.UTC()] < settings.DeliveryMaxOrdersPerSlot
		var next *time.Time
		if !available {
			for _, candidate := range all[index+1:] {
				if counts[candidate.UTC()] < settings.DeliveryMaxOrdersPerSlot {
					value := candidate.UTC()
					next = &value
					break
				}
			}
		}
		queueDelay := 0
		if next != nil {
			queueDelay = int(next.Sub(slot.UTC()).Minutes())
		}
		result.Slots = append(result.Slots, core.DeliverySlot{
			TargetAt: slot.UTC(), Label: slot.Format("15:04"), Available: available,
			QueueDelayMinutes: queueDelay, NextAvailableAt: next,
		})
	}
	for _, slot := range result.Slots {
		if slot.Available {
			queueDelay := int(slot.TargetAt.Sub(first.UTC()).Minutes())
			result.ASAP = &core.DeliveryASAP{
				TargetAt: slot.TargetAt, WaitMinutes: max(0, int(slot.TargetAt.Sub(now.UTC()).Minutes())),
				QueueDelayMinutes: queueDelay,
			}
			break
		}
	}
	if result.ASAP != nil {
		if err := s.pool.QueryRow(ctx, `
			SELECT COUNT(*)::int + 1
			FROM orders
			WHERE fulfillment_type='delivery' AND fulfillment_status='NEW' AND delivery_time_mode='ASAP'
		`).Scan(&result.ASAP.QueuePosition); err != nil {
			return core.DeliverySlots{}, err
		}
	}
	return result, nil
}

func deliverySlotBounds(localNow time.Time, settings core.Settings) (time.Time, time.Time, error) {
	interval := time.Duration(settings.DeliverySlotMinutes) * time.Minute
	earliest := localNow.Add(time.Duration(settings.DeliveryMinLeadMinutes) * time.Minute)
	dayStart := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, localNow.Location())
	elapsed := earliest.Sub(dayStart)
	first := dayStart.Add(((elapsed + interval - 1) / interval) * interval)
	lastHour, lastMinute, ok := parseClock(settings.DeliveryLastTargetTime)
	if !ok {
		return time.Time{}, time.Time{}, core.ErrInvalidInput
	}
	last := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), lastHour, lastMinute, 0, 0, localNow.Location())
	for _, day := range settings.Schedule {
		if day.DayOfWeek != int(localNow.Weekday()) {
			continue
		}
		closeHour, closeMinute, valid := parseClock(day.CloseTime)
		if valid {
			closeAt := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), closeHour, closeMinute, 0, 0, localNow.Location())
			if closeAt.Before(last) {
				last = closeAt
			}
		}
		break
	}
	return first, last, nil
}

func (s *Store) deliverySlotLoads(ctx context.Context, first, last time.Time, interval time.Duration) (map[time.Time]int, error) {
	counts := map[time.Time]int{}
	rows, err := s.pool.Query(ctx, `
		SELECT slot_at, SUM(load)::int
		FROM (
			SELECT delivery_target_at AS slot_at, COUNT(*)::int AS load
			FROM orders
			WHERE fulfillment_type='delivery' AND fulfillment_status IN ('NEW','OUT_FOR_DELIVERY')
				AND delivery_target_at BETWEEN $1 AND $2
			GROUP BY delivery_target_at
			UNION ALL
			SELECT $1 + floor(extract(epoch FROM (pickup_cook_at - $1)) / $3)::int * ($3 * interval '1 second') AS slot_at,
				COUNT(*)::int AS load
			FROM orders
			WHERE fulfillment_type='pickup' AND fulfillment_status IN ('NEW','READY_FOR_PICKUP')
				AND pickup_cook_at >= $1 AND pickup_cook_at < $2 + ($3 * interval '1 second')
			GROUP BY 1
		) loads
		GROUP BY slot_at
	`, first.UTC(), last.UTC(), int(interval.Seconds()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var slot time.Time
		var count int
		if err := rows.Scan(&slot, &count); err != nil {
			return nil, err
		}
		counts[slot.UTC()] = count
	}
	return counts, rows.Err()
}

func parseClock(value string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	hour, errHour := strconv.Atoi(parts[0])
	minute, errMinute := strconv.Atoi(parts[1])
	if errHour != nil || errMinute != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, 0, false
	}
	return hour, minute, true
}

func validClock(value string) bool { _, _, ok := parseClock(value); return ok }

func validPickupSlotMinutes(value int) bool {
	switch value {
	case 5, 10, 15, 20, 30, 60:
		return true
	}
	return false
}

func (s *Store) SetManualDayOff(ctx context.Context, sess core.Session, enabled bool) (core.Settings, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Settings{}, core.ErrForbidden
	}
	before, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	defer rollback(ctx, tx)
	_, err = tx.Exec(ctx, `
		UPDATE app_settings
		SET manual_day_off=$1,
			day_off_banner=CASE WHEN $1 THEN 'Временно закрыто на техобслуживание' ELSE 'ВЫХОДНОЙ' END,
			version=version+1,
			updated_at=now()
		WHERE id=true
	`, enabled)
	if err != nil {
		return core.Settings{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "settings.manual_day_off", "app_settings", nil, "", map[string]any{"manual_day_off": before.ManualDayOff}, map[string]any{"manual_day_off": enabled}); err != nil {
		return core.Settings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Settings{}, err
	}
	after, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	return after, nil
}

func (s *Store) SetTelegramSandboxPreference(ctx context.Context, telegramUserID int64, enabled bool) error {
	if telegramUserID <= 0 {
		return core.ErrInvalidInput
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO telegram_environment_preferences (telegram_user_id, sandbox_enabled, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (telegram_user_id) DO UPDATE
		SET sandbox_enabled=EXCLUDED.sandbox_enabled, updated_at=now()
	`, telegramUserID, enabled)
	return err
}

func (s *Store) TelegramSandboxPreference(ctx context.Context, telegramUserID int64) (bool, error) {
	if telegramUserID <= 0 {
		return false, core.ErrInvalidInput
	}
	var enabled bool
	err := s.pool.QueryRow(ctx, `
		SELECT sandbox_enabled
		FROM telegram_environment_preferences
		WHERE telegram_user_id=$1
	`, telegramUserID).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return enabled, err
}

func (s *Store) UpdateSettings(ctx context.Context, sess core.Session, input UpdateSettingsInput) (core.Settings, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Settings{}, core.ErrForbidden
	}
	input.FlatDeliveryFeeMinor = 0
	if input.CashLocationRadiusMeters == 0 {
		input.CashLocationRadiusMeters = 12000
	}
	if input.CashLocationTTLSeconds == 0 {
		input.CashLocationTTLSeconds = 180
	}
	if input.CashLocationMaxAccuracyMeters == 0 {
		input.CashLocationMaxAccuracyMeters = 200
	}
	if input.PickupMinLeadMinutes == 0 {
		input.PickupMinLeadMinutes = 40
	}
	if input.PickupSlotMinutes == 0 {
		input.PickupSlotMinutes = 15
	}
	if input.PickupMaxOrdersPerSlot == 0 {
		input.PickupMaxOrdersPerSlot = 3
	}
	if strings.TrimSpace(input.PickupLastTime) == "" {
		input.PickupLastTime = "22:00"
	}
	if input.DeliveryMinLeadMinutes == 0 {
		input.DeliveryMinLeadMinutes = 30
	}
	if input.DeliverySlotMinutes == 0 {
		input.DeliverySlotMinutes = 30
	}
	if input.DeliveryMaxOrdersPerSlot == 0 {
		input.DeliveryMaxOrdersPerSlot = 1
	}
	if strings.TrimSpace(input.DeliveryLastTargetTime) == "" {
		input.DeliveryLastTargetTime = "21:00"
	}
	if input.FlatDeliveryFeeMinor < 0 || input.MaxItemQuantity <= 0 || input.MaxItemQuantity > maxItemQuantityHardLimit ||
		input.MaxCommentLength <= 0 || input.MaxCommentLength > maxCustomerCommentLength || !input.CashEnabled {
		return core.Settings{}, core.ErrInvalidInput
	}
	if !optionalText(input.SupportText, maxSupportTextLength) || !optionalText(input.SupportPhone, maxPhoneLength) ||
		!validOptionalURL(input.TermsURL) {
		return core.Settings{}, core.ErrInvalidInput
	}
	if input.CashLocationRadiusMeters <= 0 || input.CashLocationTTLSeconds < 30 || input.CashLocationTTLSeconds > 900 ||
		input.CashLocationMaxAccuracyMeters < 10 || input.CashLocationMaxAccuracyMeters > 1500 {
		return core.Settings{}, core.ErrInvalidInput
	}
	if !geo.ValidCoordinates(input.RestaurantLatitude, input.RestaurantLongitude) {
		return core.Settings{}, core.ErrInvalidInput
	}
	if input.CashLocationRequired && input.RestaurantLatitude == 0 && input.RestaurantLongitude == 0 {
		return core.Settings{}, core.ErrInvalidInput
	}
	if input.CardEnabled || input.CryptoEnabled {
		return core.Settings{}, core.ErrInvalidInput
	}
	if input.PickupMinLeadMinutes < 15 || input.PickupMinLeadMinutes > 180 ||
		!validPickupSlotMinutes(input.PickupSlotMinutes) || input.PickupMaxOrdersPerSlot < 1 || input.PickupMaxOrdersPerSlot > 20 ||
		!validClock(input.PickupLastTime) || !optionalText(input.PickupAddress, maxAddressLength) ||
		!validOptionalURL(input.PickupMapURL) || !optionalText(input.PickupInstructionsRU, maxSupportTextLength) ||
		!optionalText(input.PickupInstructionsSR, maxSupportTextLength) || !optionalText(input.PickupInstructionsEN, maxSupportTextLength) {
		return core.Settings{}, core.ErrInvalidInput
	}
	if input.PickupEnabled && strings.TrimSpace(input.PickupAddress) == "" {
		return core.Settings{}, core.ErrInvalidInput
	}
	if input.DeliveryMinLeadMinutes != 30 || input.DeliverySlotMinutes != 30 || input.DeliveryMaxOrdersPerSlot != 1 ||
		strings.TrimSpace(input.DeliveryLastTargetTime) != "21:00" {
		return core.Settings{}, core.ErrInvalidInput
	}
	before, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	defer rollback(ctx, tx)
	result, err := tx.Exec(ctx, `
		UPDATE app_settings
		SET flat_delivery_fee_minor=$1, support_text=$2, support_phone=$3, terms_url=$4,
			max_item_quantity=$5, max_comment_length=$6, cash_enabled=$7, card_enabled=false,
			crypto_enabled=false, cash_location_required=$8, restaurant_latitude=$9, restaurant_longitude=$10,
			cash_location_radius_meters=$11, cash_location_ttl_seconds=$12,
			cash_location_max_accuracy_meters=$13, pickup_enabled=$14, pickup_address=$15,
			pickup_map_url=$16, pickup_instructions_ru=$17, pickup_instructions_sr=$18,
			pickup_instructions_en=$19, pickup_min_lead_minutes=$20, pickup_slot_minutes=$21,
			pickup_max_orders_per_slot=$22, pickup_last_time=$23::time, delivery_timing_enabled=$24,
			delivery_min_lead_minutes=$25, delivery_slot_minutes=$26, delivery_max_orders_per_slot=$27,
			delivery_last_target_time=$28::time, version=version+1, updated_at=now()
		WHERE id=true AND version=$29
	`, input.FlatDeliveryFeeMinor, safe(input.SupportText), safe(input.SupportPhone), safe(input.TermsURL),
		input.MaxItemQuantity, input.MaxCommentLength, input.CashEnabled, input.CashLocationRequired,
		input.RestaurantLatitude, input.RestaurantLongitude, input.CashLocationRadiusMeters,
		input.CashLocationTTLSeconds, input.CashLocationMaxAccuracyMeters, input.PickupEnabled,
		safe(input.PickupAddress), safe(input.PickupMapURL), safe(input.PickupInstructionsRU),
		safe(input.PickupInstructionsSR), safe(input.PickupInstructionsEN), input.PickupMinLeadMinutes,
		input.PickupSlotMinutes, input.PickupMaxOrdersPerSlot, input.PickupLastTime,
		input.DeliveryTimingEnabled, input.DeliveryMinLeadMinutes, input.DeliverySlotMinutes,
		input.DeliveryMaxOrdersPerSlot, input.DeliveryLastTargetTime, input.Version)
	if err != nil {
		return core.Settings{}, err
	}
	if result.RowsAffected() == 0 {
		return core.Settings{}, core.ErrOrderStatusConflict
	}
	afterAudit := before
	afterAudit.FlatDeliveryFeeMinor = input.FlatDeliveryFeeMinor
	afterAudit.SupportText = safe(input.SupportText)
	afterAudit.SupportPhone = safe(input.SupportPhone)
	afterAudit.TermsURL = safe(input.TermsURL)
	afterAudit.MaxItemQuantity = input.MaxItemQuantity
	afterAudit.MaxCommentLength = input.MaxCommentLength
	afterAudit.CashEnabled = input.CashEnabled
	afterAudit.CardEnabled = false
	afterAudit.CryptoEnabled = false
	afterAudit.CashLocationRequired = input.CashLocationRequired
	afterAudit.RestaurantLatitude = input.RestaurantLatitude
	afterAudit.RestaurantLongitude = input.RestaurantLongitude
	afterAudit.CashLocationRadiusMeters = input.CashLocationRadiusMeters
	afterAudit.CashLocationTTLSeconds = input.CashLocationTTLSeconds
	afterAudit.CashLocationMaxAccuracyMeters = input.CashLocationMaxAccuracyMeters
	afterAudit.PickupEnabled = input.PickupEnabled
	afterAudit.PickupAddress = safe(input.PickupAddress)
	afterAudit.PickupMapURL = safe(input.PickupMapURL)
	afterAudit.PickupInstructionsRU = safe(input.PickupInstructionsRU)
	afterAudit.PickupInstructionsSR = safe(input.PickupInstructionsSR)
	afterAudit.PickupInstructionsEN = safe(input.PickupInstructionsEN)
	afterAudit.PickupMinLeadMinutes = input.PickupMinLeadMinutes
	afterAudit.PickupSlotMinutes = input.PickupSlotMinutes
	afterAudit.PickupMaxOrdersPerSlot = input.PickupMaxOrdersPerSlot
	afterAudit.PickupLastTime = input.PickupLastTime
	afterAudit.DeliveryTimingEnabled = input.DeliveryTimingEnabled
	afterAudit.DeliveryMinLeadMinutes = input.DeliveryMinLeadMinutes
	afterAudit.DeliverySlotMinutes = input.DeliverySlotMinutes
	afterAudit.DeliveryMaxOrdersPerSlot = input.DeliveryMaxOrdersPerSlot
	afterAudit.DeliveryLastTargetTime = input.DeliveryLastTargetTime
	afterAudit.Version = before.Version + 1
	if err := s.insertAuditTx(ctx, tx, sess, "settings.update", "app_settings", nil, "", safeSettingsAudit(before), safeSettingsAudit(afterAudit)); err != nil {
		return core.Settings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Settings{}, err
	}
	after, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	return after, nil
}

func (s *Store) UpdateSchedule(ctx context.Context, sess core.Session, input []core.ScheduleDay) ([]core.ScheduleDay, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	days, err := core.ValidateSchedule(input)
	if err != nil {
		return nil, err
	}
	before, err := s.Schedule(ctx)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer rollback(ctx, tx)
	for _, day := range days {
		_, err := tx.Exec(ctx, `
			INSERT INTO restaurant_schedule (day_of_week, closed, open_time, order_cutoff_time, close_time)
			VALUES ($1, $2, $3::time, $4::time, $5::time)
			ON CONFLICT (day_of_week)
			DO UPDATE SET closed=EXCLUDED.closed, open_time=EXCLUDED.open_time,
				order_cutoff_time=EXCLUDED.order_cutoff_time, close_time=EXCLUDED.close_time,
				version=restaurant_schedule.version+1, updated_at=now()
		`, day.DayOfWeek, day.Closed, day.OpenTime, day.OrderCutoffTime, day.CloseTime)
		if err != nil {
			return nil, err
		}
	}
	if err := bumpRuntimeRevisionTx(ctx, tx); err != nil {
		return nil, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "schedule.update", "restaurant_schedule", nil, "", map[string]any{"schedule": before}, map[string]any{"schedule": days}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Schedule(ctx)
}

func (s *Store) Menu(ctx context.Context, locale string) ([]core.Category, error) {
	_, categories, err := s.MenuWithRevision(ctx, locale)
	return categories, err
}

func (s *Store) MenuWithRevision(ctx context.Context, locale string) (int64, []core.Category, error) {
	catRows, err := s.pool.Query(ctx, `
		SELECT s.menu_revision, COALESCE(c.id::text, ''), COALESCE(c.title_ru, ''), COALESCE(c.title_sr, ''),
			COALESCE(c.title_en, ''), COALESCE(c.sort_order, 0)
		FROM app_settings s
		LEFT JOIN categories c ON c.visible=true AND c.archived=false
		WHERE s.id=true
		ORDER BY c.sort_order NULLS LAST, c.title_ru NULLS LAST
	`)
	if err != nil {
		return 0, nil, err
	}
	defer catRows.Close()
	var revision int64
	categories := make([]core.Category, 0)
	index := map[uuid.UUID]int{}
	for catRows.Next() {
		var idText string
		var titleRU, titleSR, titleEN string
		var sortOrder int
		if err := catRows.Scan(&revision, &idText, &titleRU, &titleSR, &titleEN, &sortOrder); err != nil {
			return 0, nil, err
		}
		if idText == "" {
			continue
		}
		id, err := uuid.Parse(idText)
		if err != nil {
			return 0, nil, err
		}
		index[id] = len(categories)
		categories = append(categories, core.Category{ID: id, Title: localized(locale, titleRU, titleSR, titleEN), SortOrder: sortOrder})
	}
	if err := catRows.Err(); err != nil {
		return 0, nil, err
	}

	itemRows, err := s.pool.Query(ctx, `
		SELECT id, category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
			discounted_price_minor, price_minor, discount_percent, currency, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en,
			sort_order, version,
			COALESCE(mm.thumbnail_path, ''), COALESCE(mm.thumbnail_width, 0), COALESCE(mm.thumbnail_height, 0),
			COALESCE(mm.display_width, 0), COALESCE(mm.display_height, 0)
		FROM menu_items mi
		LEFT JOIN menu_media mm ON mm.display_path=mi.photo_path
		WHERE mi.visible=true AND mi.archived=false
		ORDER BY CASE WHEN mi.discount_percent > 0 THEN 0 ELSE 1 END, mi.sort_order, mi.title_ru
	`)
	if err != nil {
		return 0, nil, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var item core.MenuItem
		var titleRU, titleSR, titleEN, descRU, descSR, descEN, allergenRU, allergenSR, allergenEN string
		var thumbnailPath string
		var thumbnailWidth, thumbnailHeight, displayWidth, displayHeight int
		if err := itemRows.Scan(
			&item.ID, &item.CategoryID, &titleRU, &titleSR, &titleEN, &descRU, &descSR, &descEN,
			&item.PriceMinor, &item.OriginalPriceMinor, &item.DiscountPercent, &item.Currency, &item.PhotoPath, &item.WeightText, &item.MinQuantity, &allergenRU, &allergenSR, &allergenEN,
			&item.SortOrder, &item.Version, &thumbnailPath, &thumbnailWidth, &thumbnailHeight, &displayWidth, &displayHeight,
		); err != nil {
			return 0, nil, err
		}
		item.Title = localized(locale, titleRU, titleSR, titleEN)
		item.Description = localized(locale, descRU, descSR, descEN)
		item.AllergenText = localized(locale, allergenRU, allergenSR, allergenEN)
		item.PhotoVariants = menuPhotoVariants(item.PhotoPath, thumbnailPath, thumbnailWidth, thumbnailHeight, displayWidth, displayHeight)
		if pos, ok := index[item.CategoryID]; ok {
			categories[pos].Items = append(categories[pos].Items, item)
		}
	}
	return revision, categories, itemRows.Err()
}

func (s *Store) AdminMenu(ctx context.Context, sess core.Session) ([]core.AdminCategory, []core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, nil, core.ErrForbidden
	}
	categories, err := s.AdminCategories(ctx, sess)
	if err != nil {
		return nil, nil, err
	}
	items, err := s.AdminMenuItems(ctx, sess)
	return categories, items, err
}

func (s *Store) AdminCategories(ctx context.Context, sess core.Session) ([]core.AdminCategory, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.title_ru, c.title_sr, c.title_en, c.sort_order, c.visible, c.archived,
			COUNT(mi.id)::int AS item_count, c.version, c.created_at, c.updated_at
		FROM categories c
		LEFT JOIN menu_items mi ON mi.category_id=c.id AND mi.archived=false
		GROUP BY c.id
		ORDER BY c.archived, c.sort_order, c.title_ru
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	categories := []core.AdminCategory{}
	for rows.Next() {
		var cat core.AdminCategory
		if err := rows.Scan(&cat.ID, &cat.TitleRU, &cat.TitleSR, &cat.TitleEN, &cat.SortOrder, &cat.Visible, &cat.Archived, &cat.ItemCount, &cat.Version, &cat.CreatedAt, &cat.UpdatedAt); err != nil {
			return nil, err
		}
		categories = append(categories, cat)
	}
	return categories, rows.Err()
}

func (s *Store) AdminMenuItems(ctx context.Context, sess core.Session) ([]core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT mi.id, mi.category_id, mi.title_ru, mi.title_sr, mi.title_en, mi.description_ru, mi.description_sr,
			mi.description_en, mi.price_minor, mi.discount_percent, mi.discounted_price_minor, mi.currency, mi.photo_path, mi.weight_text, mi.min_quantity,
			mi.allergen_text_ru, mi.allergen_text_sr, mi.allergen_text_en, mi.sort_order, mi.visible, mi.archived,
			EXISTS (SELECT 1 FROM order_items oi WHERE oi.menu_item_id=mi.id) AS used_in_orders,
			mi.version, mi.created_at, mi.updated_at,
			COALESCE(mm.thumbnail_path, ''), COALESCE(mm.thumbnail_width, 0), COALESCE(mm.thumbnail_height, 0),
			COALESCE(mm.display_width, 0), COALESCE(mm.display_height, 0)
		FROM menu_items mi
		LEFT JOIN menu_media mm ON mm.display_path=mi.photo_path
		ORDER BY mi.archived, mi.sort_order, mi.title_ru
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []core.AdminMenuItem{}
	for rows.Next() {
		var item core.AdminMenuItem
		var thumbnailPath string
		var thumbnailWidth, thumbnailHeight, displayWidth, displayHeight int
		if err := rows.Scan(
			&item.ID, &item.CategoryID, &item.TitleRU, &item.TitleSR, &item.TitleEN, &item.DescriptionRU, &item.DescriptionSR,
			&item.DescriptionEN, &item.PriceMinor, &item.DiscountPercent, &item.DiscountedPriceMinor, &item.Currency, &item.PhotoPath, &item.WeightText, &item.MinQuantity,
			&item.AllergenTextRU, &item.AllergenTextSR, &item.AllergenTextEN, &item.SortOrder, &item.Visible, &item.Archived, &item.UsedInOrders,
			&item.Version, &item.CreatedAt, &item.UpdatedAt, &thumbnailPath, &thumbnailWidth, &thumbnailHeight, &displayWidth, &displayHeight,
		); err != nil {
			return nil, err
		}
		item.PhotoVariants = menuPhotoVariants(item.PhotoPath, thumbnailPath, thumbnailWidth, thumbnailHeight, displayWidth, displayHeight)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) RecordMenuMedia(ctx context.Context, input MenuMediaInput) error {
	if !validMenuMediaInput(input) {
		return core.ErrInvalidInput
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO menu_media (
			display_path, thumbnail_path, display_width, display_height, display_bytes,
			display_mime, thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
		)
		VALUES ($1, $2, $3, $4, $5, 'image/jpeg', $6, $7, $8, 'image/jpeg')
		ON CONFLICT (display_path) DO UPDATE SET
			thumbnail_path=EXCLUDED.thumbnail_path,
			display_width=EXCLUDED.display_width,
			display_height=EXCLUDED.display_height,
			display_bytes=EXCLUDED.display_bytes,
			display_mime=EXCLUDED.display_mime,
			thumbnail_width=EXCLUDED.thumbnail_width,
			thumbnail_height=EXCLUDED.thumbnail_height,
			thumbnail_bytes=EXCLUDED.thumbnail_bytes,
			thumbnail_mime=EXCLUDED.thumbnail_mime
	`, safe(input.DisplayPath), safe(input.ThumbnailPath), input.DisplayWidth, input.DisplayHeight, input.DisplayBytes, input.ThumbnailWidth, input.ThumbnailHeight, input.ThumbnailBytes)
	return err
}

func bumpMenuRevisionTx(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		UPDATE app_settings
		SET menu_revision=menu_revision+1, updated_at=now()
		WHERE id=true
	`)
	return err
}

func bumpRuntimeRevisionTx(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `
		UPDATE app_settings
		SET version=version+1, updated_at=now()
		WHERE id=true
	`)
	return err
}

func (s *Store) CreateCategory(ctx context.Context, sess core.Session, input UpsertCategoryInput) (core.AdminCategory, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminCategory{}, core.ErrForbidden
	}
	if !validCategoryInput(input) {
		return core.AdminCategory{}, core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminCategory{}, err
	}
	defer rollback(ctx, tx)
	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO categories (title_ru, title_sr, title_en, sort_order, visible)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, safe(input.TitleRU), safe(input.TitleSR), safe(input.TitleEN), input.SortOrder, input.Visible).Scan(&id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminCategory{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "category.create", "category", &id, "", nil, map[string]any{"title_ru": safe(input.TitleRU)}); err != nil {
		return core.AdminCategory{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminCategory{}, err
	}
	return s.adminCategoryByID(ctx, id)
}

func (s *Store) UpdateCategory(ctx context.Context, sess core.Session, id uuid.UUID, input UpsertCategoryInput) (core.AdminCategory, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminCategory{}, core.ErrForbidden
	}
	if !validCategoryInput(input) || input.Version <= 0 {
		return core.AdminCategory{}, core.ErrInvalidInput
	}
	before, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminCategory{}, err
	}
	defer rollback(ctx, tx)
	result, err := tx.Exec(ctx, `
		UPDATE categories
		SET title_ru=$1, title_sr=$2, title_en=$3, sort_order=$4, visible=$5, version=version+1, updated_at=now()
		WHERE id=$6 AND version=$7 AND archived=false
	`, safe(input.TitleRU), safe(input.TitleSR), safe(input.TitleEN), input.SortOrder, input.Visible, id, input.Version)
	if err != nil {
		return core.AdminCategory{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminCategory{}, core.ErrOrderStatusConflict
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminCategory{}, err
	}
	afterAudit := before
	afterAudit.TitleRU = safe(input.TitleRU)
	afterAudit.TitleSR = safe(input.TitleSR)
	afterAudit.TitleEN = safe(input.TitleEN)
	afterAudit.SortOrder = input.SortOrder
	afterAudit.Visible = input.Visible
	afterAudit.Version = before.Version + 1
	if err := s.insertAuditTx(ctx, tx, sess, "category.update", "category", &id, "", categoryAudit(before), categoryAudit(afterAudit)); err != nil {
		return core.AdminCategory{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminCategory{}, err
	}
	after, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	return after, nil
}

func (s *Store) ArchiveCategory(ctx context.Context, sess core.Session, id uuid.UUID, reason string) (core.AdminCategory, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminCategory{}, core.ErrForbidden
	}
	before, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminCategory{}, err
	}
	defer rollback(ctx, tx)
	result, err := tx.Exec(ctx, `
		UPDATE categories SET visible=false, archived=true, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=false
	`, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminCategory{}, core.ErrOrderStatusConflict
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminCategory{}, err
	}
	afterAudit := before
	afterAudit.Visible = false
	afterAudit.Archived = true
	afterAudit.Version = before.Version + 1
	if err := s.insertAuditTx(ctx, tx, sess, "category.archive", "category", &id, safe(reason), categoryAudit(before), categoryAudit(afterAudit)); err != nil {
		return core.AdminCategory{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminCategory{}, err
	}
	after, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	return after, nil
}

func (s *Store) RestoreCategory(ctx context.Context, sess core.Session, id uuid.UUID, reason string) (core.AdminCategory, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminCategory{}, core.ErrForbidden
	}
	before, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminCategory{}, err
	}
	defer rollback(ctx, tx)
	result, err := tx.Exec(ctx, `
		UPDATE categories SET visible=true, archived=false, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=true
	`, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminCategory{}, core.ErrOrderStatusConflict
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminCategory{}, err
	}
	afterAudit := before
	afterAudit.Visible = true
	afterAudit.Archived = false
	afterAudit.Version = before.Version + 1
	if err := s.insertAuditTx(ctx, tx, sess, "category.restore", "category", &id, safe(reason), categoryAudit(before), categoryAudit(afterAudit)); err != nil {
		return core.AdminCategory{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminCategory{}, err
	}
	after, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	return after, nil
}

func (s *Store) DeleteOrArchiveCategory(ctx context.Context, sess core.Session, id uuid.UUID, reason string) (string, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return "", core.ErrForbidden
	}
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM menu_items WHERE category_id=$1`, id).Scan(&count); err != nil {
		return "", err
	}
	if count == 0 {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return "", err
		}
		defer rollback(ctx, tx)
		_, err = tx.Exec(ctx, `DELETE FROM categories WHERE id=$1`, id)
		if err != nil {
			return "", err
		}
		if err := bumpMenuRevisionTx(ctx, tx); err != nil {
			return "", err
		}
		if err := s.insertAuditTx(ctx, tx, sess, "category.delete", "category", &id, safe(reason), nil, nil); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return "deleted", nil
	}
	_, err := s.ArchiveCategory(ctx, sess, id, reason)
	return "archived", err
}

func (s *Store) CreateMenuItem(ctx context.Context, sess core.Session, input UpsertMenuItemInput) (core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminMenuItem{}, core.ErrForbidden
	}
	if !validMenuItemInput(input) {
		return core.AdminMenuItem{}, core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	defer rollback(ctx, tx)
	var id uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_items (
			category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
			price_minor, discount_percent, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en,
			sort_order, visible
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		RETURNING id
	`, input.CategoryID, safe(input.TitleRU), safe(input.TitleSR), safe(input.TitleEN), safe(input.DescriptionRU), safe(input.DescriptionSR),
		safe(input.DescriptionEN), input.PriceMinor, input.DiscountPercent, safe(input.PhotoPath), safe(input.WeightText), input.MinQuantity,
		safe(input.AllergenTextRU), safe(input.AllergenTextSR), safe(input.AllergenTextEN), input.SortOrder, input.Visible).Scan(&id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminMenuItem{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "menu_item.create", "menu_item", &id, "", nil, map[string]any{"title_ru": safe(input.TitleRU), "price_minor": input.PriceMinor, "discount_percent": input.DiscountPercent}); err != nil {
		return core.AdminMenuItem{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminMenuItem{}, err
	}
	return s.adminMenuItemByID(ctx, id)
}

func (s *Store) UpdateMenuItem(ctx context.Context, sess core.Session, id uuid.UUID, input UpsertMenuItemInput) (core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminMenuItem{}, core.ErrForbidden
	}
	if !validMenuItemInput(input) || input.Version <= 0 {
		return core.AdminMenuItem{}, core.ErrInvalidInput
	}
	before, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	defer rollback(ctx, tx)
	result, err := tx.Exec(ctx, `
		UPDATE menu_items
		SET category_id=$1, title_ru=$2, title_sr=$3, title_en=$4, description_ru=$5, description_sr=$6,
			description_en=$7, price_minor=$8, discount_percent=$9, photo_path=$10, weight_text=$11, min_quantity=$12,
			allergen_text_ru=$13, allergen_text_sr=$14, allergen_text_en=$15, sort_order=$16, visible=$17,
			version=version+1, updated_at=now()
		WHERE id=$18 AND version=$19 AND archived=false
	`, input.CategoryID, safe(input.TitleRU), safe(input.TitleSR), safe(input.TitleEN), safe(input.DescriptionRU), safe(input.DescriptionSR),
		safe(input.DescriptionEN), input.PriceMinor, input.DiscountPercent, safe(input.PhotoPath), safe(input.WeightText), input.MinQuantity,
		safe(input.AllergenTextRU), safe(input.AllergenTextSR), safe(input.AllergenTextEN), input.SortOrder, input.Visible, id, input.Version)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminMenuItem{}, core.ErrOrderStatusConflict
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminMenuItem{}, err
	}
	afterAudit := before
	afterAudit.CategoryID = input.CategoryID
	afterAudit.TitleRU = safe(input.TitleRU)
	afterAudit.TitleSR = safe(input.TitleSR)
	afterAudit.TitleEN = safe(input.TitleEN)
	afterAudit.DescriptionRU = safe(input.DescriptionRU)
	afterAudit.DescriptionSR = safe(input.DescriptionSR)
	afterAudit.DescriptionEN = safe(input.DescriptionEN)
	afterAudit.PriceMinor = input.PriceMinor
	afterAudit.DiscountPercent = input.DiscountPercent
	afterAudit.DiscountedPriceMinor = discountedPrice(input.PriceMinor, input.DiscountPercent)
	afterAudit.PhotoPath = safe(input.PhotoPath)
	afterAudit.WeightText = safe(input.WeightText)
	afterAudit.MinQuantity = input.MinQuantity
	afterAudit.AllergenTextRU = safe(input.AllergenTextRU)
	afterAudit.AllergenTextSR = safe(input.AllergenTextSR)
	afterAudit.AllergenTextEN = safe(input.AllergenTextEN)
	afterAudit.SortOrder = input.SortOrder
	afterAudit.Visible = input.Visible
	afterAudit.Version = before.Version + 1
	action := "menu_item.update"
	reason := ""
	if before.PriceMinor != afterAudit.PriceMinor || before.DiscountPercent != afterAudit.DiscountPercent {
		action = "menu_item.price_change"
		reason = fmt.Sprintf("%d/%d%% -> %d/%d%%", before.PriceMinor, before.DiscountPercent, afterAudit.PriceMinor, afterAudit.DiscountPercent)
	}
	if err := s.insertAuditTx(ctx, tx, sess, action, "menu_item", &id, reason, menuItemAudit(before), menuItemAudit(afterAudit)); err != nil {
		return core.AdminMenuItem{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminMenuItem{}, err
	}
	after, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	return after, nil
}

func (s *Store) ArchiveMenuItem(ctx context.Context, sess core.Session, id uuid.UUID, reason string) (core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminMenuItem{}, core.ErrForbidden
	}
	before, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	defer rollback(ctx, tx)
	result, err := tx.Exec(ctx, `
		UPDATE menu_items SET visible=false, archived=true, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=false
	`, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminMenuItem{}, core.ErrOrderStatusConflict
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminMenuItem{}, err
	}
	afterAudit := before
	afterAudit.Visible = false
	afterAudit.Archived = true
	afterAudit.Version = before.Version + 1
	if err := s.insertAuditTx(ctx, tx, sess, "menu_item.archive", "menu_item", &id, safe(reason), menuItemAudit(before), menuItemAudit(afterAudit)); err != nil {
		return core.AdminMenuItem{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminMenuItem{}, err
	}
	after, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	return after, nil
}

func (s *Store) RestoreMenuItem(ctx context.Context, sess core.Session, id uuid.UUID, reason string) (core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminMenuItem{}, core.ErrForbidden
	}
	before, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	defer rollback(ctx, tx)
	result, err := tx.Exec(ctx, `
		UPDATE menu_items SET visible=true, archived=false, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=true
	`, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminMenuItem{}, core.ErrOrderStatusConflict
	}
	if err := bumpMenuRevisionTx(ctx, tx); err != nil {
		return core.AdminMenuItem{}, err
	}
	afterAudit := before
	afterAudit.Visible = true
	afterAudit.Archived = false
	afterAudit.Version = before.Version + 1
	if err := s.insertAuditTx(ctx, tx, sess, "menu_item.restore", "menu_item", &id, safe(reason), menuItemAudit(before), menuItemAudit(afterAudit)); err != nil {
		return core.AdminMenuItem{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.AdminMenuItem{}, err
	}
	after, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	return after, nil
}

func (s *Store) DeleteOrArchiveMenuItem(ctx context.Context, sess core.Session, id uuid.UUID, reason string) (string, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return "", core.ErrForbidden
	}
	var used bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM order_items WHERE menu_item_id=$1)`, id).Scan(&used); err != nil {
		return "", err
	}
	if !used {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return "", err
		}
		defer rollback(ctx, tx)
		_, err = tx.Exec(ctx, `DELETE FROM menu_items WHERE id=$1`, id)
		if err != nil {
			return "", err
		}
		if err := bumpMenuRevisionTx(ctx, tx); err != nil {
			return "", err
		}
		if err := s.insertAuditTx(ctx, tx, sess, "menu_item.delete", "menu_item", &id, safe(reason), nil, nil); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return "deleted", nil
	}
	_, err := s.ArchiveMenuItem(ctx, sess, id, reason)
	return "archived", err
}

func (s *Store) Calculate(ctx context.Context, sess core.Session, input []core.CartItemInput, now time.Time) (core.Calculation, error) {
	return s.CalculateForFulfillment(ctx, sess, input, core.FulfillmentDelivery, now)
}

func (s *Store) CalculateForFulfillment(ctx context.Context, sess core.Session, input []core.CartItemInput, fulfillmentType core.FulfillmentType, now time.Time) (core.Calculation, error) {
	return s.CalculateForFulfillmentTiming(ctx, sess, input, fulfillmentType, DeliveryTimingInput{}, now)
}

func (s *Store) CalculateForFulfillmentTiming(ctx context.Context, sess core.Session, input []core.CartItemInput, fulfillmentType core.FulfillmentType, timing DeliveryTimingInput, now time.Time) (core.Calculation, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Calculation{}, core.ErrForbidden
	}
	fulfillmentType, err := normalizeFulfillmentType(fulfillmentType)
	if err != nil {
		return core.Calculation{}, err
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.Calculation{}, err
	}
	quantities := map[uuid.UUID]int{}
	ids := []uuid.UUID{}
	for _, item := range input {
		if item.Quantity <= 0 || item.Quantity > settings.MaxItemQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
		if _, ok := quantities[item.ItemID]; !ok {
			ids = append(ids, item.ItemID)
		}
		quantities[item.ItemID] += item.Quantity
		if quantities[item.ItemID] > settings.MaxItemQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
	}
	if len(quantities) == 0 {
		return core.Calculation{}, core.ErrInvalidQuantity
	}

	calc := core.Calculation{
		FulfillmentType:  fulfillmentType,
		Items:            make([]core.CalculatedItem, 0, len(quantities)),
		DeliveryFeeMinor: settings.FlatDeliveryFeeMinor,
		Currency:         settings.Currency,
		ExpiresAt:        now.UTC().Add(10 * time.Minute),
	}
	if fulfillmentType == core.FulfillmentPickup {
		calc.DeliveryFeeMinor = 0
	} else if settings.DeliveryTimingEnabled && s.deliveryTimingAccess(sess.TelegramUserID) {
		target, delay, err := s.resolveDeliveryTiming(ctx, timing, settings, now)
		if err != nil {
			return core.Calculation{}, err
		}
		calc.DeliveryTargetAt = &target
		calc.DeliveryQueueDelayMinutes = delay
	} else if timing.RequestedAt != nil || (timing.Mode != "" && !strings.EqualFold(timing.Mode, "ASAP")) {
		return core.Calculation{}, core.ErrDeliveryTimingUnavailable
	}
	rows, err := s.pool.Query(ctx, `
			SELECT mi.id, mi.title_ru, mi.discounted_price_minor, mi.version, mi.min_quantity
			FROM menu_items mi
			JOIN categories c ON c.id=mi.category_id
			WHERE mi.id=ANY($1) AND mi.visible=true AND mi.archived=false AND c.visible=true AND c.archived=false
	`, ids)
	if err != nil {
		return core.Calculation{}, err
	}
	defer rows.Close()
	type menuCalcRow struct {
		title       string
		price       int
		version     int
		minQuantity int
	}
	menuRows := map[uuid.UUID]menuCalcRow{}
	for rows.Next() {
		var id uuid.UUID
		var row menuCalcRow
		if err := rows.Scan(&id, &row.title, &row.price, &row.version, &row.minQuantity); err != nil {
			return core.Calculation{}, err
		}
		menuRows[id] = row
	}
	if err := rows.Err(); err != nil {
		return core.Calculation{}, err
	}
	if len(menuRows) != len(ids) {
		return core.Calculation{}, core.ErrItemUnavailable
	}
	for _, id := range ids {
		qty := quantities[id]
		row := menuRows[id]
		if qty < row.minQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
		line := row.price * qty
		calc.SubtotalMinor += line
		calc.Items = append(calc.Items, core.CalculatedItem{
			ItemID:         id,
			Title:          row.title,
			UnitPriceMinor: row.price,
			Quantity:       qty,
			LineTotalMinor: line,
			Version:        row.version,
		})
	}
	calc.TotalMinor = calc.SubtotalMinor + calc.DeliveryFeeMinor

	token, tokenHash, err := randomToken()
	if err != nil {
		return core.Calculation{}, err
	}
	itemsJSON, err := json.Marshal(calc.Items)
	if err != nil {
		return core.Calculation{}, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO calculation_tokens (token_hash, user_id, items_json, fulfillment_type, subtotal_minor, delivery_fee_minor,
			total_minor, currency, expires_at, purpose)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'order')
	`, tokenHash, sess.UserID, itemsJSON, string(calc.FulfillmentType), calc.SubtotalMinor, calc.DeliveryFeeMinor, calc.TotalMinor, calc.Currency, calc.ExpiresAt)
	if err != nil {
		return core.Calculation{}, err
	}
	calc.Token = token
	return calc, nil
}

func (s *Store) CalculateAddition(ctx context.Context, sess core.Session, orderID uuid.UUID, input []core.CartItemInput, now time.Time) (core.Calculation, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Calculation{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.Calculation{}, err
	}
	accept := core.CanAcceptOrder(now, settings)
	if !accept.OK {
		if accept.Reason == "manual_day_off" {
			return core.Calculation{}, core.ErrManualDayOff
		}
		return core.Calculation{}, core.ErrRestaurantClosed
	}

	var status core.FulfillmentStatus
	var fulfillmentType core.FulfillmentType
	var paymentMethod core.PaymentMethod
	var createdAt time.Time
	var pickupAt, pickupCookAt, kitchenStartedAt sql.NullTime
	var orderSubtotal, orderDelivery, orderTotal int
	var orderCurrency string
	err = s.pool.QueryRow(ctx, `
		SELECT fulfillment_status, fulfillment_type, payment_method, created_at, pickup_at, pickup_cook_at, kitchen_started_at,
			subtotal_minor, delivery_fee_minor, total_minor, currency
		FROM orders
		WHERE id=$1 AND client_user_id=$2
	`, orderID, sess.UserID).Scan(&status, &fulfillmentType, &paymentMethod, &createdAt, &pickupAt, &pickupCookAt, &kitchenStartedAt, &orderSubtotal, &orderDelivery, &orderTotal, &orderCurrency)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Calculation{}, core.ErrForbidden
	}
	if err != nil {
		return core.Calculation{}, err
	}
	if status != core.StatusNew || paymentMethod != core.PaymentCash || kitchenStartedAt.Valid {
		return core.Calculation{}, core.ErrOrderStatusConflict
	}
	if !now.UTC().Before(additionCutoff(createdAt, pickupAt, pickupCookAt, fulfillmentType, settings)) {
		return core.Calculation{}, core.ErrOrderStatusConflict
	}
	var alreadyAdded bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM order_additions WHERE order_id=$1)`, orderID).Scan(&alreadyAdded); err != nil {
		return core.Calculation{}, err
	}
	if alreadyAdded {
		return core.Calculation{}, core.ErrOrderStatusConflict
	}

	existing, err := s.orderItemQuantities(ctx, orderID)
	if err != nil {
		return core.Calculation{}, err
	}
	calc, err := s.calculateItems(ctx, sess.UserID, input, existing, settings, now, "addition", orderID)
	if err != nil {
		return core.Calculation{}, err
	}
	if calc.Currency != orderCurrency {
		return core.Calculation{}, core.ErrCalculationExpired
	}
	calc.DeliveryFeeMinor = 0
	calc.TotalMinor = calc.SubtotalMinor
	calc.OrderSubtotalMinor = orderSubtotal + calc.SubtotalMinor
	calc.OrderTotalMinor = orderTotal + calc.SubtotalMinor
	return calc, nil
}

func (s *Store) calculateItems(ctx context.Context, userID uuid.UUID, input []core.CartItemInput, existing map[uuid.UUID]int, settings core.Settings, now time.Time, purpose string, orderID uuid.UUID) (core.Calculation, error) {
	quantities := map[uuid.UUID]int{}
	ids := []uuid.UUID{}
	for _, item := range input {
		if item.Quantity <= 0 || item.Quantity > settings.MaxItemQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
		if _, ok := quantities[item.ItemID]; !ok {
			ids = append(ids, item.ItemID)
		}
		quantities[item.ItemID] += item.Quantity
		if quantities[item.ItemID] > settings.MaxItemQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
	}
	if len(quantities) == 0 {
		return core.Calculation{}, core.ErrInvalidQuantity
	}

	calc := core.Calculation{
		FulfillmentType:  core.FulfillmentDelivery,
		Items:            make([]core.CalculatedItem, 0, len(quantities)),
		DeliveryFeeMinor: 0,
		Currency:         settings.Currency,
		ExpiresAt:        now.UTC().Add(10 * time.Minute),
	}
	rows, err := s.pool.Query(ctx, `
			SELECT mi.id, mi.title_ru, mi.discounted_price_minor, mi.version, mi.min_quantity
			FROM menu_items mi
			JOIN categories c ON c.id=mi.category_id
			WHERE mi.id=ANY($1) AND mi.visible=true AND mi.archived=false AND c.visible=true AND c.archived=false
	`, ids)
	if err != nil {
		return core.Calculation{}, err
	}
	defer rows.Close()
	type menuCalcRow struct {
		title       string
		price       int
		version     int
		minQuantity int
	}
	menuRows := map[uuid.UUID]menuCalcRow{}
	for rows.Next() {
		var id uuid.UUID
		var row menuCalcRow
		if err := rows.Scan(&id, &row.title, &row.price, &row.version, &row.minQuantity); err != nil {
			return core.Calculation{}, err
		}
		menuRows[id] = row
	}
	if err := rows.Err(); err != nil {
		return core.Calculation{}, err
	}
	if len(menuRows) != len(ids) {
		return core.Calculation{}, core.ErrItemUnavailable
	}
	for _, id := range ids {
		qty := quantities[id]
		row := menuRows[id]
		existingQty := existing[id]
		if existingQty == 0 && qty < row.minQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
		if existingQty+qty > settings.MaxItemQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
		line := row.price * qty
		calc.SubtotalMinor += line
		calc.Items = append(calc.Items, core.CalculatedItem{
			ItemID:         id,
			Title:          row.title,
			UnitPriceMinor: row.price,
			Quantity:       qty,
			LineTotalMinor: line,
			Version:        row.version,
		})
	}
	calc.TotalMinor = calc.SubtotalMinor

	token, tokenHash, err := randomToken()
	if err != nil {
		return core.Calculation{}, err
	}
	itemsJSON, err := json.Marshal(calc.Items)
	if err != nil {
		return core.Calculation{}, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO calculation_tokens (token_hash, user_id, items_json, subtotal_minor, delivery_fee_minor,
			total_minor, currency, expires_at, purpose, order_id)
		VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)
	`, tokenHash, userID, itemsJSON, calc.SubtotalMinor, calc.TotalMinor, calc.Currency, calc.ExpiresAt, purpose, uuidSQL(&orderID))
	if err != nil {
		return core.Calculation{}, err
	}
	calc.Token = token
	return calc, nil
}

func (s *Store) revalidateCalculationTx(ctx context.Context, tx pgx.Tx, items []core.CalculatedItem, storedSubtotal, storedDelivery, storedTotal int, storedCurrency string, fulfillmentType core.FulfillmentType) ([]core.CalculatedItem, int, int, int, string, error) {
	if len(items) == 0 {
		return nil, 0, 0, 0, "", core.ErrInvalidQuantity
	}

	var currentCurrency string
	var currentDelivery, maxItemQuantity int
	if err := tx.QueryRow(ctx, `
		SELECT currency, flat_delivery_fee_minor, max_item_quantity
		FROM app_settings
		WHERE id=true
	`).Scan(&currentCurrency, &currentDelivery, &maxItemQuantity); err != nil {
		return nil, 0, 0, 0, "", err
	}
	if fulfillmentType == core.FulfillmentPickup {
		currentDelivery = 0
	}
	if storedCurrency != currentCurrency || storedDelivery != currentDelivery {
		return nil, 0, 0, 0, "", core.ErrCalculationExpired
	}

	seen := map[uuid.UUID]bool{}
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		if item.ItemID == uuid.Nil || seen[item.ItemID] || item.Quantity <= 0 || item.Quantity > maxItemQuantity {
			return nil, 0, 0, 0, "", core.ErrInvalidQuantity
		}
		seen[item.ItemID] = true
		ids = append(ids, item.ItemID)
	}

	rows, err := tx.Query(ctx, `
		SELECT mi.id, mi.title_ru, mi.discounted_price_minor, mi.version, mi.min_quantity
		FROM menu_items mi
		JOIN categories c ON c.id=mi.category_id
		WHERE mi.id=ANY($1)
			AND mi.visible=true
			AND mi.archived=false
			AND c.visible=true
			AND c.archived=false
	`, ids)
	if err != nil {
		return nil, 0, 0, 0, "", err
	}
	defer rows.Close()
	type menuCalcRow struct {
		title       string
		price       int
		version     int
		minQuantity int
	}
	menuRows := map[uuid.UUID]menuCalcRow{}
	for rows.Next() {
		var id uuid.UUID
		var row menuCalcRow
		if err := rows.Scan(&id, &row.title, &row.price, &row.version, &row.minQuantity); err != nil {
			return nil, 0, 0, 0, "", err
		}
		menuRows[id] = row
	}
	if err := rows.Err(); err != nil {
		return nil, 0, 0, 0, "", err
	}
	if len(menuRows) != len(ids) {
		return nil, 0, 0, 0, "", core.ErrItemUnavailable
	}

	revalidated := make([]core.CalculatedItem, 0, len(items))
	subtotal := 0
	for _, item := range items {
		row := menuRows[item.ItemID]

		if item.Quantity < row.minQuantity {
			return nil, 0, 0, 0, "", core.ErrInvalidQuantity
		}
		if item.Title != row.title || item.UnitPriceMinor != row.price || item.Version != row.version {
			return nil, 0, 0, 0, "", core.ErrCalculationExpired
		}
		line := row.price * item.Quantity
		if item.LineTotalMinor != line {
			return nil, 0, 0, 0, "", core.ErrCalculationExpired
		}
		subtotal += line
		revalidated = append(revalidated, core.CalculatedItem{
			ItemID:         item.ItemID,
			Title:          row.title,
			UnitPriceMinor: row.price,
			Quantity:       item.Quantity,
			LineTotalMinor: line,
			Version:        row.version,
		})
	}
	total := subtotal + currentDelivery
	if subtotal != storedSubtotal || total != storedTotal {
		return nil, 0, 0, 0, "", core.ErrCalculationExpired
	}
	return revalidated, subtotal, currentDelivery, total, currentCurrency, nil
}

func (s *Store) revalidateAdditionCalculationTx(ctx context.Context, tx pgx.Tx, orderID uuid.UUID, items []core.CalculatedItem, storedSubtotal, storedDelivery, storedTotal int, storedCurrency string) ([]core.CalculatedItem, int, string, error) {
	if len(items) == 0 {
		return nil, 0, "", core.ErrInvalidQuantity
	}

	var currentCurrency string
	var maxItemQuantity int
	if err := tx.QueryRow(ctx, `
		SELECT currency, max_item_quantity
		FROM app_settings
		WHERE id=true
	`).Scan(&currentCurrency, &maxItemQuantity); err != nil {
		return nil, 0, "", err
	}
	if storedCurrency != currentCurrency || storedDelivery != 0 || storedTotal != storedSubtotal {
		return nil, 0, "", core.ErrCalculationExpired
	}

	existingRows, err := tx.Query(ctx, `
		SELECT menu_item_id, COALESCE(SUM(quantity), 0)::int
		FROM order_items
		WHERE order_id=$1 AND menu_item_id IS NOT NULL
		GROUP BY menu_item_id
	`, orderID)
	if err != nil {
		return nil, 0, "", err
	}
	existing := map[uuid.UUID]int{}
	for existingRows.Next() {
		var id uuid.UUID
		var quantity int
		if err := existingRows.Scan(&id, &quantity); err != nil {
			existingRows.Close()
			return nil, 0, "", err
		}
		existing[id] = quantity
	}
	if err := existingRows.Err(); err != nil {
		existingRows.Close()
		return nil, 0, "", err
	}
	existingRows.Close()

	seen := map[uuid.UUID]bool{}
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		if item.ItemID == uuid.Nil || seen[item.ItemID] || item.Quantity <= 0 || item.Quantity > maxItemQuantity {
			return nil, 0, "", core.ErrInvalidQuantity
		}
		seen[item.ItemID] = true
		ids = append(ids, item.ItemID)
	}

	rows, err := tx.Query(ctx, `
		SELECT mi.id, mi.title_ru, mi.discounted_price_minor, mi.version, mi.min_quantity
		FROM menu_items mi
		JOIN categories c ON c.id=mi.category_id
		WHERE mi.id=ANY($1)
			AND mi.visible=true
			AND mi.archived=false
			AND c.visible=true
			AND c.archived=false
	`, ids)
	if err != nil {
		return nil, 0, "", err
	}
	defer rows.Close()
	type menuCalcRow struct {
		title       string
		price       int
		version     int
		minQuantity int
	}
	menuRows := map[uuid.UUID]menuCalcRow{}
	for rows.Next() {
		var id uuid.UUID
		var row menuCalcRow
		if err := rows.Scan(&id, &row.title, &row.price, &row.version, &row.minQuantity); err != nil {
			return nil, 0, "", err
		}
		menuRows[id] = row
	}
	if err := rows.Err(); err != nil {
		return nil, 0, "", err
	}
	if len(menuRows) != len(ids) {
		return nil, 0, "", core.ErrItemUnavailable
	}

	revalidated := make([]core.CalculatedItem, 0, len(items))
	subtotal := 0
	for _, item := range items {
		row := menuRows[item.ItemID]
		existingQty := existing[item.ItemID]
		if existingQty == 0 && item.Quantity < row.minQuantity {
			return nil, 0, "", core.ErrInvalidQuantity
		}
		if existingQty+item.Quantity > maxItemQuantity {
			return nil, 0, "", core.ErrInvalidQuantity
		}
		if item.Title != row.title || item.UnitPriceMinor != row.price || item.Version != row.version {
			return nil, 0, "", core.ErrCalculationExpired
		}
		line := row.price * item.Quantity
		if item.LineTotalMinor != line {
			return nil, 0, "", core.ErrCalculationExpired
		}
		subtotal += line
		revalidated = append(revalidated, core.CalculatedItem{
			ItemID:         item.ItemID,
			Title:          row.title,
			UnitPriceMinor: row.price,
			Quantity:       item.Quantity,
			LineTotalMinor: line,
			Version:        row.version,
		})
	}
	if subtotal != storedSubtotal {
		return nil, 0, "", core.ErrCalculationExpired
	}
	return revalidated, subtotal, currentCurrency, nil
}

func (s *Store) VerifiedContact(ctx context.Context, sess core.Session) (core.VerifiedContact, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.VerifiedContact{}, core.ErrForbidden
	}
	var phoneCipher string
	var verifiedAt sql.NullTime
	err := s.pool.QueryRow(ctx, `
		SELECT phone_ciphertext, phone_verified_at
		FROM users
		WHERE id=$1
	`, sess.UserID).Scan(&phoneCipher, &verifiedAt)
	if err != nil {
		return core.VerifiedContact{}, err
	}
	result := core.VerifiedContact{CityVerificationEnabled: s.persistentCityVerification}
	if s.persistentCityVerification {
		var cityVerifiedAt sql.NullTime
		if err := s.pool.QueryRow(ctx, `SELECT city_verified_at FROM users WHERE id=$1`, sess.UserID).Scan(&cityVerifiedAt); err != nil {
			return core.VerifiedContact{}, err
		}
		if cityVerifiedAt.Valid {
			result.CityVerifiedAt = &cityVerifiedAt.Time
		}
	}
	if !verifiedAt.Valid || strings.TrimSpace(phoneCipher) == "" {
		return result, nil
	}
	phone, err := s.box.Decrypt(phoneCipher)
	if err != nil {
		return core.VerifiedContact{}, err
	}
	result.Verified = true
	result.Phone = phone
	result.Masked = maskPhone(phone)
	result.VerifiedAt = &verifiedAt.Time
	return result, nil
}

// EnablePersistentCityVerification enables account-level city confirmation at startup.
func (s *Store) EnablePersistentCityVerification() {
	s.persistentCityVerification = true
}

func (s *Store) VerifyTelegramContact(ctx context.Context, telegramUserID, contactUserID int64, phone string) error {
	phone = safe(phone)
	if telegramUserID <= 0 || telegramUserID != contactUserID || !requiredText(phone, maxPhoneLength) {
		return core.ErrInvalidInput
	}
	phoneCipher, err := s.box.Encrypt(phone)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO users (telegram_user_id, phone_ciphertext, phone_hash, phone_verified_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (telegram_user_id)
		DO UPDATE SET phone_ciphertext=EXCLUDED.phone_ciphertext, phone_hash=EXCLUDED.phone_hash,
			phone_verified_at=now(), updated_at=now()
	`, telegramUserID, phoneCipher, s.phoneHash(phone))
	return err
}

func (s *Store) CreateCashLocationChallenge(ctx context.Context, sess core.Session, input CreateCashLocationChallengeInput, now time.Time, devBypass bool) (core.CashLocationChallenge, error) {
	if s.persistentCityVerification {
		devBypass = false // Persistent confirmation always requires a real check, including for owners.
	}
	if sess.ActiveRole != core.RoleClient {
		return core.CashLocationChallenge{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	if !settings.CashEnabled {
		return core.CashLocationChallenge{}, core.ErrPaymentNotConfirmed
	}
	tokenHash := hashString(input.CalculationToken)
	var exists bool
	if err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM calculation_tokens
			WHERE token_hash=$1 AND user_id=$2 AND purpose='order' AND used_at IS NULL AND expires_at > now()
		)
	`, tokenHash, sess.UserID).Scan(&exists); err != nil {
		return core.CashLocationChallenge{}, err
	}
	if !exists {
		return core.CashLocationChallenge{}, core.ErrCalculationExpired
	}
	if settings.CashLocationRequired && !devBypass && !cashLocationConfigured(settings) {
		return core.CashLocationChallenge{}, core.ErrInvalidInput
	}
	ttl := cashLocationTTL(settings)
	expiresAt := now.UTC().Add(ttl)
	status := core.CashLocationPending
	var verifiedAt any
	var distance any
	var accuracy any
	if devBypass {
		status = core.CashLocationVerified
		verifiedAt = now.UTC()
		distance = 0
		accuracy = 0
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	defer rollback(ctx, tx)

	// Opening the bot chat can destroy Telegram's WebView. If the client retries
	// after returning, keep its short-lived active challenge instead of
	// invalidating a location that Telegram has already verified. Rebind it to
	// the fresh calculation token produced by the reopened Mini App.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, sess.UserID.String()); err != nil {
		return core.CashLocationChallenge{}, err
	}
	var reusableID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id
		FROM cash_location_challenges
		WHERE telegram_user_id=$1
			AND used_at IS NULL
			AND (NOT $4::boolean OR NOT dev_bypass)
			AND (
				(status IN ('PENDING', 'VERIFIED') AND expires_at > $2)
				OR (verified_at IS NOT NULL AND verified_at > $2 - ($3::int * interval '1 second'))
			)
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE
	`, sess.TelegramUserID, now.UTC(), int(ttl/time.Second), s.persistentCityVerification).Scan(&reusableID)
	if err == nil {
		if _, err := tx.Exec(ctx, `
			UPDATE cash_location_challenges
			SET calculation_token_hash=$1,
				status=CASE WHEN verified_at IS NOT NULL THEN 'VERIFIED' ELSE status END,
				expires_at=CASE WHEN verified_at IS NOT NULL THEN verified_at + ($3::int * interval '1 second') ELSE expires_at END,
				updated_at=now()
			WHERE id=$2
		`, tokenHash, reusableID, int(ttl/time.Second)); err != nil {
			return core.CashLocationChallenge{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return core.CashLocationChallenge{}, err
		}
		return s.CashLocationChallenge(ctx, sess, reusableID, now)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return core.CashLocationChallenge{}, err
	}

	if _, err := tx.Exec(ctx, `
		UPDATE cash_location_challenges
		SET status='EXPIRED', updated_at=now()
		WHERE user_id=$1 AND status IN ('PENDING', 'VERIFIED') AND used_at IS NULL
	`, sess.UserID); err != nil {
		return core.CashLocationChallenge{}, err
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO cash_location_challenges (
			user_id, telegram_user_id, calculation_token_hash, status, distance_meters,
			accuracy_meters, dev_bypass, verified_at, expires_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id
	`, sess.UserID, sess.TelegramUserID, tokenHash, string(status), distance, accuracy, devBypass, verifiedAt, expiresAt).Scan(&id); err != nil {
		return core.CashLocationChallenge{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.CashLocationChallenge{}, err
	}
	return s.CashLocationChallenge(ctx, sess, id, now)
}

func (s *Store) AttachCashLocationPrompt(ctx context.Context, sess core.Session, challengeID uuid.UUID, promptMessageID int64) error {
	if sess.ActiveRole != core.RoleClient || promptMessageID <= 0 {
		return core.ErrInvalidInput
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE cash_location_challenges
		SET prompt_message_id=$1, updated_at=now()
		WHERE id=$2 AND user_id=$3 AND status='PENDING'
	`, promptMessageID, challengeID, sess.UserID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return core.ErrInvalidInput
	}
	return nil
}

func (s *Store) RejectCashLocationChallenge(ctx context.Context, sess core.Session, challengeID uuid.UUID, reason string) error {
	if sess.ActiveRole != core.RoleClient {
		return core.ErrForbidden
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE cash_location_challenges
		SET status='REJECTED', rejection_reason=$1, updated_at=now()
		WHERE id=$2 AND user_id=$3 AND status='PENDING'
	`, safe(reason), challengeID, sess.UserID)
	return err
}

func (s *Store) CashLocationChallenge(ctx context.Context, sess core.Session, challengeID uuid.UUID, now time.Time) (core.CashLocationChallenge, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.CashLocationChallenge{}, core.ErrForbidden
	}
	if err := s.expireCashLocationChallenges(ctx, sess.UserID, now); err != nil {
		return core.CashLocationChallenge{}, err
	}
	return s.cashLocationChallengeByID(ctx, challengeID, sess.UserID)
}

func (s *Store) VerifyCashLocationFromTelegram(ctx context.Context, telegramUserID int64, replyToMessageID int64, messageDate time.Time, latitude, longitude float64, accuracyMeters *float64, now time.Time) (core.CashLocationChallenge, error) {
	if telegramUserID <= 0 || !geo.ValidCoordinates(latitude, longitude) {
		return core.CashLocationChallenge{}, core.ErrInvalidInput
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	ttl := cashLocationTTL(settings)
	if messageDate.IsZero() || now.UTC().Sub(messageDate.UTC()) > ttl || messageDate.UTC().After(now.UTC().Add(2*time.Minute)) {
		return core.CashLocationChallenge{}, core.ErrInvalidInput
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	defer rollback(ctx, tx)

	var id uuid.UUID
	var userID uuid.UUID
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, expires_at
		FROM cash_location_challenges
		WHERE telegram_user_id=$1 AND status='PENDING' AND used_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE
	`, telegramUserID).Scan(&id, &userID, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.CashLocationChallenge{}, core.ErrInvalidInput
	}
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	if !now.UTC().Before(expiresAt) {
		if _, err := tx.Exec(ctx, `
			UPDATE cash_location_challenges
			SET status='EXPIRED', updated_at=now()
			WHERE id=$1
		`, id); err != nil {
			return core.CashLocationChallenge{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return core.CashLocationChallenge{}, err
		}
		return s.cashLocationChallengeByID(ctx, id, userID)
	}
	return s.verifyCashLocationChallengeTx(ctx, tx, settings, id, userID, expiresAt, latitude, longitude, accuracyMeters, now)
}

func (s *Store) VerifyCashLocationForSession(ctx context.Context, sess core.Session, challengeID uuid.UUID, latitude, longitude float64, accuracyMeters *float64, now time.Time) (core.CashLocationChallenge, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.CashLocationChallenge{}, core.ErrForbidden
	}
	if challengeID == uuid.Nil || !geo.ValidCoordinates(latitude, longitude) {
		return core.CashLocationChallenge{}, core.ErrInvalidInput
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	defer rollback(ctx, tx)

	var userID uuid.UUID
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT user_id, expires_at
		FROM cash_location_challenges
		WHERE id=$1 AND user_id=$2 AND telegram_user_id=$3 AND status='PENDING' AND used_at IS NULL
		FOR UPDATE
	`, challengeID, sess.UserID, sess.TelegramUserID).Scan(&userID, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.CashLocationChallenge{}, core.ErrInvalidInput
	}
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	return s.verifyCashLocationChallengeTx(ctx, tx, settings, challengeID, userID, expiresAt, latitude, longitude, accuracyMeters, now)
}

func (s *Store) verifyCashLocationChallengeTx(ctx context.Context, tx pgx.Tx, settings core.Settings, id, userID uuid.UUID, expiresAt time.Time, latitude, longitude float64, accuracyMeters *float64, now time.Time) (core.CashLocationChallenge, error) {
	if !now.UTC().Before(expiresAt) {
		if _, err := tx.Exec(ctx, `
			UPDATE cash_location_challenges
			SET status='EXPIRED', updated_at=now()
			WHERE id=$1
		`, id); err != nil {
			return core.CashLocationChallenge{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return core.CashLocationChallenge{}, err
		}
		return s.cashLocationChallengeByID(ctx, id, userID)
	}
	accuracy := settings.CashLocationMaxAccuracyMeters
	accuracyLimit := settings.CashLocationMaxAccuracyMeters
	if s.persistentCityVerification {
		// City confirmation needs the uncertainty circle to fit inside the area,
		// not street-level precision. The distance+accuracy check below still applies.
		accuracyLimit = settings.CashLocationRadiusMeters
	}
	if accuracyMeters != nil {
		// Validate before converting to int: nonfinite/huge values can overflow.
		if math.IsNaN(*accuracyMeters) || math.IsInf(*accuracyMeters, 0) || *accuracyMeters < 0 || *accuracyMeters > float64(accuracyLimit) {
			return s.rejectCashLocationChallengeTx(ctx, tx, id, userID, "LOCATION_INACCURATE")
		}
		accuracy = int(math.Ceil(*accuracyMeters))
	}
	if accuracy > accuracyLimit {
		return s.rejectCashLocationChallengeTx(ctx, tx, id, userID, "LOCATION_INACCURATE")
	}
	if !cashLocationConfigured(settings) {
		return s.rejectCashLocationChallengeTx(ctx, tx, id, userID, "LOCATION_NOT_CONFIGURED")
	}
	distance := int(math.Ceil(geo.DistanceMeters(settings.RestaurantLatitude, settings.RestaurantLongitude, latitude, longitude)))
	if distance+accuracy > settings.CashLocationRadiusMeters {
		if _, err := tx.Exec(ctx, `
			UPDATE cash_location_challenges
			SET status='REJECTED', rejection_reason='OUTSIDE_CASH_AREA', distance_meters=$2,
				accuracy_meters=$3, updated_at=now()
			WHERE id=$1
		`, id, distance, accuracy); err != nil {
			return core.CashLocationChallenge{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return core.CashLocationChallenge{}, err
		}
		return s.cashLocationChallengeByID(ctx, id, userID)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE cash_location_challenges
		SET status='VERIFIED', rejection_reason='', distance_meters=$2, accuracy_meters=$3,
			verified_at=now(), expires_at=now() + ($4::int * interval '1 second'), updated_at=now()
		WHERE id=$1
	`, id, distance, accuracy, settings.CashLocationTTLSeconds); err != nil {
		return core.CashLocationChallenge{}, err
	}
	if s.persistentCityVerification {
		if _, err := tx.Exec(ctx, `UPDATE users SET city_verified_at=COALESCE(city_verified_at, $2) WHERE id=$1`, userID, now.UTC()); err != nil {
			return core.CashLocationChallenge{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return core.CashLocationChallenge{}, err
	}
	return s.cashLocationChallengeByID(ctx, id, userID)
}

func (s *Store) CreateCashOrder(ctx context.Context, sess core.Session, input CreateOrderInput, idempotencyKey, requestHash string, now time.Time) (core.Order, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Order{}, core.ErrForbidden
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return core.Order{}, core.ErrIdempotencyConflict
	}
	if input.PaymentMethod != "" && input.PaymentMethod != core.PaymentCash {
		return core.Order{}, core.ErrPaymentNotConfirmed
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.Order{}, err
	}
	accept := core.CanAcceptOrder(now, settings)
	if !accept.OK {
		if accept.Reason == "manual_day_off" {
			return core.Order{}, core.ErrManualDayOff
		}
		return core.Order{}, core.ErrRestaurantClosed
	}
	if !settings.CashEnabled {
		return core.Order{}, core.ErrPaymentNotConfirmed
	}
	if !input.TermsAccepted {
		return core.Order{}, core.ErrTermsRequired
	}
	termsVersion := safe(input.TermsVersion)
	if termsVersion == "" {
		termsVersion = currentTermsVersion
	}
	if !requiredText(termsVersion, 40) {
		return core.Order{}, core.ErrInvalidInput
	}
	fulfillmentType, err := normalizeFulfillmentType(input.FulfillmentType)
	if err != nil {
		return core.Order{}, err
	}
	address := safe(input.Address)
	comment := safe(input.Comment)
	if fulfillmentType == core.FulfillmentPickup {
		if !settings.PickupEnabled || input.PickupAt == nil || input.DeliveryRequestedAt != nil || strings.TrimSpace(input.DeliveryTimeMode) != "" {
			return core.Order{}, core.ErrPickupSlotUnavailable
		}
		address = pickupAddressSnapshot
	} else if input.PickupAt != nil || !requiredText(address, maxAddressLength) {
		return core.Order{}, core.ErrInvalidInput
	}
	if len([]rune(comment)) > settings.MaxCommentLength || !optionalText(comment, maxCustomerCommentLength) {
		return core.Order{}, core.ErrInvalidInput
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)

	if orderID, replay, err := s.beginIdempotency(ctx, tx, sess.UserID, "orders.create_cash", idempotencyKey, requestHash); err != nil {
		return core.Order{}, err
	} else if replay {
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, orderID, true)
	}

	if !input.AllowConcurrentActiveOrders {
		var hasActiveOrder bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM orders
				WHERE client_user_id=$1 AND fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')
			)
		`, sess.UserID).Scan(&hasActiveOrder); err != nil {
			return core.Order{}, err
		}
		if hasActiveOrder {
			return core.Order{}, core.ErrActiveOrderExists
		}
	}

	tokenHash := hashString(input.CalculationToken)
	var rawItems []byte
	var subtotal, delivery, total int
	var currency string
	var tokenFulfillmentType core.FulfillmentType
	err = tx.QueryRow(ctx, `
		SELECT items_json, fulfillment_type, subtotal_minor, delivery_fee_minor, total_minor, currency
		FROM calculation_tokens
		WHERE token_hash=$1 AND user_id=$2 AND purpose='order' AND used_at IS NULL AND expires_at > now()
		FOR UPDATE
	`, tokenHash, sess.UserID).Scan(&rawItems, &tokenFulfillmentType, &subtotal, &delivery, &total, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrCalculationExpired
	}
	if err != nil {
		return core.Order{}, err
	}
	var items []core.CalculatedItem
	if err := json.Unmarshal(rawItems, &items); err != nil {
		return core.Order{}, err
	}
	tokenFulfillmentType, err = normalizeFulfillmentType(tokenFulfillmentType)
	if err != nil || tokenFulfillmentType != fulfillmentType {
		return core.Order{}, core.ErrCalculationExpired
	}
	items, subtotal, delivery, total, currency, err = s.revalidateCalculationTx(ctx, tx, items, subtotal, delivery, total, currency, fulfillmentType)
	if err != nil {
		return core.Order{}, err
	}
	var pickupAt *time.Time
	var pickupCookAtValue *time.Time
	var deliveryRequestedAt *time.Time
	var deliveryTargetAt *time.Time
	deliveryTimeMode := "ASAP"
	deliveryQueueDelayMinutes := 0
	if fulfillmentType == core.FulfillmentPickup {
		validated, err := s.validatePickupSlotTx(ctx, tx, *input.PickupAt, settings, now)
		if err != nil {
			return core.Order{}, err
		}
		pickupAt = &validated
		pickupCookAtValue = pickupCookAt(pickupAt, settings)
	} else if settings.DeliveryTimingEnabled && s.deliveryTimingAccess(sess.TelegramUserID) {
		mode, requested, target, delay, err := s.validateDeliveryTimingTx(ctx, tx, DeliveryTimingInput{Mode: input.DeliveryTimeMode, RequestedAt: input.DeliveryRequestedAt}, settings, now)
		if err != nil {
			return core.Order{}, err
		}
		deliveryTimeMode, deliveryRequestedAt, deliveryTargetAt, deliveryQueueDelayMinutes = mode, requested, &target, delay
	} else {
		if input.DeliveryRequestedAt != nil || (strings.TrimSpace(input.DeliveryTimeMode) != "" && !strings.EqualFold(input.DeliveryTimeMode, "ASAP")) {
			return core.Order{}, core.ErrDeliveryTimingUnavailable
		}
		deliveryTimeMode = "ASAP"
	}
	phone, err := s.verifiedPhoneForCashOrder(ctx, tx, sess.UserID, input.Phone)
	if err != nil {
		return core.Order{}, err
	}
	var cashLocationChallengeID *uuid.UUID
	var cashLocationVerifiedAt *time.Time
	var cashLocationDistance *int
	cashLocationChallengeID, cashLocationVerifiedAt, cashLocationDistance, err = s.useCashLocationChallengeTx(ctx, tx, sess, input.CashLocationChallengeID, tokenHash, settings, now)
	if err != nil {
		return core.Order{}, err
	}
	phoneCipher, err := s.box.Encrypt(phone)
	if err != nil {
		return core.Order{}, err
	}
	addressCipher, err := s.box.Encrypt(address)
	if err != nil {
		return core.Order{}, err
	}
	phoneHash := s.phoneHash(phone)
	var orderID uuid.UUID
	var publicNumber int
	var createdAt time.Time
	kitchenQueuePosition := 0
	err = tx.QueryRow(ctx, `
		INSERT INTO orders (
			client_user_id, fulfillment_type, fulfillment_status, payment_method, payment_status, subtotal_minor, delivery_fee_minor,
			total_minor, currency, phone_ciphertext, phone_hash, address_ciphertext, customer_comment, locale,
			terms_version, terms_accepted_at, cash_location_challenge_id, cash_location_verified_at, cash_location_distance_meters,
			pickup_at, pickup_original_at, pickup_cook_at, pickup_address_snapshot, pickup_instructions_snapshot,
			delivery_time_mode, delivery_requested_at, delivery_target_at, delivery_queue_delay_minutes, dev_concurrent_order
		)
		VALUES ($1, $2, 'NEW', 'cash', 'CASH_PENDING', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13, $14, $15, $16, $16, $17, $18, $19, $20, $21, $22, $23, $24)
		RETURNING id, public_number, created_at
	`, sess.UserID, string(fulfillmentType), subtotal, delivery, total, currency, phoneCipher, phoneHash, addressCipher, comment, localeOrDefault(input.Locale),
		termsVersion, uuidSQL(cashLocationChallengeID), timeSQL(cashLocationVerifiedAt), intSQL(cashLocationDistance),
		timeSQL(pickupAt), timeSQL(pickupCookAtValue), pickupAddressForOrder(fulfillmentType, settings), pickupInstructionsForLocale(fulfillmentType, settings, input.Locale),
		deliveryTimeMode, timeSQL(deliveryRequestedAt), timeSQL(deliveryTargetAt), deliveryQueueDelayMinutes, input.AllowConcurrentActiveOrders).
		Scan(&orderID, &publicNumber, &createdAt)
	if err != nil {
		if isUniqueViolation(err, "idx_orders_one_active_per_client") {
			return core.Order{}, core.ErrActiveOrderExists
		}
		return core.Order{}, err
	}
	if fulfillmentType == core.FulfillmentDelivery && deliveryTimeMode == "ASAP" {
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*)::int + 1
			FROM orders q
			WHERE q.fulfillment_type='delivery' AND q.fulfillment_status='NEW' AND q.delivery_time_mode='ASAP'
				AND (q.created_at < $2 OR (q.created_at = $2 AND q.id < $1))
		`, orderID, createdAt).Scan(&kitchenQueuePosition); err != nil {
			return core.Order{}, err
		}
	}
	if err := copyOrderItemsTx(ctx, tx, orderID, items); err != nil {
		return core.Order{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE calculation_tokens SET used_at=now() WHERE token_hash=$1`, tokenHash)
	if err != nil {
		return core.Order{}, err
	}
	_, _ = tx.Exec(ctx, `
		UPDATE users SET phone_ciphertext=$1, phone_hash=$2, updated_at=now() WHERE id=$3
	`, phoneCipher, phoneHash, sess.UserID)
	_, err = tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role)
		VALUES ($1, '', 'NEW', 'create_cash_order', $2, 'CLIENT')
	`, orderID, sess.UserID)
	if err != nil {
		return core.Order{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
		VALUES ($1, 'kitchen', 'kitchen_new_order', $2)
		ON CONFLICT (event_key, recipient_kind) DO NOTHING
	`, orderID, fmt.Sprintf("order:%s:new", orderID))
	if err != nil {
		return core.Order{}, err
	}
	if fulfillmentType == core.FulfillmentDelivery {
		templates := []string{"owner_delivery_alert_new"}
		eventKeys := []string{fmt.Sprintf("order:%s:delivery-alert:new:owner:%d", orderID, deliveryAlertTelegramID)}
		for telegramID := range ownerTesterTelegramIDs {
			if telegramID != deliveryAlertTelegramID {
				templates = append(templates, "owner_delivery_alert_brief")
				eventKeys = append(eventKeys, fmt.Sprintf("order:%s:delivery-alert:new:owner:%d", orderID, telegramID))
			}
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
			SELECT $1, 'admin', template, event_key
			FROM unnest($2::text[], $3::text[]) AS alerts(template, event_key)
			ON CONFLICT (event_key, recipient_kind) DO NOTHING
		`, orderID, templates, eventKeys)
		if err != nil {
			return core.Order{}, err
		}
	}
	if err := s.finishIdempotency(ctx, tx, sess.UserID, "orders.create_cash", idempotencyKey, orderID); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	order := core.Order{
		ID:                         orderID,
		PublicNumber:               publicNumber,
		ClientUserID:               sess.UserID,
		ClientUsername:             sess.Username,
		ClientFirstName:            sess.FirstName,
		ClientPhotoURL:             sess.PhotoURL,
		FulfillmentType:            fulfillmentType,
		FulfillmentStatus:          core.StatusNew,
		PaymentMethod:              core.PaymentCash,
		PaymentStatus:              core.PaymentCashPending,
		SubtotalMinor:              subtotal,
		DeliveryFeeMinor:           delivery,
		TotalMinor:                 total,
		Currency:                   currency,
		Phone:                      phone,
		Address:                    address,
		CustomerComment:            comment,
		Locale:                     localeOrDefault(input.Locale),
		Version:                    1,
		CreatedAt:                  createdAt,
		PickupAt:                   pickupAt,
		PickupOriginalAt:           pickupAt,
		PickupCookAt:               pickupCookAtValue,
		PickupAddress:              pickupAddressForOrder(fulfillmentType, settings),
		PickupInstructions:         pickupInstructionsForLocale(fulfillmentType, settings, input.Locale),
		DeliveryTimeMode:           deliveryTimeMode,
		DeliveryRequestedAt:        deliveryRequestedAt,
		DeliveryTargetAt:           deliveryTargetAt,
		DeliveryQueueDelayMinutes:  deliveryQueueDelayMinutes,
		KitchenQueuePosition:       kitchenQueuePosition,
		CashLocationVerifiedAt:     cashLocationVerifiedAt,
		CashLocationDistanceMeters: cashLocationDistance,
	}
	for _, item := range items {
		order.Items = append(order.Items, core.OrderItem{
			MenuItemID:     item.ItemID,
			SnapshotTitle:  item.Title,
			UnitPriceMinor: item.UnitPriceMinor,
			Quantity:       item.Quantity,
			LineTotalMinor: item.LineTotalMinor,
		})
	}
	return order, nil
}

func normalizeDeliveryTiming(input DeliveryTimingInput) (string, *time.Time, error) {
	mode := strings.ToUpper(strings.TrimSpace(input.Mode))
	if mode == "" {
		mode = "ASAP"
	}
	switch mode {
	case "ASAP":
		if input.RequestedAt != nil {
			return "", nil, core.ErrDeliveryTimeInvalid
		}
		return mode, nil, nil
	case "SCHEDULED":
		if input.RequestedAt == nil {
			return "", nil, core.ErrDeliveryTimeInvalid
		}
		value := input.RequestedAt.UTC()
		return mode, &value, nil
	default:
		return "", nil, core.ErrDeliveryTimeInvalid
	}
}

func (s *Store) resolveDeliveryTiming(ctx context.Context, input DeliveryTimingInput, settings core.Settings, now time.Time) (time.Time, int, error) {
	mode, requested, err := normalizeDeliveryTiming(input)
	if err != nil {
		return time.Time{}, 0, err
	}
	slots, err := s.deliverySlotsForSettings(ctx, settings, now)
	if err != nil {
		return time.Time{}, 0, err
	}
	if mode == "ASAP" {
		if slots.ASAP == nil {
			return time.Time{}, 0, core.ErrDeliveryTimingUnavailable
		}
		return slots.ASAP.TargetAt, slots.ASAP.QueueDelayMinutes, nil
	}
	for _, slot := range slots.Slots {
		if requested != nil && slot.TargetAt.Equal(*requested) {
			if !slot.Available {
				return time.Time{}, 0, &core.DeliverySlotUnavailableError{NextAvailableAt: slot.NextAvailableAt, QueueDelayMinutes: slot.QueueDelayMinutes}
			}
			return slot.TargetAt, 0, nil
		}
	}
	return time.Time{}, 0, core.ErrDeliveryTimeInvalid
}

func (s *Store) deliverySlotsForSettings(ctx context.Context, settings core.Settings, now time.Time) (core.DeliverySlots, error) {
	if !core.CanAcceptOrder(now, settings).OK {
		return core.DeliverySlots{}, core.ErrDeliveryTimingUnavailable
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return core.DeliverySlots{}, err
	}
	localNow := now.In(loc)
	first, last, err := deliverySlotBounds(localNow, settings)
	if err != nil {
		return core.DeliverySlots{}, err
	}
	result := core.DeliverySlots{Timezone: settings.Timezone, Date: localNow.Format("2006-01-02"), Slots: []core.DeliverySlot{}}
	if first.After(last) {
		return result, nil
	}
	interval := time.Duration(settings.DeliverySlotMinutes) * time.Minute
	counts, err := s.deliverySlotLoads(ctx, first, last, interval)
	if err != nil {
		return core.DeliverySlots{}, err
	}
	for slot := first; !slot.After(last); slot = slot.Add(interval) {
		available := counts[slot.UTC()] < settings.DeliveryMaxOrdersPerSlot
		result.Slots = append(result.Slots, core.DeliverySlot{TargetAt: slot.UTC(), Label: slot.Format("15:04"), Available: available})
	}
	for i := range result.Slots {
		if result.Slots[i].Available {
			if result.ASAP == nil {
				delay := int(result.Slots[i].TargetAt.Sub(first.UTC()).Minutes())
				result.ASAP = &core.DeliveryASAP{TargetAt: result.Slots[i].TargetAt, WaitMinutes: max(0, int(result.Slots[i].TargetAt.Sub(now.UTC()).Minutes())), QueueDelayMinutes: delay}
			}
			continue
		}
		for j := i + 1; j < len(result.Slots); j++ {
			if result.Slots[j].Available {
				next := result.Slots[j].TargetAt
				result.Slots[i].NextAvailableAt = &next
				result.Slots[i].QueueDelayMinutes = int(next.Sub(result.Slots[i].TargetAt).Minutes())
				break
			}
		}
	}
	return result, nil
}

func (s *Store) validateDeliveryTimingTx(ctx context.Context, tx pgx.Tx, input DeliveryTimingInput, settings core.Settings, now time.Time) (string, *time.Time, time.Time, int, error) {
	mode, requested, err := normalizeDeliveryTiming(input)
	if err != nil {
		return "", nil, time.Time{}, 0, err
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return "", nil, time.Time{}, 0, err
	}
	first, last, err := deliverySlotBounds(now.In(loc), settings)
	if err != nil || first.After(last) {
		return "", nil, time.Time{}, 0, core.ErrDeliveryTimingUnavailable
	}
	interval := time.Duration(settings.DeliverySlotMinutes) * time.Minute
	candidate := first
	if mode == "SCHEDULED" {
		candidate = requested.In(loc)
		if candidate.Before(first) || candidate.After(last) || !candidate.Equal(candidate.Truncate(time.Minute)) || int(candidate.Sub(time.Date(candidate.Year(), candidate.Month(), candidate.Day(), 0, 0, 0, 0, loc))/time.Minute)%settings.DeliverySlotMinutes != 0 || candidate.YearDay() != now.In(loc).YearDay() || candidate.Year() != now.In(loc).Year() {
			return "", nil, time.Time{}, 0, core.ErrDeliveryTimeInvalid
		}
	}
	for slot := candidate; !slot.After(last); slot = slot.Add(interval) {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "delivery:"+slot.UTC().Format(time.RFC3339)); err != nil {
			return "", nil, time.Time{}, 0, err
		}
		count, err := deliverySlotLoadTx(ctx, tx, slot.UTC(), interval)
		if err != nil {
			return "", nil, time.Time{}, 0, err
		}
		if count < settings.DeliveryMaxOrdersPerSlot {
			delay := int(slot.Sub(first).Minutes())
			return mode, requested, slot.UTC(), delay, nil
		}
		if mode == "SCHEDULED" {
			var next *time.Time
			for later := slot.Add(interval); !later.After(last); later = later.Add(interval) {
				if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "delivery:"+later.UTC().Format(time.RFC3339)); err != nil {
					return "", nil, time.Time{}, 0, err
				}
				load, err := deliverySlotLoadTx(ctx, tx, later.UTC(), interval)
				if err != nil {
					return "", nil, time.Time{}, 0, err
				}
				if load < settings.DeliveryMaxOrdersPerSlot {
					value := later.UTC()
					next = &value
					break
				}
			}
			delay := 0
			if next != nil {
				delay = int(next.Sub(slot.UTC()).Minutes())
			}
			return "", nil, time.Time{}, 0, &core.DeliverySlotUnavailableError{NextAvailableAt: next, QueueDelayMinutes: delay}
		}
	}
	return "", nil, time.Time{}, 0, core.ErrDeliveryTimingUnavailable
}

func deliverySlotLoadTx(ctx context.Context, tx pgx.Tx, slot time.Time, interval time.Duration) (int, error) {
	var count int
	err := tx.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM orders WHERE fulfillment_type='delivery' AND fulfillment_status IN ('NEW','OUT_FOR_DELIVERY') AND delivery_target_at=$1)
			+
			(SELECT COUNT(*) FROM orders WHERE fulfillment_type='pickup' AND fulfillment_status IN ('NEW','READY_FOR_PICKUP') AND pickup_cook_at >= $1 AND pickup_cook_at < $2)
	`, slot, slot.Add(interval)).Scan(&count)
	return count, err
}

func (s *Store) validatePickupSlotTx(ctx context.Context, tx pgx.Tx, requested time.Time, settings core.Settings, now time.Time) (time.Time, error) {
	if !settings.PickupEnabled {
		return time.Time{}, core.ErrPickupUnavailable
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		return time.Time{}, err
	}
	localNow, localRequested := now.In(loc), requested.In(loc)
	if localRequested.Year() != localNow.Year() || localRequested.YearDay() != localNow.YearDay() || localRequested.Second() != 0 || localRequested.Nanosecond() != 0 {
		return time.Time{}, core.ErrPickupSlotUnavailable
	}
	if localRequested.Before(localNow.Add(time.Duration(settings.PickupMinLeadMinutes)*time.Minute)) || localRequested.Minute()%settings.PickupSlotMinutes != 0 {
		return time.Time{}, core.ErrPickupSlotUnavailable
	}
	lastHour, lastMinute, ok := parseClock(settings.PickupLastTime)
	if !ok {
		return time.Time{}, core.ErrInvalidInput
	}
	last := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), lastHour, lastMinute, 0, 0, loc)
	if localRequested.After(last) {
		return time.Time{}, core.ErrPickupSlotUnavailable
	}
	lockKey := localRequested.Format(time.RFC3339)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, lockKey); err != nil {
		return time.Time{}, err
	}
	var count int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM orders
		WHERE fulfillment_type='pickup' AND pickup_at=$1 AND fulfillment_status IN ('NEW', 'READY_FOR_PICKUP')
	`, localRequested.UTC()).Scan(&count); err != nil {
		return time.Time{}, err
	}
	if count >= settings.PickupMaxOrdersPerSlot {
		return time.Time{}, core.ErrPickupSlotUnavailable
	}
	if settings.DeliveryTimingEnabled {
		cookAt := localRequested.Add(-time.Duration(settings.PickupMinLeadMinutes) * time.Minute)
		dayStart := time.Date(cookAt.Year(), cookAt.Month(), cookAt.Day(), 0, 0, 0, 0, loc)
		interval := time.Duration(settings.DeliverySlotMinutes) * time.Minute
		sharedSlot := dayStart.Add((cookAt.Sub(dayStart) / interval) * interval).UTC()
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, "delivery:"+sharedSlot.Format(time.RFC3339)); err != nil {
			return time.Time{}, err
		}
		sharedCount, err := deliverySlotLoadTx(ctx, tx, sharedSlot, interval)
		if err != nil {
			return time.Time{}, err
		}
		if sharedCount >= settings.DeliveryMaxOrdersPerSlot {
			return time.Time{}, core.ErrPickupSlotUnavailable
		}
	}
	return localRequested.UTC(), nil
}

func pickupAddressForOrder(kind core.FulfillmentType, settings core.Settings) string {
	if kind == core.FulfillmentPickup {
		return settings.PickupAddress
	}
	return ""
}

func pickupInstructionsForLocale(kind core.FulfillmentType, settings core.Settings, locale string) string {
	if kind != core.FulfillmentPickup {
		return ""
	}
	switch localeOrDefault(locale) {
	case "sr":
		return settings.PickupInstructionsSR
	case "en":
		return settings.PickupInstructionsEN
	default:
		return settings.PickupInstructionsRU
	}
}

func copyOrderItemsTx(ctx context.Context, tx pgx.Tx, orderID uuid.UUID, items []core.CalculatedItem) error {
	rows := make([][]any, 0, len(items))
	for pos, item := range items {
		rows = append(rows, []any{
			orderID,
			item.ItemID,
			item.Title,
			item.UnitPriceMinor,
			item.Quantity,
			item.LineTotalMinor,
			pos,
		})
	}
	copied, err := tx.CopyFrom(ctx, pgx.Identifier{"order_items"}, []string{
		"order_id",
		"menu_item_id",
		"snapshot_title",
		"unit_price_minor",
		"quantity",
		"line_total_minor",
		"sort_order",
	}, pgx.CopyFromRows(rows))
	if err != nil {
		return err
	}
	if copied != int64(len(rows)) {
		return fmt.Errorf("copy order items: copied %d of %d", copied, len(rows))
	}
	return nil
}

func (s *Store) KitchenOrders(ctx context.Context, sess core.Session) ([]core.Order, error) {
	if sess.ActiveRole != core.RoleKitchen {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT o.id, o.public_number, o.client_user_id, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_type, o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency, o.phone_ciphertext, o.address_ciphertext,
			o.customer_comment, o.locale, o.version, o.created_at, o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.fulfillment_status='NEW'
			OR (o.fulfillment_status='READY_FOR_PICKUP' AND o.fulfillment_type='pickup')
		ORDER BY
			CASE WHEN o.fulfillment_status='READY_FOR_PICKUP' THEN 0 ELSE 1 END,
			CASE WHEN o.fulfillment_type='delivery' AND o.delivery_target_at < now() THEN 0 ELSE 1 END,
			CASE WHEN o.fulfillment_type='pickup' THEN o.pickup_at ELSE COALESCE(o.delivery_target_at, o.created_at) END ASC,
			o.created_at ASC
		LIMIT 50
	`)
	if err != nil {
		return nil, err
	}
	return s.scanOrdersWithItems(ctx, rows, false)
}

func (s *Store) CourierOrders(ctx context.Context, sess core.Session) ([]core.Order, error) {
	if sess.ActiveRole != core.RoleCourier {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT o.id, o.public_number, o.client_user_id, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_type, o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency, o.phone_ciphertext, o.address_ciphertext,
			o.customer_comment, o.locale, o.version, o.created_at, o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.fulfillment_status='OUT_FOR_DELIVERY'
			AND o.fulfillment_type='delivery'
		ORDER BY o.updated_at ASC
		LIMIT 50
	`)
	if err != nil {
		return nil, err
	}
	return s.scanOrdersWithItems(ctx, rows, true)
}

func (s *Store) ClientOrders(ctx context.Context, sess core.Session, filter ClientOrderFilter) (ClientOrdersPage, error) {
	if sess.ActiveRole != core.RoleClient {
		return ClientOrdersPage{}, core.ErrForbidden
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	rows, err := s.pool.Query(ctx, `
		SELECT o.id, o.public_number, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_type, o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency,
			o.locale, o.version, o.created_at, o.pickup_at, o.delivery_time_mode, o.delivery_requested_at,
			o.delivery_target_at, o.delivery_queue_delay_minutes,
			CASE WHEN o.fulfillment_type='delivery' AND o.fulfillment_status='NEW' AND o.delivery_time_mode='ASAP' THEN (
				SELECT COUNT(*)::int + 1 FROM orders q
				WHERE q.fulfillment_type='delivery' AND q.fulfillment_status='NEW' AND q.delivery_time_mode='ASAP'
					AND (q.created_at < o.created_at OR (q.created_at = o.created_at AND q.id < o.id))
			) ELSE 0 END,
			o.estimated_ready_at,
			o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.client_user_id=$1
		ORDER BY o.created_at DESC
		LIMIT $2 OFFSET $3
	`, sess.UserID, limit+1, offset)
	if err != nil {
		return ClientOrdersPage{}, err
	}
	defer rows.Close()
	orders, err := scanOrderSummaries(rows)
	if err != nil {
		return ClientOrdersPage{}, err
	}
	hasMore := len(orders) > limit
	if hasMore {
		orders = orders[:limit]
	}
	return ClientOrdersPage{Orders: orders, Limit: limit, Offset: offset, HasMore: hasMore}, nil
}

func (s *Store) ClientBootstrapOrders(ctx context.Context, sess core.Session) ([]core.OrderSummary, error) {
	if sess.ActiveRole != core.RoleClient {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT o.id, o.public_number, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_type, o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency,
			o.locale, o.version, o.created_at, o.pickup_at, o.delivery_time_mode, o.delivery_requested_at,
			o.delivery_target_at, o.delivery_queue_delay_minutes,
			CASE WHEN o.fulfillment_type='delivery' AND o.fulfillment_status='NEW' AND o.delivery_time_mode='ASAP' THEN (
				SELECT COUNT(*)::int + 1 FROM orders q
				WHERE q.fulfillment_type='delivery' AND q.fulfillment_status='NEW' AND q.delivery_time_mode='ASAP'
					AND (q.created_at < o.created_at OR (q.created_at = o.created_at AND q.id < o.id))
			) ELSE 0 END,
			o.estimated_ready_at,
			o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.client_user_id=$1
		ORDER BY
			CASE WHEN o.fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP') THEN 0 ELSE 1 END,
			o.created_at DESC
		LIMIT 1
	`, sess.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOrderSummaries(rows)
}

func (s *Store) ClientOrderByID(ctx context.Context, sess core.Session, orderID uuid.UUID) (core.Order, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Order{}, core.ErrForbidden
	}
	var exists bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM orders WHERE id=$1 AND client_user_id=$2)
	`, orderID, sess.UserID).Scan(&exists)
	if err != nil {
		return core.Order{}, err
	}
	if !exists {
		return core.Order{}, core.ErrForbidden
	}
	return s.OrderByID(ctx, orderID, true)
}

func (s *Store) AdminOrders(ctx context.Context, sess core.Session, filter AdminOrderFilter) (AdminOrdersPage, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return AdminOrdersPage{}, core.ErrForbidden
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	baseWhere, baseArgs, err := s.adminOrderBaseWhere(filter)
	if err != nil {
		return AdminOrdersPage{}, err
	}
	var counts AdminOrderCounts
	countsQuery := fmt.Sprintf(`
		SELECT
			COUNT(*) FILTER (WHERE o.fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP'))::int,
			COUNT(*) FILTER (WHERE o.fulfillment_status='NEW')::int,
			COUNT(*) FILTER (WHERE o.fulfillment_status IN ('OUT_FOR_DELIVERY', 'READY_FOR_PICKUP'))::int,
			COUNT(*) FILTER (WHERE o.fulfillment_status IN ('DELIVERED', 'CANCELLED'))::int
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE %s
	`, strings.Join(baseWhere, " AND "))
	if err := s.pool.QueryRow(ctx, countsQuery, baseArgs...).Scan(&counts.Active, &counts.New, &counts.Ready, &counts.History); err != nil {
		return AdminOrdersPage{}, err
	}
	where := append([]string(nil), baseWhere...)
	args := append([]any(nil), baseArgs...)
	if filter.Status != "" {
		statusWhere, statusArgs, err := adminOrderStatusPredicate(filter.Status, len(args)+1)
		if err != nil {
			return AdminOrdersPage{}, err
		}
		where = append(where, statusWhere)
		args = append(args, statusArgs...)
	}
	args = append(args, limit+1, offset)
	sqlQuery := fmt.Sprintf(
		`SELECT o.id
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE %s
		ORDER BY o.created_at DESC
		LIMIT $%d OFFSET $%d`,
		strings.Join(where, " AND "),
		len(args)-1,
		len(args),
	)
	rows, err := s.pool.Query(ctx, sqlQuery, args...)
	if err != nil {
		return AdminOrdersPage{}, err
	}
	ids := make([]uuid.UUID, 0, limit+1)
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return AdminOrdersPage{}, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return AdminOrdersPage{}, err
	}
	hasMore := len(ids) > limit
	if hasMore {
		ids = ids[:limit]
	}
	orders, err := s.ordersByIDs(ctx, ids, true)
	if err != nil {
		return AdminOrdersPage{}, err
	}
	return AdminOrdersPage{
		Orders:  orders,
		Limit:   limit,
		Offset:  offset,
		HasMore: hasMore,
		Counts:  counts,
	}, nil
}

func (s *Store) adminOrderBaseWhere(filter AdminOrderFilter) ([]string, []any, error) {
	where := []string{"true"}
	args := []any{}
	if filter.Date != "" {
		loc, err := time.LoadLocation("Europe/Belgrade")
		if err != nil {
			loc = time.FixedZone("Europe/Belgrade", 3600)
		}
		from, err := time.ParseInLocation("2006-01-02", filter.Date, loc)
		if err != nil {
			return nil, nil, core.ErrInvalidInput
		}
		args = append(args, from.UTC(), from.AddDate(0, 0, 1).UTC())
		where = append(where, fmt.Sprintf("o.created_at >= $%d AND o.created_at < $%d", len(args)-1, len(args)))
	}
	query := strings.TrimSpace(filter.Query)
	if query != "" {
		if !optionalText(query, maxAdminSearchLength) {
			return nil, nil, core.ErrInvalidInput
		}
		phoneHashes := s.phoneHashCandidates(query)
		phoneHashPlaceholders := make([]string, 0, len(phoneHashes))
		for _, hash := range phoneHashes {
			args = append(args, hash)
			phoneHashPlaceholders = append(phoneHashPlaceholders, fmt.Sprintf("$%d", len(args)))
		}
		likePlaceholder := len(args) + 1
		args = append(args, "%"+strings.ToLower(query)+"%")
		profilePredicate := fmt.Sprintf("(lower(COALESCE(u.username, '')) LIKE $%d OR lower(COALESCE(u.first_name, '')) LIKE $%d)", likePlaceholder, likePlaceholder)
		if publicNumber, err := strconv.Atoi(query); err == nil {
			publicNumberPlaceholder := len(args) + 1
			args = append(args, publicNumber)
			where = append(where, fmt.Sprintf("(o.public_number=$%d OR o.phone_hash IN (%s) OR %s)", publicNumberPlaceholder, strings.Join(phoneHashPlaceholders, ","), profilePredicate))
		} else {
			where = append(where, fmt.Sprintf("(o.phone_hash IN (%s) OR %s)", strings.Join(phoneHashPlaceholders, ","), profilePredicate))
		}
	}
	return where, args, nil
}

func adminOrderStatusPredicate(status string, nextPlaceholder int) (string, []any, error) {
	normalized := strings.ToUpper(strings.TrimSpace(status))
	switch normalized {
	case "ACTIVE":
		return "o.fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')", nil, nil
	case "HISTORY":
		return "o.fulfillment_status IN ('DELIVERED', 'CANCELLED')", nil, nil
	case "READY":
		return "o.fulfillment_status IN ('OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')", nil, nil
	default:
		if !validFulfillmentStatus(normalized) {
			return "", nil, core.ErrInvalidInput
		}
		return fmt.Sprintf("o.fulfillment_status=$%d", nextPlaceholder), []any{normalized}, nil
	}
}

func (s *Store) AdminOrderByID(ctx context.Context, sess core.Session, orderID uuid.UUID) (core.Order, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Order{}, core.ErrForbidden
	}
	order, err := s.OrderByID(ctx, orderID, true)
	if err != nil {
		return core.Order{}, err
	}
	order.Events, err = s.OrderEvents(ctx, orderID)
	return order, err
}

func (s *Store) CancelOrder(ctx context.Context, sess core.Session, orderID uuid.UUID, reason string) (core.Order, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Order{}, core.ErrForbidden
	}
	reason = safe(reason)
	if !requiredText(reason, maxReasonLength) {
		return core.Order{}, core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)
	var from string
	err = tx.QueryRow(ctx, `
		WITH target AS (
			SELECT id, fulfillment_status
			FROM orders
			WHERE id=$1 AND fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')
			FOR UPDATE
		), updated AS (
			UPDATE orders o
			SET fulfillment_status='CANCELLED',
				payment_status=CASE WHEN payment_status='CASH_PENDING' THEN 'FAILED' ELSE payment_status END,
				cancelled_at=now(), updated_at=now(), version=version+1
			FROM target
			WHERE o.id=target.id
			RETURNING target.fulfillment_status
		)
		SELECT fulfillment_status FROM updated
	`, orderID).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role, reason)
		VALUES ($1, $2, 'CANCELLED', 'admin_cancel', $3, $4, $5)
	`, orderID, from, sess.UserID, string(sess.ActiveRole), reason); err != nil {
		return core.Order{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "order.cancel", "order", &orderID, reason, map[string]any{"status": from}, map[string]any{"status": "CANCELLED"}); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.AdminOrderByID(ctx, sess, orderID)
}

func (s *Store) ReturnOrderToNew(ctx context.Context, sess core.Session, orderID uuid.UUID, reason string) (core.Order, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Order{}, core.ErrForbidden
	}
	reason = safe(reason)
	if !requiredText(reason, maxReasonLength) {
		return core.Order{}, core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)
	var from core.FulfillmentStatus
	err = tx.QueryRow(ctx, `
		UPDATE orders
		SET fulfillment_status='NEW', kitchen_started_at=NULL, courier_started_at=NULL, ready_at=NULL, updated_at=now(), version=version+1
		WHERE id=$1 AND fulfillment_status IN ('OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')
		RETURNING CASE WHEN fulfillment_type='pickup' THEN 'READY_FOR_PICKUP' ELSE 'OUT_FOR_DELIVERY' END
	`, orderID).Scan(&from)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role, reason)
		VALUES ($1, $2, 'NEW', 'admin_return_to_new', $3, $4, $5)
	`, orderID, string(from), sess.UserID, string(sess.ActiveRole), reason); err != nil {
		return core.Order{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "order.return_to_new", "order", &orderID, reason, map[string]any{"status": from}, map[string]any{"status": "NEW"}); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.AdminOrderByID(ctx, sess, orderID)
}

func (s *Store) UpdateOrderContact(ctx context.Context, sess core.Session, orderID uuid.UUID, phone, address, reason string) (core.Order, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Order{}, core.ErrForbidden
	}
	phone = safe(phone)
	address = safe(address)
	reason = safe(reason)
	if !requiredText(phone, maxPhoneLength) || !requiredText(address, maxAddressLength) || !requiredText(reason, maxReasonLength) {
		return core.Order{}, core.ErrInvalidInput
	}
	phoneCipher, err := s.box.Encrypt(phone)
	if err != nil {
		return core.Order{}, err
	}
	addressCipher, err := s.box.Encrypt(address)
	if err != nil {
		return core.Order{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)
	tag, err := tx.Exec(ctx, `
		UPDATE orders SET phone_ciphertext=$1, phone_hash=$2, address_ciphertext=$3, updated_at=now(), version=version+1
		WHERE id=$4 AND fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')
	`, phoneCipher, s.phoneHash(phone), addressCipher, orderID)
	if err != nil {
		return core.Order{}, err
	}
	if tag.RowsAffected() == 0 {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, action, actor_user_id, actor_role, reason)
		VALUES ($1, 'admin_edit_contact', $2, $3, $4)
	`, orderID, sess.UserID, string(sess.ActiveRole), reason); err != nil {
		return core.Order{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "order.edit_contact", "order", &orderID, reason, map[string]any{"contact": "masked"}, map[string]any{"contact": "changed"}); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.AdminOrderByID(ctx, sess, orderID)
}

func (s *Store) ResendOrderNotification(ctx context.Context, sess core.Session, orderID uuid.UUID, recipient, reason string) error {
	if sess.ActiveRole != core.RoleAdmin {
		return core.ErrForbidden
	}
	recipient = safe(recipient)
	if recipient != "client" && recipient != "courier" {
		return core.ErrInvalidInput
	}
	template := "client_order_status"
	if recipient == "courier" {
		template = "courier_ready_order"
	}
	reason = safe(reason)
	if !optionalText(reason, maxReasonLength) {
		return core.ErrInvalidInput
	}
	var status core.FulfillmentStatus
	var fulfillmentType core.FulfillmentType
	if err := s.pool.QueryRow(ctx, `SELECT fulfillment_status, fulfillment_type FROM orders WHERE id=$1`, orderID).Scan(&status, &fulfillmentType); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return core.ErrInvalidInput
		}
		return err
	}
	if recipient == "courier" && (status != core.StatusOutForDelivery || fulfillmentType != core.FulfillmentDelivery) {
		return core.ErrOrderStatusConflict
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
		VALUES ($1, $2, $3, $4)
	`, orderID, recipient, template, fmt.Sprintf("order:%s:resend:%s:%d", orderID, recipient, time.Now().UnixNano()))
	if err != nil {
		return err
	}
	return s.insertAudit(ctx, sess, "order.resend_notification", "order", &orderID, reason, nil, map[string]any{"recipient": recipient})
}

func (s *Store) AddOrderNote(ctx context.Context, sess core.Session, orderID uuid.UUID, reason string) error {
	if sess.ActiveRole != core.RoleAdmin {
		return core.ErrForbidden
	}
	reason = safe(reason)
	if !requiredText(reason, maxReasonLength) {
		return core.ErrInvalidInput
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO order_events (order_id, action, actor_user_id, actor_role, reason)
		VALUES ($1, 'admin_note', $2, $3, $4)
	`, orderID, sess.UserID, string(sess.ActiveRole), reason)
	if err != nil {
		return err
	}
	return s.insertAudit(ctx, sess, "order.note", "order", &orderID, reason, nil, nil)
}

func (s *Store) AdminStaff(ctx context.Context, sess core.Session) ([]core.StaffMember, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, telegram_user_id, display_label, role, active, created_at, updated_at
		FROM staff
		ORDER BY active DESC, role, telegram_user_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	staff := []core.StaffMember{}
	for rows.Next() {
		var member core.StaffMember
		if err := rows.Scan(&member.ID, &member.TelegramUserID, &member.DisplayLabel, &member.Role, &member.Active, &member.CreatedAt, &member.UpdatedAt); err != nil {
			return nil, err
		}
		staff = append(staff, member)
	}
	return staff, rows.Err()
}

func (s *Store) AddStaff(ctx context.Context, sess core.Session, input AddStaffInput) (core.StaffMember, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.StaffMember{}, core.ErrForbidden
	}
	if input.TelegramUserID <= 0 || !validStaffRole(input.Role) {
		return core.StaffMember{}, core.ErrInvalidInput
	}
	if input.DisplayLabel == "" {
		input.DisplayLabel = fmt.Sprintf("%d", input.TelegramUserID)
	}
	if !requiredText(input.DisplayLabel, maxStaffDisplayLabelLimit) {
		return core.StaffMember{}, core.ErrInvalidInput
	}

	user := core.User{
		TelegramUserID: input.TelegramUserID,
		FirstName:      safe(input.DisplayLabel),
		LanguageCode:   "ru",
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.StaffMember{}, err
	}
	defer rollback(ctx, tx)

	err = tx.QueryRow(ctx, `
		INSERT INTO users (telegram_user_id, username, first_name, photo_url, language_code)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (telegram_user_id)
		DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, photo_url=EXCLUDED.photo_url,
			language_code=EXCLUDED.language_code, updated_at=now()
		RETURNING id, telegram_user_id, username, first_name, photo_url, language_code
	`, user.TelegramUserID, "", safe(user.FirstName), "", safe(user.LanguageCode)).
		Scan(&user.ID, &user.TelegramUserID, &user.Username, &user.FirstName, &user.PhotoURL, &user.LanguageCode)
	if err != nil {
		return core.StaffMember{}, err
	}

	var existingID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id
		FROM staff
		WHERE telegram_user_id=$1 AND role=$2
		FOR UPDATE
	`, input.TelegramUserID, string(input.Role)).Scan(&existingID)
	if errors.Is(err, pgx.ErrNoRows) {
		existingID = uuid.Nil
	} else if err != nil {
		return core.StaffMember{}, err
	}
	if input.Active && input.Role == core.RoleCourier && !isOwnerTesterTelegramID(input.TelegramUserID) {
		if err := s.ensureNoOtherActiveCourier(ctx, tx, existingID); err != nil {
			return core.StaffMember{}, err
		}
	}

	var member core.StaffMember
	err = tx.QueryRow(ctx, `
		INSERT INTO staff (user_id, telegram_user_id, role, display_label, active, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (telegram_user_id, role)
		DO UPDATE SET user_id=EXCLUDED.user_id, display_label=EXCLUDED.display_label,
			active=EXCLUDED.active, updated_at=now()
		RETURNING id, telegram_user_id, display_label, role, active, created_at, updated_at
	`, user.ID, input.TelegramUserID, string(input.Role), safe(input.DisplayLabel), input.Active, sess.UserID).Scan(
		&member.ID,
		&member.TelegramUserID,
		&member.DisplayLabel,
		&member.Role,
		&member.Active,
		&member.CreatedAt,
		&member.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err, "uniq_staff_one_active_courier") {
			return core.StaffMember{}, core.ErrInvalidInput
		}
		return core.StaffMember{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "staff.upsert", "staff", &member.ID, "", nil, staffAudit(member)); err != nil {
		return core.StaffMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.StaffMember{}, err
	}
	return member, nil
}

func (s *Store) UpdateStaff(ctx context.Context, sess core.Session, id uuid.UUID, input UpdateStaffInput) (core.StaffMember, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.StaffMember{}, core.ErrForbidden
	}
	if !validStaffRole(input.Role) {
		return core.StaffMember{}, core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.StaffMember{}, err
	}
	defer rollback(ctx, tx)

	var before core.StaffMember
	err = tx.QueryRow(ctx, `
		SELECT id, telegram_user_id, display_label, role, active, created_at, updated_at
		FROM staff
		WHERE id=$1
		FOR UPDATE
	`, id).Scan(&before.ID, &before.TelegramUserID, &before.DisplayLabel, &before.Role, &before.Active, &before.CreatedAt, &before.UpdatedAt)
	if err != nil {
		return core.StaffMember{}, err
	}
	if before.Role == core.RoleAdmin && before.Active && (!input.Active || input.Role != core.RoleAdmin) {
		if err := s.ensureNotLastAdmin(ctx, tx, id); err != nil {
			return core.StaffMember{}, err
		}
	}
	if input.Active && input.Role == core.RoleCourier && !isOwnerTesterTelegramID(before.TelegramUserID) {
		if err := s.ensureNoOtherActiveCourier(ctx, tx, id); err != nil {
			return core.StaffMember{}, err
		}
	}
	if input.DisplayLabel == "" {
		input.DisplayLabel = before.DisplayLabel
	}
	if !requiredText(input.DisplayLabel, maxStaffDisplayLabelLimit) {
		return core.StaffMember{}, core.ErrInvalidInput
	}
	var after core.StaffMember
	err = tx.QueryRow(ctx, `
		UPDATE staff SET role=$1, display_label=$2, active=$3, updated_at=now()
		WHERE id=$4
		RETURNING id, telegram_user_id, display_label, role, active, created_at, updated_at
	`, string(input.Role), safe(input.DisplayLabel), input.Active, id).Scan(
		&after.ID,
		&after.TelegramUserID,
		&after.DisplayLabel,
		&after.Role,
		&after.Active,
		&after.CreatedAt,
		&after.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.StaffMember{}, core.ErrInvalidInput
	}
	if err != nil {
		if isUniqueViolation(err, "uniq_staff_one_active_courier") {
			return core.StaffMember{}, core.ErrInvalidInput
		}
		return core.StaffMember{}, err
	}
	if before.Active && (!after.Active || before.Role != after.Role) {
		if _, err := tx.Exec(ctx, `
			UPDATE sessions SET revoked_at=now()
			WHERE telegram_user_id=$1 AND active_role=$2 AND revoked_at IS NULL
		`, before.TelegramUserID, string(before.Role)); err != nil {
			return core.StaffMember{}, err
		}
	}
	if err := s.insertAuditTx(ctx, tx, sess, "staff.update", "staff", &id, "", staffAudit(before), staffAudit(after)); err != nil {
		return core.StaffMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.StaffMember{}, err
	}
	return after, nil
}

func (s *Store) AdminDashboard(ctx context.Context, sess core.Session, now time.Time) (core.AdminDashboard, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminDashboard{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.AdminDashboard{}, err
	}
	accept := core.CanAcceptOrder(now, settings)
	scheduleDay := core.ScheduleDayAt(now, settings)
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
	runtime := core.Runtime{
		ServerTime:               now.UTC(),
		Timezone:                 settings.Timezone,
		AcceptingOrders:          accept.OK,
		Reason:                   accept.Reason,
		NextOpening:              accept.NextOpening,
		OrderOpenTime:            scheduleDay.OpenTime,
		OrderCutoffTime:          scheduleDay.OrderCutoffTime,
		DayOffBanner:             settings.DayOffBanner,
		FlatDeliveryFeeMinor:     settings.FlatDeliveryFeeMinor,
		Currency:                 settings.Currency,
		EnabledPayments:          payments,
		SupportedLocales:         []string{"ru", "sr", "en"},
		SupportText:              settings.SupportText,
		CashLocationRequired:     settings.CashLocationRequired,
		CashLocationRadiusMeters: settings.CashLocationRadiusMeters,
		PickupEnabled:            settings.PickupEnabled,
		PickupAddress:            settings.PickupAddress,
		PickupMapURL:             settings.PickupMapURL,
		PickupMinLeadMinutes:     settings.PickupMinLeadMinutes,
		PickupSlotMinutes:        settings.PickupSlotMinutes,
		PickupLastTime:           settings.PickupLastTime,
		DeliveryTimingEnabled:    settings.DeliveryTimingEnabled,
		DeliveryMinLeadMinutes:   settings.DeliveryMinLeadMinutes,
		DeliverySlotMinutes:      settings.DeliverySlotMinutes,
		DeliveryLastTargetTime:   settings.DeliveryLastTargetTime,
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		loc = time.FixedZone("Europe/Belgrade", 3600)
	}
	localNow := now.In(loc)
	startLocal := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	endLocal := startLocal.Add(24 * time.Hour)
	dashboard := core.AdminDashboard{
		NotificationErrors: []string{},
	}
	err = s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE fulfillment_status='NEW')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='OUT_FOR_DELIVERY' AND fulfillment_type='delivery')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='READY_FOR_PICKUP' AND fulfillment_type='pickup')::int,
			COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int,
			COALESCE(SUM(total_minor) FILTER (
				WHERE created_at >= $1 AND created_at < $2
					AND fulfillment_status='DELIVERED' AND payment_status='PAID'
			), 0)::int
		FROM orders
	`, startLocal.UTC(), endLocal.UTC()).Scan(&dashboard.NewOrders, &dashboard.OutForDelivery, &dashboard.ReadyForPickup, &dashboard.OrdersToday, &dashboard.RevenueTodayMinor)
	if err != nil {
		return core.AdminDashboard{}, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT concat(template, ': ', last_error_code)
		FROM notification_jobs
		WHERE status='failed'
		ORDER BY updated_at DESC
		LIMIT 5
	`)
	if err != nil {
		return core.AdminDashboard{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var text string
		if err := rows.Scan(&text); err != nil {
			return core.AdminDashboard{}, err
		}
		dashboard.NotificationErrors = append(dashboard.NotificationErrors, text)
	}
	dashboard.Runtime = runtime
	dashboard.GeneratedAt = now.UTC()
	return dashboard, rows.Err()
}

func (s *Store) AdminAnalytics(ctx context.Context, sess core.Session, from, to time.Time, now time.Time) (core.AdminAnalytics, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminAnalytics{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	analytics := core.AdminAnalytics{
		Currency:          settings.Currency,
		From:              from.UTC(),
		To:                to.UTC(),
		GeneratedAt:       now.UTC(),
		Statuses:          []core.AnalyticsBreakdown{},
		Payments:          []core.AnalyticsBreakdown{},
		TopDishes:         []core.TopDish{},
		DailyRows:         []core.DailyAnalyticsRow{},
		DailyAudienceRows: []core.DailyAudienceRow{},
		Product: core.ProductAnalytics{
			Retention:     []core.RetentionMetric{},
			Screens:       []core.ProductMetric{},
			Clicks:        []core.ProductMetric{},
			OrderFunnel:   []core.ProductMetric{},
			BookingFunnel: []core.ProductMetric{},
		},
	}
	err = s.pool.QueryRow(ctx, `
		WITH visitors AS (
			SELECT user_id
			FROM client_app_visits
			WHERE visited_at >= $1 AND visited_at < $2
			GROUP BY user_id
		), order_stats AS (
			SELECT
				COUNT(DISTINCT client_user_id)::int AS customers,
				COUNT(DISTINCT client_user_id) FILTER (WHERE fulfillment_type='delivery')::int AS delivery_customers,
				COUNT(*) FILTER (WHERE fulfillment_type='delivery')::int AS delivery_orders,
				COUNT(DISTINCT client_user_id) FILTER (WHERE fulfillment_type='pickup')::int AS pickup_customers,
				COUNT(*) FILTER (WHERE fulfillment_type='pickup')::int AS pickup_orders
			FROM orders
			WHERE created_at >= $1 AND created_at < $2
		), reservation_stats AS (
			SELECT COUNT(DISTINCT client_user_id)::int AS customers, COUNT(*)::int AS reservations
			FROM reservations
			WHERE created_at >= $1 AND created_at < $2
		), converted AS (
			SELECT
				COUNT(*) FILTER (WHERE EXISTS (
					SELECT 1 FROM orders o WHERE o.client_user_id=v.user_id AND o.created_at >= $1 AND o.created_at < $2
				))::int AS order_customers,
				COUNT(*) FILTER (WHERE EXISTS (
					SELECT 1 FROM reservations r WHERE r.client_user_id=v.user_id AND r.created_at >= $1 AND r.created_at < $2
				))::int AS reservation_customers
			FROM visitors v
		)
		SELECT
			(SELECT COUNT(*) FROM client_app_visits WHERE visited_at >= $1 AND visited_at < $2)::int,
			(SELECT COUNT(*) FROM visitors)::int,
			o.customers, o.delivery_customers, o.delivery_orders, o.pickup_customers, o.pickup_orders,
			r.customers, r.reservations,
			COALESCE(ROUND(100.0 * c.order_customers / NULLIF((SELECT COUNT(*) FROM visitors), 0)), 0)::int,
			COALESCE(ROUND(100.0 * c.reservation_customers / NULLIF((SELECT COUNT(*) FROM visitors), 0)), 0)::int
		FROM order_stats o CROSS JOIN reservation_stats r CROSS JOIN converted c
	`, from.UTC(), to.UTC()).Scan(
		&analytics.Audience.Visits,
		&analytics.Audience.UniqueVisitors,
		&analytics.Audience.OrderingCustomers,
		&analytics.Audience.DeliveryCustomers,
		&analytics.Audience.DeliveryOrders,
		&analytics.Audience.PickupCustomers,
		&analytics.Audience.PickupOrders,
		&analytics.Audience.ReservationCustomers,
		&analytics.Audience.Reservations,
		&analytics.Audience.OrderConversionPercent,
		&analytics.Audience.ReservationConversionPercent,
	)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	retentionRows, err := s.pool.Query(ctx, `
		WITH first_visits AS (
			SELECT user_id, MIN((visited_at AT TIME ZONE $3)::date) AS first_day
			FROM client_app_visits
			GROUP BY user_id
		), periods(days) AS (VALUES (1), (7), (30))
		SELECT p.days,
			COUNT(*) FILTER (
				WHERE f.first_day >= ($1 AT TIME ZONE $3)::date
					AND f.first_day < ($2 AT TIME ZONE $3)::date
					AND f.first_day <= ($4 AT TIME ZONE $3)::date - p.days
			)::int AS eligible_users,
			COUNT(*) FILTER (
				WHERE f.first_day >= ($1 AT TIME ZONE $3)::date
					AND f.first_day < ($2 AT TIME ZONE $3)::date
					AND f.first_day <= ($4 AT TIME ZONE $3)::date - p.days
					AND EXISTS (
						SELECT 1 FROM client_app_visits v
						WHERE v.user_id=f.user_id
							AND (v.visited_at AT TIME ZONE $3)::date=f.first_day + p.days
					)
			)::int AS returned_users
		FROM periods p LEFT JOIN first_visits f ON true
		GROUP BY p.days
		ORDER BY p.days
	`, from.UTC(), to.UTC(), settings.Timezone, now.UTC())
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	for retentionRows.Next() {
		var row core.RetentionMetric
		if err := retentionRows.Scan(&row.Days, &row.EligibleUsers, &row.ReturnedUsers); err != nil {
			retentionRows.Close()
			return core.AdminAnalytics{}, err
		}
		if row.EligibleUsers > 0 {
			row.Percent = int(math.Round(100 * float64(row.ReturnedUsers) / float64(row.EligibleUsers)))
		}
		analytics.Product.Retention = append(analytics.Product.Retention, row)
	}
	retentionRows.Close()
	if err := retentionRows.Err(); err != nil {
		return core.AdminAnalytics{}, err
	}

	analytics.Product.Screens, err = s.productMetrics(ctx, from, to, "screen_view", 30)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	analytics.Product.Clicks, err = s.productMetrics(ctx, from, to, "click", 50)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	metric := func(key string, rows []core.ProductMetric) core.ProductMetric {
		for _, row := range rows {
			if row.Key == key {
				return row
			}
		}
		return core.ProductMetric{Key: key}
	}
	menu := metric("menu", analytics.Product.Screens)
	cart := metric("cart", analytics.Product.Screens)
	checkout := metric("checkout", analytics.Product.Screens)
	booking := metric("booking", analytics.Product.Screens)
	analytics.Product.OrderFunnel = []core.ProductMetric{
		{Key: "app_open", Events: analytics.Audience.Visits, UniqueUsers: analytics.Audience.UniqueVisitors},
		menu,
		cart,
		checkout,
		{Key: "order_created", Events: analytics.Audience.DeliveryOrders + analytics.Audience.PickupOrders, UniqueUsers: analytics.Audience.OrderingCustomers},
	}
	analytics.Product.BookingFunnel = []core.ProductMetric{
		{Key: "app_open", Events: analytics.Audience.Visits, UniqueUsers: analytics.Audience.UniqueVisitors},
		booking,
		{Key: "reservation_created", Events: analytics.Audience.Reservations, UniqueUsers: analytics.Audience.ReservationCustomers},
	}
	err = s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE fulfillment_status='DELIVERED')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='CANCELLED')::int,
			COALESCE(SUM(total_minor) FILTER (WHERE fulfillment_status='DELIVERED' AND payment_status='PAID'), 0)::int,
			COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE fulfillment_type='delivery' AND fulfillment_status<>'CANCELLED' AND delivery_target_at IS NOT NULL)
				/ NULLIF(COUNT(DISTINCT delivery_target_at) FILTER (WHERE fulfillment_type='delivery' AND fulfillment_status<>'CANCELLED' AND delivery_target_at IS NOT NULL) * $3, 0)), 0)::int,
			COALESCE(ROUND(AVG(delivery_queue_delay_minutes) FILTER (WHERE fulfillment_type='delivery' AND fulfillment_status<>'CANCELLED' AND delivery_target_at IS NOT NULL)), 0)::int,
			COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (ready_at - delivery_target_at)) / 60) FILTER (WHERE fulfillment_type='delivery' AND ready_at IS NOT NULL AND delivery_target_at IS NOT NULL)), 0)::int
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
	`, from.UTC(), to.UTC(), settings.DeliveryMaxOrdersPerSlot).Scan(
		&analytics.Summary.AllOrders,
		&analytics.Summary.DeliveredOrders,
		&analytics.Summary.CancelledOrders,
		&analytics.Summary.RevenueMinor,
		&analytics.Summary.DeliverySlotFillPercent,
		&analytics.Summary.AverageDeliveryQueueDelayMinutes,
		&analytics.Summary.AverageReadyPlanDeviationMinutes,
	)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	if analytics.Summary.DeliveredOrders > 0 {
		analytics.Summary.AverageCheckMinor = analytics.Summary.RevenueMinor / analytics.Summary.DeliveredOrders
	}
	statusRows, err := s.pool.Query(ctx, `
		SELECT fulfillment_status, COUNT(*)::int,
			COUNT(*) FILTER (WHERE fulfillment_status='DELIVERED')::int,
			COUNT(*) FILTER (WHERE payment_status='PAID')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='CANCELLED')::int,
			COALESCE(SUM(total_minor) FILTER (WHERE fulfillment_status='DELIVERED' AND payment_status='PAID'), 0)::int
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY fulfillment_status
		ORDER BY fulfillment_status
	`, from.UTC(), to.UTC())
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	defer statusRows.Close()
	for statusRows.Next() {
		var row core.AnalyticsBreakdown
		if err := statusRows.Scan(&row.Key, &row.Count, &row.DeliveredCount, &row.PaidCount, &row.CancelledCount, &row.RevenueMinor); err != nil {
			return core.AdminAnalytics{}, err
		}
		analytics.Statuses = append(analytics.Statuses, row)
	}
	if err := statusRows.Err(); err != nil {
		return core.AdminAnalytics{}, err
	}
	paymentRows, err := s.pool.Query(ctx, `
		SELECT payment_method, COUNT(*)::int,
			COUNT(*) FILTER (WHERE fulfillment_status='DELIVERED')::int,
			COUNT(*) FILTER (WHERE payment_status='PAID')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='CANCELLED')::int,
			COALESCE(SUM(total_minor) FILTER (WHERE fulfillment_status='DELIVERED' AND payment_status='PAID'), 0)::int
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY payment_method
		ORDER BY payment_method
	`, from.UTC(), to.UTC())
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	defer paymentRows.Close()
	for paymentRows.Next() {
		var row core.AnalyticsBreakdown
		if err := paymentRows.Scan(&row.Key, &row.Count, &row.DeliveredCount, &row.PaidCount, &row.CancelledCount, &row.RevenueMinor); err != nil {
			return core.AdminAnalytics{}, err
		}
		analytics.Payments = append(analytics.Payments, row)
	}
	if err := paymentRows.Err(); err != nil {
		return core.AdminAnalytics{}, err
	}
	topRows, err := s.pool.Query(ctx, `
		SELECT oi.snapshot_title, SUM(oi.quantity)::int, SUM(oi.line_total_minor)::int
		FROM order_items oi
		JOIN orders o ON o.id=oi.order_id
		WHERE o.created_at >= $1 AND o.created_at < $2
			AND o.fulfillment_status='DELIVERED' AND o.payment_status='PAID'
		GROUP BY oi.snapshot_title
		ORDER BY SUM(oi.quantity) DESC, oi.snapshot_title
		LIMIT 10
	`, from.UTC(), to.UTC())
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	defer topRows.Close()
	for topRows.Next() {
		var row core.TopDish
		if err := topRows.Scan(&row.Title, &row.Quantity, &row.RevenueMinor); err != nil {
			return core.AdminAnalytics{}, err
		}
		analytics.TopDishes = append(analytics.TopDishes, row)
	}
	if err := topRows.Err(); err != nil {
		return core.AdminAnalytics{}, err
	}
	dailyRows, err := s.pool.Query(ctx, `
		SELECT to_char(created_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE fulfillment_status='DELIVERED')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='CANCELLED')::int,
			COALESCE(SUM(total_minor) FILTER (WHERE fulfillment_status='DELIVERED' AND payment_status='PAID'), 0)::int
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY day
		ORDER BY day
	`, from.UTC(), to.UTC(), settings.Timezone)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	defer dailyRows.Close()
	for dailyRows.Next() {
		var row core.DailyAnalyticsRow
		if err := dailyRows.Scan(&row.Day, &row.Orders, &row.Delivered, &row.Cancelled, &row.RevenueMinor); err != nil {
			return core.AdminAnalytics{}, err
		}
		analytics.DailyRows = append(analytics.DailyRows, row)
	}
	if err := dailyRows.Err(); err != nil {
		return core.AdminAnalytics{}, err
	}
	audienceRows, err := s.pool.Query(ctx, `
		WITH activity AS (
			SELECT (visited_at AT TIME ZONE $3)::date AS day, COUNT(*)::int AS visits,
				COUNT(DISTINCT user_id)::int AS unique_visitors, 0::int AS delivery_orders,
				0::int AS pickup_orders, 0::int AS reservations
			FROM client_app_visits WHERE visited_at >= $1 AND visited_at < $2 GROUP BY day
			UNION ALL
			SELECT (created_at AT TIME ZONE $3)::date, 0, 0,
				COUNT(*) FILTER (WHERE fulfillment_type='delivery')::int,
				COUNT(*) FILTER (WHERE fulfillment_type='pickup')::int, 0
			FROM orders WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
			UNION ALL
			SELECT (created_at AT TIME ZONE $3)::date, 0, 0, 0, 0, COUNT(*)::int
			FROM reservations WHERE created_at >= $1 AND created_at < $2 GROUP BY 1
		)
		SELECT to_char(day, 'YYYY-MM-DD'), SUM(visits)::int, SUM(unique_visitors)::int,
			SUM(delivery_orders)::int, SUM(pickup_orders)::int, SUM(reservations)::int
		FROM activity GROUP BY day ORDER BY day
	`, from.UTC(), to.UTC(), settings.Timezone)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	defer audienceRows.Close()
	for audienceRows.Next() {
		var row core.DailyAudienceRow
		if err := audienceRows.Scan(&row.Day, &row.Visits, &row.UniqueVisitors, &row.DeliveryOrders, &row.PickupOrders, &row.Reservations); err != nil {
			return core.AdminAnalytics{}, err
		}
		analytics.DailyAudienceRows = append(analytics.DailyAudienceRows, row)
	}
	return analytics, audienceRows.Err()
}

func (s *Store) productMetrics(ctx context.Context, from, to time.Time, eventName string, limit int) ([]core.ProductMetric, error) {
	keyColumn := "screen"
	if eventName == "click" {
		keyColumn = "target"
	}
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT %s, COUNT(*)::int, COUNT(DISTINCT user_id)::int
		FROM client_product_events
		WHERE occurred_at >= $1 AND occurred_at < $2 AND event_name=$3 AND %s<>''
		GROUP BY %s
		ORDER BY COUNT(*) DESC, %s
		LIMIT $4
	`, keyColumn, keyColumn, keyColumn, keyColumn), from.UTC(), to.UTC(), eventName, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []core.ProductMetric{}
	for rows.Next() {
		var row core.ProductMetric
		if err := rows.Scan(&row.Key, &row.Events, &row.UniqueUsers); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Store) AuditLog(ctx context.Context, sess core.Session, filter AuditLogFilter) (AuditLogPage, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return AuditLogPage{}, core.ErrForbidden
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, actor_role, action, target_type, target_id, reason, before_json, after_json, created_at
		FROM audit_log
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, limit+1, offset)
	if err != nil {
		return AuditLogPage{}, err
	}
	defer rows.Close()
	entries := []core.AuditEntry{}
	for rows.Next() {
		var entry core.AuditEntry
		var targetID *uuid.UUID
		var beforeRaw, afterRaw []byte
		if err := rows.Scan(&entry.ID, &entry.ActorRole, &entry.Action, &entry.TargetType, &targetID, &entry.Reason, &beforeRaw, &afterRaw, &entry.CreatedAt); err != nil {
			return AuditLogPage{}, err
		}
		entry.TargetID = targetID
		_ = json.Unmarshal(beforeRaw, &entry.Before)
		_ = json.Unmarshal(afterRaw, &entry.After)
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return AuditLogPage{}, err
	}
	hasMore := len(entries) > limit
	if hasMore {
		entries = entries[:limit]
	}
	return AuditLogPage{Entries: entries, Limit: limit, Offset: offset, HasMore: hasMore}, nil
}

func (s *Store) AddOrderItems(ctx context.Context, sess core.Session, orderID uuid.UUID, input AddOrderItemsInput, idempotencyKey, requestHash string, now time.Time) (core.Order, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Order{}, core.ErrForbidden
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return core.Order{}, core.ErrIdempotencyConflict
	}
	if input.ExpectedVersion <= 0 {
		return core.Order{}, core.ErrInvalidInput
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.Order{}, err
	}
	accept := core.CanAcceptOrder(now, settings)
	if !accept.OK {
		if accept.Reason == "manual_day_off" {
			return core.Order{}, core.ErrManualDayOff
		}
		return core.Order{}, core.ErrRestaurantClosed
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)

	if existingID, replay, err := s.beginIdempotency(ctx, tx, sess.UserID, "orders.add_items", idempotencyKey, requestHash); err != nil {
		return core.Order{}, err
	} else if replay {
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, existingID, true)
	}

	var status core.FulfillmentStatus
	var fulfillmentType core.FulfillmentType
	var paymentMethod core.PaymentMethod
	var orderVersion int
	var createdAt time.Time
	var pickupAt, pickupCookAt, kitchenStartedAt sql.NullTime
	var orderSubtotal, orderTotal int
	var orderCurrency string
	err = tx.QueryRow(ctx, `
		SELECT fulfillment_status, fulfillment_type, payment_method, version, created_at, pickup_at, pickup_cook_at, kitchen_started_at,
			subtotal_minor, total_minor, currency
		FROM orders
		WHERE id=$1 AND client_user_id=$2
		FOR UPDATE
	`, orderID, sess.UserID).Scan(&status, &fulfillmentType, &paymentMethod, &orderVersion, &createdAt, &pickupAt, &pickupCookAt, &kitchenStartedAt, &orderSubtotal, &orderTotal, &orderCurrency)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrForbidden
	}
	if err != nil {
		return core.Order{}, err
	}
	if status != core.StatusNew || paymentMethod != core.PaymentCash || orderVersion != input.ExpectedVersion || kitchenStartedAt.Valid {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if !now.UTC().Before(additionCutoff(createdAt, pickupAt, pickupCookAt, fulfillmentType, settings)) {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	var alreadyAdded bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM order_additions WHERE order_id=$1)`, orderID).Scan(&alreadyAdded); err != nil {
		return core.Order{}, err
	}
	if alreadyAdded {
		return core.Order{}, core.ErrOrderStatusConflict
	}

	tokenHash := hashString(input.CalculationToken)
	var rawItems []byte
	var subtotal, delivery, total int
	var currency string
	err = tx.QueryRow(ctx, `
		SELECT items_json, subtotal_minor, delivery_fee_minor, total_minor, currency
		FROM calculation_tokens
		WHERE token_hash=$1 AND user_id=$2 AND purpose='addition' AND order_id=$3 AND used_at IS NULL AND expires_at > now()
		FOR UPDATE
	`, tokenHash, sess.UserID, orderID).Scan(&rawItems, &subtotal, &delivery, &total, &currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrCalculationExpired
	}
	if err != nil {
		return core.Order{}, err
	}
	if currency != orderCurrency {
		return core.Order{}, core.ErrCalculationExpired
	}
	var items []core.CalculatedItem
	if err := json.Unmarshal(rawItems, &items); err != nil {
		return core.Order{}, err
	}
	items, subtotal, currency, err = s.revalidateAdditionCalculationTx(ctx, tx, orderID, items, subtotal, delivery, total, currency)
	if err != nil {
		return core.Order{}, err
	}

	var additionID uuid.UUID
	var additionCreatedAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO order_additions (order_id, client_user_id, revision, subtotal_minor, currency)
		VALUES ($1, $2, 1, $3, $4)
		RETURNING id, created_at
	`, orderID, sess.UserID, subtotal, currency).Scan(&additionID, &additionCreatedAt)
	if err != nil {
		if isUniqueViolation(err, "order_additions_order_id_key") {
			return core.Order{}, core.ErrOrderStatusConflict
		}
		return core.Order{}, err
	}

	var sortOrder int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(sort_order), -1) + 1 FROM order_items WHERE order_id=$1`, orderID).Scan(&sortOrder); err != nil {
		return core.Order{}, err
	}
	for _, item := range items {
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_items (
				order_id, menu_item_id, snapshot_title, unit_price_minor, quantity, line_total_minor, sort_order, addition_id
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, orderID, item.ItemID, item.Title, item.UnitPriceMinor, item.Quantity, item.LineTotalMinor, sortOrder, additionID); err != nil {
			return core.Order{}, err
		}
		sortOrder++
	}

	_, err = tx.Exec(ctx, `
		UPDATE orders
		SET subtotal_minor=$2, total_minor=$3, updated_at=now(), version=version+1
		WHERE id=$1
	`, orderID, orderSubtotal+subtotal, orderTotal+subtotal)
	if err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE calculation_tokens SET used_at=now() WHERE token_hash=$1`, tokenHash); err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role, reason)
		VALUES ($1, 'NEW', 'NEW', 'client_add_items', $2, 'CLIENT', $3)
	`, orderID, sess.UserID, fmt.Sprintf("Дозаказ %d RSD", subtotal)); err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
		VALUES ($1, 'kitchen', 'kitchen_order_addition', $2)
		ON CONFLICT (event_key, recipient_kind) DO NOTHING
	`, orderID, fmt.Sprintf("order:%s:addition:%s", orderID, additionID)); err != nil {
		return core.Order{}, err
	}
	if err := s.finishIdempotency(ctx, tx, sess.UserID, "orders.add_items", idempotencyKey, orderID); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	order, err := s.OrderByID(ctx, orderID, true)
	if err != nil {
		return core.Order{}, err
	}
	if order.LatestAddition != nil {
		order.LatestAddition.CreatedAt = additionCreatedAt
	}
	return order, nil
}

func (s *Store) MarkReady(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion ...int) (core.Order, error) {
	if sess.ActiveRole != core.RoleKitchen {
		return core.Order{}, core.ErrForbidden
	}
	return s.transition(ctx, sess, orderID, "orders.mark_ready", idempotencyKey, requestHash, core.StatusNew, core.StatusOutForDelivery, expectedVersionValue(expectedVersion))
}

func (s *Store) EstimateReady(ctx context.Context, sess core.Session, orderID uuid.UUID, input EstimateReadyInput, idempotencyKey, requestHash string, now time.Time) (core.Order, error) {
	if sess.ActiveRole != core.RoleKitchen {
		return core.Order{}, core.ErrForbidden
	}
	if strings.TrimSpace(idempotencyKey) == "" || input.ExpectedVersion <= 0 || (input.ReadyInMinutes == nil) == (input.EstimatedReadyAt == nil) {
		return core.Order{}, core.ErrInvalidInput
	}
	var target time.Time
	if input.ReadyInMinutes != nil {
		if *input.ReadyInMinutes < 5 || *input.ReadyInMinutes > 180 || *input.ReadyInMinutes%5 != 0 {
			return core.Order{}, core.ErrInvalidInput
		}
		target = now.UTC().Add(time.Duration(*input.ReadyInMinutes) * time.Minute).Truncate(time.Minute)
	} else {
		target = input.EstimatedReadyAt.UTC().Truncate(time.Minute)
		minimum := now.UTC().Truncate(time.Minute)
		maximum := now.UTC().Add(180 * time.Minute).Truncate(time.Minute)
		if target.Before(minimum) || target.After(maximum) || target.Minute()%5 != 0 {
			return core.Order{}, core.ErrInvalidInput
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)
	if existingID, replay, err := s.beginIdempotency(ctx, tx, sess.UserID, "orders.estimate_ready", idempotencyKey, requestHash); err != nil {
		return core.Order{}, err
	} else if replay {
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, existingID, false)
	}
	var currentStatus core.FulfillmentStatus
	var fulfillment core.FulfillmentType
	var currentVersion int
	var previous sql.NullTime
	if err := tx.QueryRow(ctx, `SELECT fulfillment_status, fulfillment_type, version, estimated_ready_at FROM orders WHERE id=$1 FOR UPDATE`, orderID).
		Scan(&currentStatus, &fulfillment, &currentVersion, &previous); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return core.Order{}, core.ErrOrderStatusConflict
		}
		return core.Order{}, err
	}
	if currentStatus != core.StatusNew || fulfillment != core.FulfillmentDelivery || currentVersion != input.ExpectedVersion {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if previous.Valid && previous.Time.UTC().Equal(target) {
		if err := s.finishIdempotency(ctx, tx, sess.UserID, "orders.estimate_ready", idempotencyKey, orderID); err != nil {
			return core.Order{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, orderID, false)
	}
	var newVersion int
	if err := tx.QueryRow(ctx, `
		UPDATE orders SET estimated_ready_at=$2, estimated_ready_updated_at=now(), estimated_ready_by=$3,
			updated_at=now(), version=version+1
		WHERE id=$1 RETURNING version
	`, orderID, target, sess.UserID).Scan(&newVersion); err != nil {
		return core.Order{}, err
	}
	action := "kitchen.estimate_ready"
	template := "client_kitchen_eta_set"
	if previous.Valid {
		action = "kitchen.update_estimated_ready"
		template = "client_kitchen_eta_updated"
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role, reason)
		VALUES ($1, 'NEW', 'NEW', $2, $3, 'KITCHEN', $4)
	`, orderID, action, sess.UserID, fmt.Sprintf("version=%d;at=%s", newVersion, target.Format(time.RFC3339))); err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
		VALUES ($1, 'client', $2, $3)
		ON CONFLICT (event_key, recipient_kind) DO NOTHING
	`, orderID, template, fmt.Sprintf("order:%s:eta:%d", orderID, newVersion)); err != nil {
		return core.Order{}, err
	}
	if err := s.finishIdempotency(ctx, tx, sess.UserID, "orders.estimate_ready", idempotencyKey, orderID); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.OrderByID(ctx, orderID, false)
}

func (s *Store) StartKitchenPreparation(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion int) (core.Order, error) {
	return s.setKitchenPreparation(ctx, sess, orderID, idempotencyKey, requestHash, expectedVersion, true)
}

func (s *Store) ResetKitchenPreparation(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion int) (core.Order, error) {
	return s.setKitchenPreparation(ctx, sess, orderID, idempotencyKey, requestHash, expectedVersion, false)
}

func (s *Store) setKitchenPreparation(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion int, started bool) (core.Order, error) {
	if sess.ActiveRole != core.RoleKitchen {
		return core.Order{}, core.ErrForbidden
	}
	if strings.TrimSpace(idempotencyKey) == "" || expectedVersion <= 0 {
		return core.Order{}, core.ErrIdempotencyConflict
	}
	operation := "orders.start_kitchen_preparation"
	action := "kitchen_preparation_started"
	if !started {
		operation = "orders.reset_kitchen_preparation"
		action = "kitchen_preparation_reset"
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)

	if existingID, replay, err := s.beginIdempotency(ctx, tx, sess.UserID, operation, idempotencyKey, requestHash); err != nil {
		return core.Order{}, err
	} else if replay {
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, existingID, false)
	}

	var updatedID uuid.UUID
	if started {
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET kitchen_started_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_status='NEW' AND kitchen_started_at IS NULL AND version=$2
			RETURNING id
		`, orderID, expectedVersion).Scan(&updatedID)
	} else {
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET kitchen_started_at=NULL, updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_status='NEW' AND kitchen_started_at IS NOT NULL AND version=$2
			RETURNING id
		`, orderID, expectedVersion).Scan(&updatedID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role)
		VALUES ($1, 'NEW', 'NEW', $2, $3, $4)
	`, orderID, action, sess.UserID, string(sess.ActiveRole)); err != nil {
		return core.Order{}, err
	}
	if started {
		if _, err := tx.Exec(ctx, `
			INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
			SELECT id, 'admin', 'owner_delivery_alert_started',
				'order:' || id::text || ':delivery-alert:started:owner:' || $2::bigint::text
			FROM orders
			WHERE id=$1 AND fulfillment_type='delivery'
			ON CONFLICT (event_key, recipient_kind) DO NOTHING
		`, orderID, deliveryAlertTelegramID); err != nil {
			return core.Order{}, err
		}
	}
	if err := s.finishIdempotency(ctx, tx, sess.UserID, operation, idempotencyKey, orderID); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.OrderByID(ctx, orderID, false)
}

func (s *Store) MarkDelivered(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion ...int) (core.Order, error) {
	if sess.ActiveRole != core.RoleCourier {
		return core.Order{}, core.ErrForbidden
	}
	return s.transition(ctx, sess, orderID, "orders.mark_delivered", idempotencyKey, requestHash, core.StatusOutForDelivery, core.StatusDelivered, expectedVersionValue(expectedVersion))
}

func (s *Store) StartCourierDelivery(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion int) (core.Order, error) {
	return s.setCourierDelivery(ctx, sess, orderID, idempotencyKey, requestHash, expectedVersion, true)
}

func (s *Store) ResetCourierDelivery(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion int) (core.Order, error) {
	return s.setCourierDelivery(ctx, sess, orderID, idempotencyKey, requestHash, expectedVersion, false)
}

func (s *Store) setCourierDelivery(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion int, started bool) (core.Order, error) {
	if sess.ActiveRole != core.RoleCourier {
		return core.Order{}, core.ErrForbidden
	}
	if strings.TrimSpace(idempotencyKey) == "" || expectedVersion <= 0 {
		return core.Order{}, core.ErrIdempotencyConflict
	}
	operation := "orders.start_courier_delivery"
	action := "courier_delivery_started"
	if !started {
		operation = "orders.reset_courier_delivery"
		action = "courier_delivery_reset"
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)

	if existingID, replay, err := s.beginIdempotency(ctx, tx, sess.UserID, operation, idempotencyKey, requestHash); err != nil {
		return core.Order{}, err
	} else if replay {
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, existingID, true)
	}

	var updatedID uuid.UUID
	if started {
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET courier_started_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_status='OUT_FOR_DELIVERY' AND courier_started_at IS NULL AND version=$2
			RETURNING id
		`, orderID, expectedVersion).Scan(&updatedID)
	} else {
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET courier_started_at=NULL, updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_status='OUT_FOR_DELIVERY' AND courier_started_at IS NOT NULL AND version=$2
			RETURNING id
		`, orderID, expectedVersion).Scan(&updatedID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role)
		VALUES ($1, 'OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY', $2, $3, $4)
	`, orderID, action, sess.UserID, string(sess.ActiveRole)); err != nil {
		return core.Order{}, err
	}
	if err := s.finishIdempotency(ctx, tx, sess.UserID, operation, idempotencyKey, orderID); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.OrderByID(ctx, orderID, true)
}

func (s *Store) MarkPickupCollected(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string, expectedVersion ...int) (core.Order, error) {
	if sess.ActiveRole != core.RoleKitchen {
		return core.Order{}, core.ErrForbidden
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return core.Order{}, core.ErrIdempotencyConflict
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)

	if existingID, replay, err := s.beginIdempotency(ctx, tx, sess.UserID, "orders.mark_pickup_collected", idempotencyKey, requestHash); err != nil {
		return core.Order{}, err
	} else if replay {
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, existingID, false)
	}

	expectedVersionNumber := expectedVersionValue(expectedVersion)
	var updatedID uuid.UUID
	err = tx.QueryRow(ctx, `
		UPDATE orders
		SET fulfillment_status='DELIVERED',
			payment_status=CASE WHEN payment_method='cash' THEN 'PAID' ELSE payment_status END,
			delivered_at=now(), updated_at=now(), version=version+1
		WHERE id=$1
			AND fulfillment_type='pickup'
		AND fulfillment_status='READY_FOR_PICKUP'
			AND ($2::int <= 0 OR version=$2)
		RETURNING id
	`, orderID, expectedVersionNumber).Scan(&updatedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role)
		VALUES ($1, 'READY_FOR_PICKUP', 'DELIVERED', 'mark_pickup_collected', $2, $3)
	`, orderID, sess.UserID, string(sess.ActiveRole)); err != nil {
		return core.Order{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
		VALUES ($1, 'client', 'client_order_pickup_completed', $2)
		ON CONFLICT (event_key, recipient_kind) DO NOTHING
	`, orderID, fmt.Sprintf("order:%s:pickup-collected", orderID)); err != nil {
		return core.Order{}, err
	}
	if err := s.finishIdempotency(ctx, tx, sess.UserID, "orders.mark_pickup_collected", idempotencyKey, orderID); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.OrderByID(ctx, orderID, false)
}

func expectedVersionValue(values []int) int {
	if len(values) == 0 {
		return 0
	}
	return values[0]
}

func (s *Store) SendCourierETA(ctx context.Context, sess core.Session, orderID uuid.UUID, minutes int) error {
	if sess.ActiveRole != core.RoleCourier {
		return core.ErrForbidden
	}
	if minutes != 5 && minutes != 10 && minutes != 15 && minutes != 20 {
		return core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx)

	var publicNumber int
	err = tx.QueryRow(ctx, `
		SELECT public_number
		FROM orders
		WHERE id=$1 AND fulfillment_status='OUT_FOR_DELIVERY' AND fulfillment_type='delivery'
		FOR UPDATE
	`, orderID).Scan(&publicNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.ErrOrderStatusConflict
	}
	if err != nil {
		return err
	}
	reason := fmt.Sprintf("Курьер сообщил клиенту ETA %d минут", minutes)
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, action, actor_user_id, actor_role, reason)
		VALUES ($1, 'courier_eta', $2, $3, $4)
	`, orderID, sess.UserID, string(sess.ActiveRole), reason); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
		VALUES ($1, 'client', $2, $3)
	`, orderID, fmt.Sprintf("client_eta_%d", minutes), fmt.Sprintf("order:%s:eta:%d:%d", orderID, minutes, time.Now().UnixNano())); err != nil {
		return err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "order.courier_eta", "order", &orderID, reason, nil, map[string]any{"public_number": publicNumber, "minutes": minutes}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) transition(ctx context.Context, sess core.Session, orderID uuid.UUID, operation, idempotencyKey, requestHash string, from, to core.FulfillmentStatus, expectedVersion int) (core.Order, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return core.Order{}, core.ErrIdempotencyConflict
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)

	if existingID, replay, err := s.beginIdempotency(ctx, tx, sess.UserID, operation, idempotencyKey, requestHash); err != nil {
		return core.Order{}, err
	} else if replay {
		if err := tx.Commit(ctx); err != nil {
			return core.Order{}, err
		}
		return s.OrderByID(ctx, existingID, sess.ActiveRole != core.RoleKitchen)
	}

	var updatedID uuid.UUID
	var previous string
	var action string
	var orderVersion int
	var fulfillmentType core.FulfillmentType
	var actualTo core.FulfillmentStatus
	if to == core.StatusOutForDelivery {
		action = "mark_ready"
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET fulfillment_status=CASE WHEN fulfillment_type='pickup' THEN 'READY_FOR_PICKUP' ELSE 'OUT_FOR_DELIVERY' END,
				ready_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_status='NEW' AND ($2::int <= 0 OR version=$2)
			RETURNING id, 'NEW', version, fulfillment_type, fulfillment_status
		`, orderID, expectedVersion).Scan(&updatedID, &previous, &orderVersion, &fulfillmentType, &actualTo)
	} else {
		action = "mark_delivered"
		actualTo = core.StatusDelivered
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET fulfillment_status='DELIVERED', payment_status='PAID', delivered_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_type='delivery' AND fulfillment_status='OUT_FOR_DELIVERY' AND ($2::int <= 0 OR version=$2)
			RETURNING id, 'OUT_FOR_DELIVERY', version, fulfillment_type
		`, orderID, expectedVersion).Scan(&updatedID, &previous, &orderVersion, &fulfillmentType)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if err != nil {
		return core.Order{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, orderID, string(from), string(actualTo), action, sess.UserID, string(sess.ActiveRole))
	if err != nil {
		return core.Order{}, err
	}
	if to == core.StatusOutForDelivery {
		if fulfillmentType == core.FulfillmentPickup {
			if _, err := tx.Exec(ctx, `
				INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
				VALUES ($1, 'client', 'client_order_ready_for_pickup', $2)
				ON CONFLICT (event_key, recipient_kind) DO NOTHING
			`, orderID, fmt.Sprintf("order:%s:ready:%d", orderID, orderVersion)); err != nil {
				return core.Order{}, err
			}
		} else {
			if _, err := tx.Exec(ctx, `
				INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
				VALUES
					($1, 'client', 'client_order_out_for_delivery', $2),
					($1, 'courier', 'courier_ready_order', $2)
				ON CONFLICT (event_key, recipient_kind) DO NOTHING
			`, orderID, fmt.Sprintf("order:%s:ready:%d", orderID, orderVersion)); err != nil {
				return core.Order{}, err
			}
		}
	} else {
		if _, err := tx.Exec(ctx, `
			INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
			VALUES ($1, 'client', 'client_order_delivered', $2)
			ON CONFLICT (event_key, recipient_kind) DO NOTHING
		`, orderID, fmt.Sprintf("order:%s:delivered", orderID)); err != nil {
			return core.Order{}, err
		}
	}
	if err := s.finishIdempotency(ctx, tx, sess.UserID, operation, idempotencyKey, orderID); err != nil {
		return core.Order{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Order{}, err
	}
	return s.OrderByID(ctx, orderID, sess.ActiveRole != core.RoleKitchen)
}

func (s *Store) OrderByID(ctx context.Context, orderID uuid.UUID, includePII bool) (core.Order, error) {
	var order core.Order
	var phoneCipher, addressCipher string
	var kitchenStarted, courierStarted, ready, delivered, cancelled sql.NullTime
	var locationVerified sql.NullTime
	var locationDistance sql.NullInt32
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.public_number, o.client_user_id, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_type, o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency, o.phone_ciphertext, o.address_ciphertext,
			o.customer_comment, o.locale, o.version, o.created_at, o.kitchen_started_at, o.courier_started_at, o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=$1
	`, orderID).Scan(
		&order.ID, &order.PublicNumber, &order.ClientUserID, &order.ClientUsername, &order.ClientFirstName, &order.ClientPhotoURL,
		&order.FulfillmentType, &order.FulfillmentStatus, &order.PaymentMethod,
		&order.PaymentStatus, &order.SubtotalMinor, &order.DeliveryFeeMinor, &order.TotalMinor, &order.Currency,
		&phoneCipher, &addressCipher, &order.CustomerComment, &order.Locale, &order.Version, &order.CreatedAt,
		&kitchenStarted, &courierStarted, &ready, &delivered, &cancelled,
		&locationVerified, &locationDistance,
	)
	if err != nil {
		return core.Order{}, err
	}
	if includePII {
		if order.Phone, err = s.box.Decrypt(phoneCipher); err != nil {
			return core.Order{}, err
		}
		if order.Address, err = s.box.Decrypt(addressCipher); err != nil {
			return core.Order{}, err
		}
	}
	if kitchenStarted.Valid {
		order.KitchenStartedAt = &kitchenStarted.Time
	}
	if courierStarted.Valid {
		order.CourierStartedAt = &courierStarted.Time
	}
	if ready.Valid {
		order.ReadyAt = &ready.Time
	}
	if delivered.Valid {
		order.DeliveredAt = &delivered.Time
	}
	if cancelled.Valid {
		order.CancelledAt = &cancelled.Time
	}
	if locationVerified.Valid {
		order.CashLocationVerifiedAt = &locationVerified.Time
	}
	if locationDistance.Valid {
		value := int(locationDistance.Int32)
		order.CashLocationDistanceMeters = &value
	}
	var pickupAt, pickupOriginalAt, pickupCookAtValue, deliveryRequestedAt, deliveryTargetAt, estimatedReadyAt, estimatedReadyUpdatedAt sql.NullTime
	var estimatedReadyBy uuid.NullUUID
	if err := s.pool.QueryRow(ctx, `
		SELECT pickup_at, pickup_original_at, pickup_cook_at, pickup_address_snapshot, pickup_instructions_snapshot,
			delivery_time_mode, delivery_requested_at, delivery_target_at, delivery_queue_delay_minutes,
			estimated_ready_at, estimated_ready_updated_at, estimated_ready_by
		FROM orders WHERE id=$1
	`, orderID).Scan(&pickupAt, &pickupOriginalAt, &pickupCookAtValue, &order.PickupAddress, &order.PickupInstructions,
		&order.DeliveryTimeMode, &deliveryRequestedAt, &deliveryTargetAt, &order.DeliveryQueueDelayMinutes,
		&estimatedReadyAt, &estimatedReadyUpdatedAt, &estimatedReadyBy); err != nil {
		return core.Order{}, err
	}
	if pickupAt.Valid {
		order.PickupAt = &pickupAt.Time
	}
	if pickupOriginalAt.Valid {
		order.PickupOriginalAt = &pickupOriginalAt.Time
	}
	if pickupCookAtValue.Valid {
		order.PickupCookAt = &pickupCookAtValue.Time
	}
	if deliveryRequestedAt.Valid {
		order.DeliveryRequestedAt = &deliveryRequestedAt.Time
	}
	if deliveryTargetAt.Valid {
		order.DeliveryTargetAt = &deliveryTargetAt.Time
	}
	if estimatedReadyAt.Valid {
		order.EstimatedReadyAt = &estimatedReadyAt.Time
	}
	if estimatedReadyUpdatedAt.Valid {
		order.EstimatedReadyUpdatedAt = &estimatedReadyUpdatedAt.Time
	}
	if estimatedReadyBy.Valid {
		value := estimatedReadyBy.UUID
		order.EstimatedReadyBy = &value
	}
	items, err := s.orderItems(ctx, order.ID)
	if err != nil {
		return core.Order{}, err
	}
	order.Items = items
	var addition core.OrderAddition
	err = s.pool.QueryRow(ctx, `
		SELECT id, revision, subtotal_minor, currency, created_at
		FROM order_additions
		WHERE order_id=$1
		ORDER BY created_at DESC
		LIMIT 1
	`, order.ID).Scan(&addition.ID, &addition.Revision, &addition.SubtotalMinor, &addition.Currency, &addition.CreatedAt)
	if err == nil {
		order.LatestAddition = &addition
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return core.Order{}, err
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.Order{}, err
	}
	s.attachAdditionState(&order, settings)
	return order, nil
}

func (s *Store) orderItems(ctx context.Context, orderID uuid.UUID) ([]core.OrderItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT oi.menu_item_id, oi.snapshot_title, oi.unit_price_minor, oi.quantity, oi.line_total_minor,
			oi.addition_id, COALESCE(oa.revision, 0), oa.created_at
		FROM order_items oi
		LEFT JOIN order_additions oa ON oa.id=oi.addition_id
		WHERE oi.order_id=$1
		ORDER BY oi.sort_order, oi.id
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []core.OrderItem{}
	for rows.Next() {
		var item core.OrderItem
		var additionID uuid.NullUUID
		var additionCreated sql.NullTime
		if err := rows.Scan(
			&item.MenuItemID,
			&item.SnapshotTitle,
			&item.UnitPriceMinor,
			&item.Quantity,
			&item.LineTotalMinor,
			&additionID,
			&item.AdditionRevision,
			&additionCreated,
		); err != nil {
			return nil, err
		}
		if additionID.Valid {
			value := additionID.UUID
			item.AdditionID = &value
		}
		if additionCreated.Valid {
			value := additionCreated.Time
			item.AdditionCreatedAt = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) orderItemQuantities(ctx context.Context, orderID uuid.UUID) (map[uuid.UUID]int, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT menu_item_id, COALESCE(SUM(quantity), 0)::int
		FROM order_items
		WHERE order_id=$1 AND menu_item_id IS NOT NULL
		GROUP BY menu_item_id
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	quantities := map[uuid.UUID]int{}
	for rows.Next() {
		var id uuid.UUID
		var quantity int
		if err := rows.Scan(&id, &quantity); err != nil {
			return nil, err
		}
		quantities[id] = quantity
	}
	return quantities, rows.Err()
}

func (s *Store) attachAdditionState(order *core.Order, settings core.Settings) {
	if order == nil || order.ID == uuid.Nil {
		return
	}
	until := order.CreatedAt.UTC().Add(orderAdditionWindow)
	if order.FulfillmentType == core.FulfillmentPickup && order.PickupAt != nil {
		until = order.PickupAt.UTC().Add(-time.Duration(settings.PickupMinLeadMinutes) * time.Minute)
		if order.PickupCookAt != nil {
			until = order.PickupCookAt.UTC()
		}
		order.PickupCookAt = &until
	}
	if order.FulfillmentStatus != core.StatusNew {
		order.AddItemsReason = "status"
		return
	}
	if order.KitchenStartedAt != nil {
		order.AddItemsReason = "kitchen_started"
		return
	}
	if order.PaymentMethod != core.PaymentCash {
		order.AddItemsReason = "payment_method"
		return
	}
	if order.LatestAddition != nil {
		order.AddItemsReason = "already_added"
		return
	}
	order.AddItemsUntil = &until
	now := time.Now().UTC()
	if !now.Before(until) {
		order.AddItemsReason = "time_expired"
		return
	}
	accept := core.CanAcceptOrder(now, settings)
	if !accept.OK {
		order.AddItemsReason = accept.Reason
		return
	}
	order.CanAddItems = true
}

func pickupCookAt(pickupAt *time.Time, settings core.Settings) *time.Time {
	if pickupAt == nil {
		return nil
	}
	value := pickupAt.UTC().Add(-time.Duration(settings.PickupMinLeadMinutes) * time.Minute)
	return &value
}

func additionCutoff(createdAt time.Time, pickupAt, pickupCookAt sql.NullTime, fulfillmentType core.FulfillmentType, settings core.Settings) time.Time {
	if fulfillmentType == core.FulfillmentPickup && pickupAt.Valid {
		if pickupCookAt.Valid {
			return pickupCookAt.Time.UTC()
		}
		return pickupAt.Time.UTC().Add(-time.Duration(settings.PickupMinLeadMinutes) * time.Minute)
	}
	return createdAt.UTC().Add(orderAdditionWindow)
}

func (s *Store) OrderEvents(ctx context.Context, orderID uuid.UUID) ([]core.OrderEvent, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, order_id, from_status, to_status, action, actor_role, reason, created_at
		FROM order_events WHERE order_id=$1 ORDER BY created_at ASC
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []core.OrderEvent{}
	for rows.Next() {
		var event core.OrderEvent
		if err := rows.Scan(&event.ID, &event.OrderID, &event.FromStatus, &event.ToStatus, &event.Action, &event.ActorRole, &event.Reason, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *Store) ordersByStatus(ctx context.Context, status core.FulfillmentStatus, includePII bool) ([]core.Order, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT o.id, o.public_number, o.client_user_id, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_type, o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency, o.phone_ciphertext, o.address_ciphertext,
			o.customer_comment, o.locale, o.version, o.created_at, o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.fulfillment_status=$1
		ORDER BY o.updated_at ASC
		LIMIT 50
	`, string(status))
	if err != nil {
		return nil, err
	}
	return s.scanOrdersWithItems(ctx, rows, includePII)
}

func scanOrderSummaries(rows pgx.Rows) ([]core.OrderSummary, error) {
	summaries := []core.OrderSummary{}
	for rows.Next() {
		var summary core.OrderSummary
		var pickup, deliveryRequested, deliveryTarget, estimatedReady, ready, delivered, cancelled sql.NullTime
		var locationVerified sql.NullTime
		var locationDistance sql.NullInt32
		if err := rows.Scan(
			&summary.ID, &summary.PublicNumber, &summary.ClientUsername, &summary.ClientFirstName, &summary.ClientPhotoURL,
			&summary.FulfillmentType, &summary.FulfillmentStatus, &summary.PaymentMethod, &summary.PaymentStatus,
			&summary.SubtotalMinor, &summary.DeliveryFeeMinor, &summary.TotalMinor, &summary.Currency,
			&summary.Locale, &summary.Version, &summary.CreatedAt,
			&pickup, &summary.DeliveryTimeMode, &deliveryRequested, &deliveryTarget,
			&summary.DeliveryQueueDelayMinutes, &summary.KitchenQueuePosition, &estimatedReady, &ready, &delivered, &cancelled,
			&locationVerified, &locationDistance,
		); err != nil {
			return nil, err
		}
		if ready.Valid {
			summary.ReadyAt = &ready.Time
		}
		if pickup.Valid {
			summary.PickupAt = &pickup.Time
		}
		if deliveryRequested.Valid {
			summary.DeliveryRequestedAt = &deliveryRequested.Time
		}
		if deliveryTarget.Valid {
			summary.DeliveryTargetAt = &deliveryTarget.Time
		}
		if estimatedReady.Valid {
			summary.EstimatedReadyAt = &estimatedReady.Time
		}
		if delivered.Valid {
			summary.DeliveredAt = &delivered.Time
		}
		if cancelled.Valid {
			summary.CancelledAt = &cancelled.Time
		}
		if locationVerified.Valid {
			summary.CashLocationVerifiedAt = &locationVerified.Time
		}
		if locationDistance.Valid {
			value := int(locationDistance.Int32)
			summary.CashLocationDistanceMeters = &value
		}
		summaries = append(summaries, summary)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return summaries, nil
}

func (s *Store) ordersByIDs(ctx context.Context, ids []uuid.UUID, includePII bool) ([]core.Order, error) {
	if len(ids) == 0 {
		return []core.Order{}, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT o.id, o.public_number, o.client_user_id, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_type, o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency, o.phone_ciphertext, o.address_ciphertext,
			o.customer_comment, o.locale, o.version, o.created_at, o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=ANY($1)
		ORDER BY array_position($1::uuid[], o.id)
	`, ids)
	if err != nil {
		return nil, err
	}
	return s.scanOrdersWithItems(ctx, rows, includePII)
}

func (s *Store) scanOrdersWithItems(ctx context.Context, rows pgx.Rows, includePII bool) ([]core.Order, error) {
	defer rows.Close()
	orders := []core.Order{}
	ids := []uuid.UUID{}
	indexByID := map[uuid.UUID]int{}
	for rows.Next() {
		var order core.Order
		var phoneCipher, addressCipher string
		var ready, delivered, cancelled sql.NullTime
		var locationVerified sql.NullTime
		var locationDistance sql.NullInt32
		if err := rows.Scan(
			&order.ID, &order.PublicNumber, &order.ClientUserID, &order.ClientUsername, &order.ClientFirstName, &order.ClientPhotoURL,
			&order.FulfillmentType, &order.FulfillmentStatus, &order.PaymentMethod,
			&order.PaymentStatus, &order.SubtotalMinor, &order.DeliveryFeeMinor, &order.TotalMinor, &order.Currency,
			&phoneCipher, &addressCipher, &order.CustomerComment, &order.Locale, &order.Version, &order.CreatedAt,
			&ready, &delivered, &cancelled,
			&locationVerified, &locationDistance,
		); err != nil {
			return nil, err
		}
		if includePII {
			phone, err := s.box.Decrypt(phoneCipher)
			if err != nil {
				return nil, err
			}
			address, err := s.box.Decrypt(addressCipher)
			if err != nil {
				return nil, err
			}
			order.Phone = phone
			order.Address = address
		}
		if ready.Valid {
			order.ReadyAt = &ready.Time
		}
		if delivered.Valid {
			order.DeliveredAt = &delivered.Time
		}
		if cancelled.Valid {
			order.CancelledAt = &cancelled.Time
		}
		if locationVerified.Valid {
			order.CashLocationVerifiedAt = &locationVerified.Time
		}
		if locationDistance.Valid {
			value := int(locationDistance.Int32)
			order.CashLocationDistanceMeters = &value
		}
		indexByID[order.ID] = len(orders)
		ids = append(ids, order.ID)
		orders = append(orders, order)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []core.Order{}, nil
	}
	pickupRows, err := s.pool.Query(ctx, `
		SELECT o.id, o.pickup_at, o.pickup_original_at, o.pickup_cook_at, o.kitchen_started_at, o.courier_started_at,
			pickup_address_snapshot, pickup_instructions_snapshot, delivery_time_mode, delivery_requested_at,
			delivery_target_at, delivery_queue_delay_minutes,
			CASE WHEN o.fulfillment_type='delivery' AND o.fulfillment_status='NEW' AND o.delivery_time_mode='ASAP' THEN (
				SELECT COUNT(*)::int + 1 FROM orders q
				WHERE q.fulfillment_type='delivery' AND q.fulfillment_status='NEW' AND q.delivery_time_mode='ASAP'
					AND (q.created_at < o.created_at OR (q.created_at = o.created_at AND q.id < o.id))
			) ELSE 0 END,
			estimated_ready_at, estimated_ready_updated_at, estimated_ready_by
		FROM orders o WHERE o.id=ANY($1)
	`, ids)
	if err != nil {
		return nil, err
	}
	for pickupRows.Next() {
		var id uuid.UUID
		var pickupAt, pickupOriginalAt, pickupCookAtValue, kitchenStartedAt, courierStartedAt, deliveryRequestedAt, deliveryTargetAt, estimatedReadyAt, estimatedReadyUpdatedAt sql.NullTime
		var estimatedReadyBy uuid.NullUUID
		var address, instructions string
		var deliveryMode string
		var queueDelay int
		var queuePosition int
		if err := pickupRows.Scan(&id, &pickupAt, &pickupOriginalAt, &pickupCookAtValue, &kitchenStartedAt, &courierStartedAt, &address, &instructions,
			&deliveryMode, &deliveryRequestedAt, &deliveryTargetAt, &queueDelay, &queuePosition, &estimatedReadyAt, &estimatedReadyUpdatedAt, &estimatedReadyBy); err != nil {
			pickupRows.Close()
			return nil, err
		}
		order := &orders[indexByID[id]]
		if pickupAt.Valid {
			order.PickupAt = &pickupAt.Time
		}
		if pickupOriginalAt.Valid {
			order.PickupOriginalAt = &pickupOriginalAt.Time
		}
		if pickupCookAtValue.Valid {
			order.PickupCookAt = &pickupCookAtValue.Time
		}
		if kitchenStartedAt.Valid {
			order.KitchenStartedAt = &kitchenStartedAt.Time
		}
		if courierStartedAt.Valid {
			order.CourierStartedAt = &courierStartedAt.Time
		}
		order.PickupAddress = address
		order.PickupInstructions = instructions
		order.DeliveryTimeMode = deliveryMode
		order.DeliveryQueueDelayMinutes = queueDelay
		order.KitchenQueuePosition = queuePosition
		if deliveryRequestedAt.Valid {
			order.DeliveryRequestedAt = &deliveryRequestedAt.Time
		}
		if deliveryTargetAt.Valid {
			order.DeliveryTargetAt = &deliveryTargetAt.Time
		}
		if estimatedReadyAt.Valid {
			order.EstimatedReadyAt = &estimatedReadyAt.Time
		}
		if estimatedReadyUpdatedAt.Valid {
			order.EstimatedReadyUpdatedAt = &estimatedReadyUpdatedAt.Time
		}
		if estimatedReadyBy.Valid {
			value := estimatedReadyBy.UUID
			order.EstimatedReadyBy = &value
		}
	}
	if err := pickupRows.Err(); err != nil {
		pickupRows.Close()
		return nil, err
	}
	pickupRows.Close()

	itemRows, err := s.pool.Query(ctx, `
		SELECT oi.order_id, oi.menu_item_id, oi.snapshot_title, oi.unit_price_minor, oi.quantity, oi.line_total_minor,
			oi.addition_id, COALESCE(oa.revision, 0), COALESCE(oa.subtotal_minor, 0), COALESCE(oa.currency, ''), oa.created_at
		FROM order_items oi
		LEFT JOIN order_additions oa ON oa.id=oi.addition_id
		WHERE oi.order_id=ANY($1)
		ORDER BY oi.order_id, oi.sort_order, oi.id
	`, ids)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var orderID uuid.UUID
		var item core.OrderItem
		var additionID uuid.NullUUID
		var additionSubtotal int
		var additionCurrency string
		var additionCreated sql.NullTime
		if err := itemRows.Scan(
			&orderID,
			&item.MenuItemID,
			&item.SnapshotTitle,
			&item.UnitPriceMinor,
			&item.Quantity,
			&item.LineTotalMinor,
			&additionID,
			&item.AdditionRevision,
			&additionSubtotal,
			&additionCurrency,
			&additionCreated,
		); err != nil {
			return nil, err
		}
		if additionID.Valid {
			value := additionID.UUID
			item.AdditionID = &value
		}
		if additionCreated.Valid {
			value := additionCreated.Time
			item.AdditionCreatedAt = &value
		}
		if index, ok := indexByID[orderID]; ok {
			orders[index].Items = append(orders[index].Items, item)
			if additionID.Valid && additionCreated.Valid &&
				(orders[index].LatestAddition == nil || additionCreated.Time.After(orders[index].LatestAddition.CreatedAt)) {
				orders[index].LatestAddition = &core.OrderAddition{
					ID:            additionID.UUID,
					Revision:      item.AdditionRevision,
					SubtotalMinor: additionSubtotal,
					Currency:      additionCurrency,
					CreatedAt:     additionCreated.Time,
				}
			}
		}
	}
	if err := itemRows.Err(); err != nil {
		return nil, err
	}
	needsSettings := false
	for index := range orders {
		if orders[index].FulfillmentStatus == core.StatusNew && orders[index].PaymentMethod == core.PaymentCash && orders[index].LatestAddition == nil {
			needsSettings = true
			break
		}
	}
	var settings core.Settings
	if needsSettings {
		settings, err = s.Settings(ctx)
		if err != nil {
			return nil, err
		}
	}
	for index := range orders {
		s.attachAdditionState(&orders[index], settings)
	}
	return orders, nil
}

func (s *Store) beginIdempotency(ctx context.Context, tx pgx.Tx, userID uuid.UUID, operation, key, requestHash string) (uuid.UUID, bool, error) {
	tag, err := tx.Exec(ctx, `
		INSERT INTO idempotency_keys (actor_user_id, operation, key, request_hash, expires_at)
		VALUES ($1, $2, $3, $4, now() + interval '24 hours')
		ON CONFLICT (actor_user_id, operation, key) DO NOTHING
	`, userID, operation, key, requestHash)
	if err != nil {
		return uuid.Nil, false, err
	}
	if tag.RowsAffected() == 1 {
		return uuid.Nil, false, nil
	}
	var existingHash string
	var orderIDText string
	err = tx.QueryRow(ctx, `
		SELECT request_hash, COALESCE(result_json->>'order_id', '')
		FROM idempotency_keys
		WHERE actor_user_id=$1 AND operation=$2 AND key=$3
		FOR UPDATE
	`, userID, operation, key).Scan(&existingHash, &orderIDText)
	if err != nil {
		return uuid.Nil, false, err
	}
	if existingHash != requestHash {
		return uuid.Nil, false, core.ErrIdempotencyConflict
	}
	orderID, err := uuid.Parse(orderIDText)
	if err != nil || orderID == uuid.Nil {
		return uuid.Nil, false, core.ErrIdempotencyConflict
	}
	return orderID, true, nil
}

func (s *Store) finishIdempotency(ctx context.Context, tx pgx.Tx, userID uuid.UUID, operation, key string, orderID uuid.UUID) error {
	raw, err := json.Marshal(map[string]string{"order_id": orderID.String()})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE idempotency_keys SET result_json=$1
		WHERE actor_user_id=$2 AND operation=$3 AND key=$4
	`, raw, userID, operation, key)
	return err
}

func (s *Store) adminCategoryByID(ctx context.Context, id uuid.UUID) (core.AdminCategory, error) {
	var cat core.AdminCategory
	err := s.pool.QueryRow(ctx, `
		SELECT c.id, c.title_ru, c.title_sr, c.title_en, c.sort_order, c.visible, c.archived,
			COUNT(mi.id)::int AS item_count, c.version, c.created_at, c.updated_at
		FROM categories c
		LEFT JOIN menu_items mi ON mi.category_id=c.id AND mi.archived=false
		WHERE c.id=$1
		GROUP BY c.id
	`, id).Scan(&cat.ID, &cat.TitleRU, &cat.TitleSR, &cat.TitleEN, &cat.SortOrder, &cat.Visible, &cat.Archived, &cat.ItemCount, &cat.Version, &cat.CreatedAt, &cat.UpdatedAt)
	return cat, err
}

func (s *Store) adminMenuItemByID(ctx context.Context, id uuid.UUID) (core.AdminMenuItem, error) {
	var item core.AdminMenuItem
	var thumbnailPath string
	var thumbnailWidth, thumbnailHeight, displayWidth, displayHeight int
	err := s.pool.QueryRow(ctx, `
		SELECT mi.id, mi.category_id, mi.title_ru, mi.title_sr, mi.title_en, mi.description_ru, mi.description_sr,
			mi.description_en, mi.price_minor, mi.discount_percent, mi.discounted_price_minor, mi.currency, mi.photo_path, mi.weight_text, mi.min_quantity,
			mi.allergen_text_ru, mi.allergen_text_sr, mi.allergen_text_en, mi.sort_order, mi.visible, mi.archived,
			EXISTS (SELECT 1 FROM order_items oi WHERE oi.menu_item_id=mi.id) AS used_in_orders,
			mi.version, mi.created_at, mi.updated_at,
			COALESCE(mm.thumbnail_path, ''), COALESCE(mm.thumbnail_width, 0), COALESCE(mm.thumbnail_height, 0),
			COALESCE(mm.display_width, 0), COALESCE(mm.display_height, 0)
		FROM menu_items mi
		LEFT JOIN menu_media mm ON mm.display_path=mi.photo_path
		WHERE mi.id=$1
	`, id).Scan(
		&item.ID, &item.CategoryID, &item.TitleRU, &item.TitleSR, &item.TitleEN, &item.DescriptionRU, &item.DescriptionSR,
		&item.DescriptionEN, &item.PriceMinor, &item.DiscountPercent, &item.DiscountedPriceMinor, &item.Currency, &item.PhotoPath, &item.WeightText, &item.MinQuantity,
		&item.AllergenTextRU, &item.AllergenTextSR, &item.AllergenTextEN, &item.SortOrder, &item.Visible, &item.Archived, &item.UsedInOrders,
		&item.Version, &item.CreatedAt, &item.UpdatedAt, &thumbnailPath, &thumbnailWidth, &thumbnailHeight, &displayWidth, &displayHeight,
	)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	item.PhotoVariants = menuPhotoVariants(item.PhotoPath, thumbnailPath, thumbnailWidth, thumbnailHeight, displayWidth, displayHeight)
	return item, nil
}

func menuPhotoVariants(path, thumbnailPath string, thumbnailWidth, thumbnailHeight, displayWidth, displayHeight int) *core.PhotoVariants {
	if !strings.HasPrefix(path, "/media/menu/") || !strings.HasSuffix(strings.ToLower(path), ".jpg") {
		return nil
	}
	if thumbnailPath != "" && thumbnailWidth > 0 && thumbnailHeight > 0 && displayWidth > 0 && displayHeight > 0 {
		return &core.PhotoVariants{
			Thumbnail: core.PhotoVariant{URL: thumbnailPath, Width: thumbnailWidth, Height: thumbnailHeight},
			Display:   core.PhotoVariant{URL: path, Width: displayWidth, Height: displayHeight},
		}
	}
	thumbnail := strings.TrimSuffix(path, ".jpg") + "_thumb.jpg"
	return &core.PhotoVariants{
		Thumbnail: core.PhotoVariant{URL: thumbnail, Width: menumedia.ThumbnailMaxSide, Height: menumedia.ThumbnailMaxSide},
		Display:   core.PhotoVariant{URL: path, Width: menumedia.DisplayMaxSide, Height: menumedia.DisplayMaxSide},
	}
}

func (s *Store) staffByID(ctx context.Context, id uuid.UUID) (core.StaffMember, error) {
	var member core.StaffMember
	err := s.pool.QueryRow(ctx, `
		SELECT id, telegram_user_id, display_label, role, active, created_at, updated_at
		FROM staff WHERE id=$1
	`, id).Scan(&member.ID, &member.TelegramUserID, &member.DisplayLabel, &member.Role, &member.Active, &member.CreatedAt, &member.UpdatedAt)
	return member, err
}

type staffQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Store) ensureNotLastAdmin(ctx context.Context, q staffQueryer, id uuid.UUID) error {
	if err := lockActiveStaffRole(ctx, q, core.RoleAdmin); err != nil {
		return err
	}
	var count int
	if err := q.QueryRow(ctx, `SELECT COUNT(*) FROM staff WHERE role='ADMIN' AND active=true AND id<>$1`, id).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return core.ErrInvalidInput
	}
	return nil
}

func (s *Store) ensureNoOtherActiveCourier(ctx context.Context, q staffQueryer, id uuid.UUID) error {
	if err := lockActiveStaffRole(ctx, q, core.RoleCourier); err != nil {
		return err
	}
	var count int
	if err := q.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM staff
		WHERE role='COURIER'
			AND active=true
			AND id<>$1
			AND telegram_user_id NOT IN (1048084234, 8241921060, 8609105840, 7604602332)
	`, id).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return core.ErrInvalidInput
	}
	return nil
}

func lockActiveStaffRole(ctx context.Context, q staffQueryer, role core.Role) error {
	rows, err := q.Query(ctx, `
		SELECT id
		FROM staff
		WHERE role=$1 AND active=true
		FOR UPDATE
	`, string(role))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
	}
	return rows.Err()
}

func isOwnerTesterTelegramID(telegramUserID int64) bool {
	_, ok := ownerTesterTelegramIDs[telegramUserID]
	return ok
}

func (s *Store) insertAudit(ctx context.Context, sess core.Session, action, targetType string, targetID *uuid.UUID, reason string, before, after map[string]any) error {
	return s.insertAuditExec(ctx, s.pool, sess, action, targetType, targetID, reason, before, after)
}

func (s *Store) insertAuditTx(ctx context.Context, tx pgx.Tx, sess core.Session, action, targetType string, targetID *uuid.UUID, reason string, before, after map[string]any) error {
	return s.insertAuditExec(ctx, tx, sess, action, targetType, targetID, reason, before, after)
}

type auditExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (s *Store) insertAuditExec(ctx context.Context, exec auditExecutor, sess core.Session, action, targetType string, targetID *uuid.UUID, reason string, before, after map[string]any) error {
	beforeRaw, err := json.Marshal(emptyMap(before))
	if err != nil {
		return err
	}
	afterRaw, err := json.Marshal(emptyMap(after))
	if err != nil {
		return err
	}
	_, err = exec.Exec(ctx, `
		INSERT INTO audit_log (actor_user_id, actor_role, action, target_type, target_id, reason, before_json, after_json)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, sess.UserID, string(sess.ActiveRole), action, targetType, targetID, safe(reason), beforeRaw, afterRaw)
	return err
}

func emptyMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func categoryAudit(cat core.AdminCategory) map[string]any {
	return map[string]any{
		"title_ru": cat.TitleRU,
		"visible":  cat.Visible,
		"archived": cat.Archived,
		"sort":     cat.SortOrder,
		"version":  cat.Version,
	}
}

func menuItemAudit(item core.AdminMenuItem) map[string]any {
	return map[string]any{
		"title_ru":         item.TitleRU,
		"price_minor":      item.PriceMinor,
		"discount_percent": item.DiscountPercent,
		"visible":          item.Visible,
		"archived":         item.Archived,
		"version":          item.Version,
	}
}

func staffAudit(member core.StaffMember) map[string]any {
	return map[string]any{
		"telegram_user_id": member.TelegramUserID,
		"display_label":    member.DisplayLabel,
		"role":             member.Role,
		"active":           member.Active,
	}
}

func safeSettingsAudit(settings core.Settings) map[string]any {
	return map[string]any{
		"flat_delivery_fee_minor":           settings.FlatDeliveryFeeMinor,
		"support_text":                      settings.SupportText,
		"support_phone":                     settings.SupportPhone,
		"terms_url":                         settings.TermsURL,
		"max_item_quantity":                 settings.MaxItemQuantity,
		"max_comment_length":                settings.MaxCommentLength,
		"cash_enabled":                      settings.CashEnabled,
		"card_enabled":                      settings.CardEnabled,
		"crypto_enabled":                    settings.CryptoEnabled,
		"cash_location_required":            settings.CashLocationRequired,
		"restaurant_latitude":               settings.RestaurantLatitude,
		"restaurant_longitude":              settings.RestaurantLongitude,
		"cash_location_radius_meters":       settings.CashLocationRadiusMeters,
		"cash_location_ttl_seconds":         settings.CashLocationTTLSeconds,
		"cash_location_max_accuracy_meters": settings.CashLocationMaxAccuracyMeters,
		"pickup_enabled":                    settings.PickupEnabled,
		"pickup_address":                    settings.PickupAddress,
		"pickup_map_url":                    settings.PickupMapURL,
		"pickup_min_lead_minutes":           settings.PickupMinLeadMinutes,
		"pickup_slot_minutes":               settings.PickupSlotMinutes,
		"pickup_max_orders_per_slot":        settings.PickupMaxOrdersPerSlot,
		"pickup_last_time":                  settings.PickupLastTime,
		"delivery_timing_enabled":           settings.DeliveryTimingEnabled,
		"delivery_min_lead_minutes":         settings.DeliveryMinLeadMinutes,
		"delivery_slot_minutes":             settings.DeliverySlotMinutes,
		"delivery_max_orders_per_slot":      settings.DeliveryMaxOrdersPerSlot,
		"delivery_last_target_time":         settings.DeliveryLastTargetTime,
		"version":                           settings.Version,
	}
}

func (s *Store) verifiedPhoneForCashOrder(ctx context.Context, tx pgx.Tx, userID uuid.UUID, inputPhone string) (string, error) {
	var phoneCipher, phoneHash string
	var verifiedAt sql.NullTime
	err := tx.QueryRow(ctx, `
		SELECT phone_ciphertext, phone_hash, phone_verified_at
		FROM users
		WHERE id=$1
		FOR UPDATE
	`, userID).Scan(&phoneCipher, &phoneHash, &verifiedAt)
	if err != nil {
		return "", err
	}
	if !verifiedAt.Valid || strings.TrimSpace(phoneCipher) == "" || strings.TrimSpace(phoneHash) == "" {
		return "", core.ErrContactNotVerified
	}
	phone, err := s.box.Decrypt(phoneCipher)
	if err != nil {
		return "", err
	}
	if trimmed := safe(inputPhone); trimmed != "" && !s.phoneHashMatches(trimmed, phoneHash) {
		return "", core.ErrContactNotVerified
	}
	return phone, nil
}

func (s *Store) useCashLocationChallengeTx(ctx context.Context, tx pgx.Tx, sess core.Session, challengeIDText, calculationTokenHash string, settings core.Settings, now time.Time) (*uuid.UUID, *time.Time, *int, error) {
	if !settings.CashLocationRequired {
		return nil, nil, nil, nil
	}
	if s.persistentCityVerification {
		var verifiedAt sql.NullTime
		if err := tx.QueryRow(ctx, `SELECT city_verified_at FROM users WHERE id=$1`, sess.UserID).Scan(&verifiedAt); err != nil {
			return nil, nil, nil, err
		}
		if verifiedAt.Valid {
			return nil, &verifiedAt.Time, nil, nil
		}
		return nil, nil, nil, core.ErrCashLocationRequired
	}
	challengeID, err := uuid.Parse(strings.TrimSpace(challengeIDText))
	if err != nil || challengeID == uuid.Nil {
		return nil, nil, nil, core.ErrCashLocationRequired
	}
	var status, storedTokenHash string
	var verifiedAt, usedAt sql.NullTime
	var expiresAt time.Time
	var distance, accuracy sql.NullInt32
	err = tx.QueryRow(ctx, `
		SELECT status, calculation_token_hash, distance_meters, accuracy_meters, verified_at, expires_at, used_at
		FROM cash_location_challenges
		WHERE id=$1 AND user_id=$2
		FOR UPDATE
	`, challengeID, sess.UserID).Scan(&status, &storedTokenHash, &distance, &accuracy, &verifiedAt, &expiresAt, &usedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, core.ErrCashLocationRequired
	}
	if err != nil {
		return nil, nil, nil, err
	}
	if status != string(core.CashLocationVerified) || storedTokenHash != calculationTokenHash || !verifiedAt.Valid ||
		!now.UTC().Before(expiresAt) || usedAt.Valid || !distance.Valid || !accuracy.Valid {
		return nil, nil, nil, core.ErrCashLocationRequired
	}
	if int(distance.Int32)+int(accuracy.Int32) > settings.CashLocationRadiusMeters {
		return nil, nil, nil, core.ErrCashLocationOutside
	}
	if _, err := tx.Exec(ctx, `
		UPDATE cash_location_challenges
		SET status='USED', used_at=now(), updated_at=now()
		WHERE id=$1
	`, challengeID); err != nil {
		return nil, nil, nil, err
	}
	distanceValue := int(distance.Int32)
	return &challengeID, &verifiedAt.Time, &distanceValue, nil
}

func (s *Store) expireCashLocationChallenges(ctx context.Context, userID uuid.UUID, now time.Time) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE cash_location_challenges
		SET status='EXPIRED', updated_at=now()
		WHERE user_id=$1 AND status IN ('PENDING', 'VERIFIED') AND used_at IS NULL AND expires_at <= $2
	`, userID, now.UTC())
	return err
}

func (s *Store) cashLocationChallengeByID(ctx context.Context, challengeID, userID uuid.UUID) (core.CashLocationChallenge, error) {
	var challenge core.CashLocationChallenge
	var distance, accuracy sql.NullInt32
	var verifiedAt, usedAt sql.NullTime
	err := s.pool.QueryRow(ctx, `
		SELECT id, status, rejection_reason, distance_meters, accuracy_meters, expires_at,
			verified_at, used_at, dev_bypass
		FROM cash_location_challenges
		WHERE id=$1 AND user_id=$2
	`, challengeID, userID).Scan(
		&challenge.ID,
		&challenge.Status,
		&challenge.RejectionReason,
		&distance,
		&accuracy,
		&challenge.ExpiresAt,
		&verifiedAt,
		&usedAt,
		&challenge.DevBypass,
	)
	if err != nil {
		return core.CashLocationChallenge{}, err
	}
	if distance.Valid {
		value := int(distance.Int32)
		challenge.DistanceMeters = &value
	}
	if accuracy.Valid {
		value := int(accuracy.Int32)
		challenge.AccuracyMeters = &value
	}
	if verifiedAt.Valid {
		challenge.VerifiedAt = &verifiedAt.Time
	}
	if usedAt.Valid {
		challenge.UsedAt = &usedAt.Time
	}
	return challenge, nil
}

func (s *Store) rejectCashLocationChallengeTx(ctx context.Context, tx pgx.Tx, id, userID uuid.UUID, reason string) (core.CashLocationChallenge, error) {
	if _, err := tx.Exec(ctx, `
		UPDATE cash_location_challenges
		SET status='REJECTED', rejection_reason=$2, updated_at=now()
		WHERE id=$1
	`, id, safe(reason)); err != nil {
		return core.CashLocationChallenge{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.CashLocationChallenge{}, err
	}
	return s.cashLocationChallengeByID(ctx, id, userID)
}

func cashLocationTTL(settings core.Settings) time.Duration {
	if settings.CashLocationTTLSeconds <= 0 {
		return 3 * time.Minute
	}
	return time.Duration(settings.CashLocationTTLSeconds) * time.Second
}

func cashLocationConfigured(settings core.Settings) bool {
	return geo.ValidCoordinates(settings.RestaurantLatitude, settings.RestaurantLongitude) &&
		(settings.RestaurantLatitude != 0 || settings.RestaurantLongitude != 0)
}

func uuidSQL(value *uuid.UUID) any {
	if value == nil {
		return nil
	}
	return *value
}

func timeSQL(value *time.Time) any {
	if value == nil {
		return nil
	}
	return *value
}

func intSQL(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func isUniqueViolation(err error, constraintName string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return false
	}
	return constraintName == "" || pgErr.ConstraintName == constraintName
}

func maskPhone(phone string) string {
	phone = safe(phone)
	if len([]rune(phone)) <= 4 {
		return phone
	}
	runes := []rune(phone)
	return strings.Repeat("*", len(runes)-4) + string(runes[len(runes)-4:])
}

func validStaffRole(role core.Role) bool {
	return role == core.RoleKitchen || role == core.RoleCourier || role == core.RoleAdmin
}

func validFulfillmentStatus(status string) bool {
	switch core.FulfillmentStatus(status) {
	case core.StatusNew, core.StatusOutForDelivery, core.StatusDelivered, core.StatusCancelled:
		return true
	default:
		return false
	}
}

func normalizeFulfillmentType(value core.FulfillmentType) (core.FulfillmentType, error) {
	switch core.FulfillmentType(strings.ToLower(strings.TrimSpace(string(value)))) {
	case "", core.FulfillmentDelivery:
		return core.FulfillmentDelivery, nil
	case core.FulfillmentPickup:
		return core.FulfillmentPickup, nil
	default:
		return "", core.ErrInvalidInput
	}
}

func roleAllowed(role core.Role, roles []core.Role) bool {
	for _, allowed := range roles {
		if role == allowed {
			return true
		}
	}
	return false
}

func randomToken() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, hashString(token), nil
}

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (s *Store) phoneHash(value string) string {
	normalized := normalizePII(value)
	mac := hmac.New(sha256.New, s.piiHashKey)
	_, _ = mac.Write([]byte("phone:v1:"))
	_, _ = mac.Write([]byte(normalized))
	return phoneHashHMACPrefix + hex.EncodeToString(mac.Sum(nil))
}

func (s *Store) phoneHashCandidates(value string) []string {
	current := s.phoneHash(value)
	legacy := legacyPhoneHash(value)
	if legacy == current {
		return []string{current}
	}
	return []string{current, legacy}
}

func (s *Store) phoneHashMatches(phone, storedHash string) bool {
	storedHash = strings.TrimSpace(storedHash)
	if storedHash == "" {
		return false
	}
	if strings.HasPrefix(storedHash, phoneHashHMACPrefix) {
		return hmac.Equal([]byte(s.phoneHash(phone)), []byte(storedHash))
	}
	return hmac.Equal([]byte(legacyPhoneHash(phone)), []byte(storedHash))
}

func legacyPhoneHash(value string) string {
	return hashString(normalizePII(value))
}

func normalizePII(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validCategoryInput(input UpsertCategoryInput) bool {
	return requiredText(input.TitleRU, maxTitleLength) &&
		optionalText(input.TitleSR, maxTitleLength) &&
		optionalText(input.TitleEN, maxTitleLength)
}

func validMenuItemInput(input UpsertMenuItemInput) bool {
	return input.CategoryID != uuid.Nil &&
		input.PriceMinor >= 0 &&
		input.DiscountPercent >= 0 &&
		input.DiscountPercent <= 99 &&
		input.MinQuantity > 0 &&
		input.MinQuantity <= maxItemQuantityHardLimit &&
		requiredText(input.TitleRU, maxTitleLength) &&
		optionalText(input.TitleSR, maxTitleLength) &&
		optionalText(input.TitleEN, maxTitleLength) &&
		optionalText(input.DescriptionRU, maxDescriptionLength) &&
		optionalText(input.DescriptionSR, maxDescriptionLength) &&
		optionalText(input.DescriptionEN, maxDescriptionLength) &&
		validOptionalMenuPhotoPath(input.PhotoPath) &&
		optionalText(input.WeightText, maxShortTextLength) &&
		optionalText(input.AllergenTextRU, maxDescriptionLength) &&
		optionalText(input.AllergenTextSR, maxDescriptionLength) &&
		optionalText(input.AllergenTextEN, maxDescriptionLength)
}

func discountedPrice(priceMinor, discountPercent int) int {
	return (priceMinor*(100-discountPercent) + 50) / 100
}

func validMenuMediaInput(input MenuMediaInput) bool {
	return validMenuMediaPath(input.DisplayPath) &&
		validMenuMediaPath(input.ThumbnailPath) &&
		input.DisplayWidth > 0 &&
		input.DisplayHeight > 0 &&
		input.DisplayBytes >= 0 &&
		input.ThumbnailWidth > 0 &&
		input.ThumbnailHeight > 0 &&
		input.ThumbnailBytes >= 0
}

func validMenuMediaPath(value string) bool {
	value = safe(value)
	return optionalText(value, maxURLLength) &&
		strings.HasPrefix(value, "/media/menu/") &&
		strings.HasSuffix(strings.ToLower(value), ".jpg") &&
		!strings.Contains(value, "..")
}

func validOptionalMenuPhotoPath(value string) bool {
	value = safe(value)
	return value == "" || validMenuMediaPath(value)
}

func requiredText(value string, maxRunes int) bool {
	value = safe(value)
	return value != "" && optionalText(value, maxRunes)
}

func optionalText(value string, maxRunes int) bool {
	if maxRunes <= 0 {
		return false
	}
	return len([]rune(safe(value))) <= maxRunes
}

func validOptionalURL(value string) bool {
	value = safe(value)
	if value == "" {
		return true
	}
	if !optionalText(value, maxURLLength) {
		return false
	}
	return strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://")
}

func safe(value string) string {
	return strings.TrimSpace(value)
}

func localeOrDefault(value string) string {
	value = strings.TrimSpace(value)
	if value == "sr" || value == "en" || value == "ru" {
		return value
	}
	return "ru"
}

func localized(locale, ru, sr, en string) string {
	switch localeOrDefault(locale) {
	case "sr":
		if sr != "" {
			return sr
		}
	case "en":
		if en != "" {
			return en
		}
	}
	return ru
}

func rollback(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(ctx)
}
