package store

import (
	"context"
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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool *pgxpool.Pool
	box  *cryptobox.Box
}

type CreateOrderInput struct {
	CalculationToken        string             `json:"calculation_token"`
	CashLocationChallengeID string             `json:"cash_location_challenge_id"`
	Phone                   string             `json:"phone"`
	Address                 string             `json:"address"`
	Comment                 string             `json:"comment"`
	PaymentMethod           core.PaymentMethod `json:"payment_method"`
	TermsAccepted           bool               `json:"terms_accepted"`
	Locale                  string             `json:"locale"`
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
	CategoryID     uuid.UUID `json:"category_id"`
	TitleRU        string    `json:"title_ru"`
	TitleSR        string    `json:"title_sr"`
	TitleEN        string    `json:"title_en"`
	DescriptionRU  string    `json:"description_ru"`
	DescriptionSR  string    `json:"description_sr"`
	DescriptionEN  string    `json:"description_en"`
	PriceMinor     int       `json:"price_minor"`
	PhotoPath      string    `json:"photo_path"`
	WeightText     string    `json:"weight_text"`
	MinQuantity    int       `json:"min_quantity"`
	AllergenTextRU string    `json:"allergen_text_ru"`
	AllergenTextSR string    `json:"allergen_text_sr"`
	AllergenTextEN string    `json:"allergen_text_en"`
	SortOrder      int       `json:"sort_order"`
	Visible        bool      `json:"visible"`
	Version        int       `json:"version"`
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

func New(pool *pgxpool.Pool, box *cryptobox.Box) *Store {
	return &Store{pool: pool, box: box}
}

func (s *Store) BootstrapOwner(ctx context.Context, telegramUserID int64) error {
	if telegramUserID == 0 {
		return nil
	}
	user, err := s.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: telegramUserID,
		Username:       "owner",
		FirstName:      "Owner",
		PhotoURL:       "",
		LanguageCode:   "ru",
	})
	if err != nil {
		return err
	}
	for _, role := range []core.Role{core.RoleAdmin, core.RoleKitchen, core.RoleCourier} {
		_, err := s.pool.Exec(ctx, `
			INSERT INTO staff (user_id, telegram_user_id, role, display_label, active, created_by)
			VALUES ($1, $2, $3, $4, true, $1)
			ON CONFLICT (telegram_user_id, role)
			DO UPDATE SET active=true, user_id=EXCLUDED.user_id, display_label=EXCLUDED.display_label, updated_at=now()
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
		INSERT INTO sessions (token_hash, user_id, telegram_user_id, audience, active_role, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, tokenHash, user.ID, user.TelegramUserID, string(audience), string(role), expiresAt)
	if err != nil {
		return core.Session{}, nil, err
	}
	return core.Session{
		Token:          token,
		TokenHash:      tokenHash,
		UserID:         user.ID,
		TelegramUserID: user.TelegramUserID,
		Username:       user.Username,
		FirstName:      user.FirstName,
		PhotoURL:       user.PhotoURL,
		Audience:       audience,
		ActiveRole:     role,
		ExpiresAt:      expiresAt,
	}, roles, nil
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
	return sess, err
}

func (s *Store) Settings(ctx context.Context) (core.Settings, error) {
	var settings core.Settings
	err := s.pool.QueryRow(ctx, `
		SELECT timezone, currency, manual_day_off, day_off_banner, flat_delivery_fee_minor,
			support_text, support_phone, terms_url, max_item_quantity, max_comment_length,
			cash_enabled, card_enabled, crypto_enabled, cash_location_required, restaurant_latitude,
			restaurant_longitude, cash_location_radius_meters, cash_location_ttl_seconds,
			cash_location_max_accuracy_meters, version
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

func (s *Store) SetManualDayOff(ctx context.Context, sess core.Session, enabled bool) (core.Settings, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Settings{}, core.ErrForbidden
	}
	before, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	_, err = s.pool.Exec(ctx, `
		UPDATE app_settings SET manual_day_off=$1, version=version+1, updated_at=now() WHERE id=true
	`, enabled)
	if err != nil {
		return core.Settings{}, err
	}
	after, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	_ = s.insertAudit(ctx, sess, "settings.manual_day_off", "app_settings", nil, "", map[string]any{"manual_day_off": before.ManualDayOff}, map[string]any{"manual_day_off": after.ManualDayOff})
	return after, nil
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
	if input.FlatDeliveryFeeMinor < 0 || input.MaxItemQuantity <= 0 || input.MaxCommentLength <= 0 || !input.CashEnabled {
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
	before, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE app_settings
		SET flat_delivery_fee_minor=$1, support_text=$2, support_phone=$3, terms_url=$4,
			max_item_quantity=$5, max_comment_length=$6, cash_enabled=$7, card_enabled=false,
			crypto_enabled=false, cash_location_required=$8, restaurant_latitude=$9, restaurant_longitude=$10,
			cash_location_radius_meters=$11, cash_location_ttl_seconds=$12,
			cash_location_max_accuracy_meters=$13, version=version+1, updated_at=now()
		WHERE id=true AND version=$14
	`, input.FlatDeliveryFeeMinor, safe(input.SupportText), safe(input.SupportPhone), safe(input.TermsURL),
		input.MaxItemQuantity, input.MaxCommentLength, input.CashEnabled, input.CashLocationRequired,
		input.RestaurantLatitude, input.RestaurantLongitude, input.CashLocationRadiusMeters,
		input.CashLocationTTLSeconds, input.CashLocationMaxAccuracyMeters, input.Version)
	if err != nil {
		return core.Settings{}, err
	}
	if result.RowsAffected() == 0 {
		return core.Settings{}, core.ErrOrderStatusConflict
	}
	after, err := s.Settings(ctx)
	if err != nil {
		return core.Settings{}, err
	}
	_ = s.insertAudit(ctx, sess, "settings.update", "app_settings", nil, "", safeSettingsAudit(before), safeSettingsAudit(after))
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
	if err := s.insertAuditTx(ctx, tx, sess, "schedule.update", "restaurant_schedule", nil, "", map[string]any{"schedule": before}, map[string]any{"schedule": days}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Schedule(ctx)
}

func (s *Store) Menu(ctx context.Context, locale string) ([]core.Category, error) {
	catRows, err := s.pool.Query(ctx, `
		SELECT id, title_ru, title_sr, title_en, sort_order
		FROM categories
		WHERE visible=true AND archived=false
		ORDER BY sort_order, title_ru
	`)
	if err != nil {
		return nil, err
	}
	defer catRows.Close()
	categories := make([]core.Category, 0)
	index := map[uuid.UUID]int{}
	for catRows.Next() {
		var id uuid.UUID
		var titleRU, titleSR, titleEN string
		var sortOrder int
		if err := catRows.Scan(&id, &titleRU, &titleSR, &titleEN, &sortOrder); err != nil {
			return nil, err
		}
		index[id] = len(categories)
		categories = append(categories, core.Category{ID: id, Title: localized(locale, titleRU, titleSR, titleEN), SortOrder: sortOrder})
	}
	if err := catRows.Err(); err != nil {
		return nil, err
	}

	itemRows, err := s.pool.Query(ctx, `
		SELECT id, category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
			price_minor, currency, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en,
			sort_order, version
		FROM menu_items
		WHERE visible=true AND archived=false
		ORDER BY sort_order, title_ru
	`)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()
	for itemRows.Next() {
		var item core.MenuItem
		var titleRU, titleSR, titleEN, descRU, descSR, descEN, allergenRU, allergenSR, allergenEN string
		if err := itemRows.Scan(
			&item.ID, &item.CategoryID, &titleRU, &titleSR, &titleEN, &descRU, &descSR, &descEN,
			&item.PriceMinor, &item.Currency, &item.PhotoPath, &item.WeightText, &item.MinQuantity, &allergenRU, &allergenSR, &allergenEN,
			&item.SortOrder, &item.Version,
		); err != nil {
			return nil, err
		}
		item.Title = localized(locale, titleRU, titleSR, titleEN)
		item.Description = localized(locale, descRU, descSR, descEN)
		item.AllergenText = localized(locale, allergenRU, allergenSR, allergenEN)
		if pos, ok := index[item.CategoryID]; ok {
			categories[pos].Items = append(categories[pos].Items, item)
		}
	}
	return categories, itemRows.Err()
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
			mi.description_en, mi.price_minor, mi.currency, mi.photo_path, mi.weight_text, mi.min_quantity,
			mi.allergen_text_ru, mi.allergen_text_sr, mi.allergen_text_en, mi.sort_order, mi.visible, mi.archived,
			EXISTS (SELECT 1 FROM order_items oi WHERE oi.menu_item_id=mi.id) AS used_in_orders,
			mi.version, mi.created_at, mi.updated_at
		FROM menu_items mi
		ORDER BY mi.archived, mi.sort_order, mi.title_ru
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []core.AdminMenuItem{}
	for rows.Next() {
		var item core.AdminMenuItem
		if err := rows.Scan(
			&item.ID, &item.CategoryID, &item.TitleRU, &item.TitleSR, &item.TitleEN, &item.DescriptionRU, &item.DescriptionSR,
			&item.DescriptionEN, &item.PriceMinor, &item.Currency, &item.PhotoPath, &item.WeightText, &item.MinQuantity,
			&item.AllergenTextRU, &item.AllergenTextSR, &item.AllergenTextEN, &item.SortOrder, &item.Visible, &item.Archived, &item.UsedInOrders,
			&item.Version, &item.CreatedAt, &item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateCategory(ctx context.Context, sess core.Session, input UpsertCategoryInput) (core.AdminCategory, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminCategory{}, core.ErrForbidden
	}
	if strings.TrimSpace(input.TitleRU) == "" {
		return core.AdminCategory{}, core.ErrInvalidInput
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO categories (title_ru, title_sr, title_en, sort_order, visible)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, safe(input.TitleRU), safe(input.TitleSR), safe(input.TitleEN), input.SortOrder, input.Visible).Scan(&id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	_ = s.insertAudit(ctx, sess, "category.create", "category", &id, "", nil, map[string]any{"title_ru": safe(input.TitleRU)})
	return s.adminCategoryByID(ctx, id)
}

func (s *Store) UpdateCategory(ctx context.Context, sess core.Session, id uuid.UUID, input UpsertCategoryInput) (core.AdminCategory, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminCategory{}, core.ErrForbidden
	}
	if strings.TrimSpace(input.TitleRU) == "" || input.Version <= 0 {
		return core.AdminCategory{}, core.ErrInvalidInput
	}
	before, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	result, err := s.pool.Exec(ctx, `
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
	after, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	_ = s.insertAudit(ctx, sess, "category.update", "category", &id, "", categoryAudit(before), categoryAudit(after))
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
	result, err := s.pool.Exec(ctx, `
		UPDATE categories SET visible=false, archived=true, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=false
	`, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminCategory{}, core.ErrOrderStatusConflict
	}
	after, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	_ = s.insertAudit(ctx, sess, "category.archive", "category", &id, safe(reason), categoryAudit(before), categoryAudit(after))
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
	result, err := s.pool.Exec(ctx, `
		UPDATE categories SET visible=true, archived=false, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=true
	`, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminCategory{}, core.ErrOrderStatusConflict
	}
	after, err := s.adminCategoryByID(ctx, id)
	if err != nil {
		return core.AdminCategory{}, err
	}
	_ = s.insertAudit(ctx, sess, "category.restore", "category", &id, safe(reason), categoryAudit(before), categoryAudit(after))
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
		_, err := s.pool.Exec(ctx, `DELETE FROM categories WHERE id=$1`, id)
		if err != nil {
			return "", err
		}
		_ = s.insertAudit(ctx, sess, "category.delete", "category", &id, safe(reason), nil, nil)
		return "deleted", nil
	}
	_, err := s.ArchiveCategory(ctx, sess, id, reason)
	return "archived", err
}

func (s *Store) CreateMenuItem(ctx context.Context, sess core.Session, input UpsertMenuItemInput) (core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminMenuItem{}, core.ErrForbidden
	}
	if strings.TrimSpace(input.TitleRU) == "" || input.PriceMinor < 0 || input.CategoryID == uuid.Nil || input.MinQuantity <= 0 {
		return core.AdminMenuItem{}, core.ErrInvalidInput
	}
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO menu_items (
			category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
			price_minor, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en,
			sort_order, visible
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING id
	`, input.CategoryID, safe(input.TitleRU), safe(input.TitleSR), safe(input.TitleEN), safe(input.DescriptionRU), safe(input.DescriptionSR),
		safe(input.DescriptionEN), input.PriceMinor, safe(input.PhotoPath), safe(input.WeightText), input.MinQuantity,
		safe(input.AllergenTextRU), safe(input.AllergenTextSR), safe(input.AllergenTextEN), input.SortOrder, input.Visible).Scan(&id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	_ = s.insertAudit(ctx, sess, "menu_item.create", "menu_item", &id, "", nil, map[string]any{"title_ru": safe(input.TitleRU), "price_minor": input.PriceMinor})
	return s.adminMenuItemByID(ctx, id)
}

func (s *Store) UpdateMenuItem(ctx context.Context, sess core.Session, id uuid.UUID, input UpsertMenuItemInput) (core.AdminMenuItem, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.AdminMenuItem{}, core.ErrForbidden
	}
	if strings.TrimSpace(input.TitleRU) == "" || input.PriceMinor < 0 || input.CategoryID == uuid.Nil || input.MinQuantity <= 0 || input.Version <= 0 {
		return core.AdminMenuItem{}, core.ErrInvalidInput
	}
	before, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE menu_items
		SET category_id=$1, title_ru=$2, title_sr=$3, title_en=$4, description_ru=$5, description_sr=$6,
			description_en=$7, price_minor=$8, photo_path=$9, weight_text=$10, min_quantity=$11,
			allergen_text_ru=$12, allergen_text_sr=$13, allergen_text_en=$14, sort_order=$15, visible=$16,
			version=version+1, updated_at=now()
		WHERE id=$17 AND version=$18 AND archived=false
	`, input.CategoryID, safe(input.TitleRU), safe(input.TitleSR), safe(input.TitleEN), safe(input.DescriptionRU), safe(input.DescriptionSR),
		safe(input.DescriptionEN), input.PriceMinor, safe(input.PhotoPath), safe(input.WeightText), input.MinQuantity,
		safe(input.AllergenTextRU), safe(input.AllergenTextSR), safe(input.AllergenTextEN), input.SortOrder, input.Visible, id, input.Version)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminMenuItem{}, core.ErrOrderStatusConflict
	}
	after, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	action := "menu_item.update"
	reason := ""
	if before.PriceMinor != after.PriceMinor {
		action = "menu_item.price_change"
		reason = fmt.Sprintf("%d -> %d", before.PriceMinor, after.PriceMinor)
	}
	_ = s.insertAudit(ctx, sess, action, "menu_item", &id, reason, menuItemAudit(before), menuItemAudit(after))
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
	result, err := s.pool.Exec(ctx, `
		UPDATE menu_items SET visible=false, archived=true, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=false
	`, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminMenuItem{}, core.ErrOrderStatusConflict
	}
	after, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	_ = s.insertAudit(ctx, sess, "menu_item.archive", "menu_item", &id, safe(reason), menuItemAudit(before), menuItemAudit(after))
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
	result, err := s.pool.Exec(ctx, `
		UPDATE menu_items SET visible=true, archived=false, version=version+1, updated_at=now()
		WHERE id=$1 AND archived=true
	`, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	if result.RowsAffected() == 0 {
		return core.AdminMenuItem{}, core.ErrOrderStatusConflict
	}
	after, err := s.adminMenuItemByID(ctx, id)
	if err != nil {
		return core.AdminMenuItem{}, err
	}
	_ = s.insertAudit(ctx, sess, "menu_item.restore", "menu_item", &id, safe(reason), menuItemAudit(before), menuItemAudit(after))
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
		_, err := s.pool.Exec(ctx, `DELETE FROM menu_items WHERE id=$1`, id)
		if err != nil {
			return "", err
		}
		_ = s.insertAudit(ctx, sess, "menu_item.delete", "menu_item", &id, safe(reason), nil, nil)
		return "deleted", nil
	}
	_, err := s.ArchiveMenuItem(ctx, sess, id, reason)
	return "archived", err
}

func (s *Store) Calculate(ctx context.Context, sess core.Session, input []core.CartItemInput, now time.Time) (core.Calculation, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Calculation{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.Calculation{}, err
	}
	quantities := map[uuid.UUID]int{}
	for _, item := range input {
		if item.Quantity <= 0 || item.Quantity > settings.MaxItemQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
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
		Items:            make([]core.CalculatedItem, 0, len(quantities)),
		DeliveryFeeMinor: settings.FlatDeliveryFeeMinor,
		Currency:         settings.Currency,
		ExpiresAt:        now.UTC().Add(10 * time.Minute),
	}
	for id, qty := range quantities {
		var title string
		var price, version, minQuantity int
		err := s.pool.QueryRow(ctx, `
			SELECT mi.title_ru, mi.price_minor, mi.version, mi.min_quantity
			FROM menu_items mi
			JOIN categories c ON c.id=mi.category_id
			WHERE mi.id=$1 AND mi.visible=true AND mi.archived=false AND c.visible=true AND c.archived=false
		`, id).Scan(&title, &price, &version, &minQuantity)
		if errors.Is(err, pgx.ErrNoRows) {
			return core.Calculation{}, core.ErrItemUnavailable
		}
		if err != nil {
			return core.Calculation{}, err
		}
		if qty < minQuantity {
			return core.Calculation{}, core.ErrInvalidQuantity
		}
		line := price * qty
		calc.SubtotalMinor += line
		calc.Items = append(calc.Items, core.CalculatedItem{
			ItemID:         id,
			Title:          title,
			UnitPriceMinor: price,
			Quantity:       qty,
			LineTotalMinor: line,
			Version:        version,
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
		INSERT INTO calculation_tokens (token_hash, user_id, items_json, subtotal_minor, delivery_fee_minor,
			total_minor, currency, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, tokenHash, sess.UserID, itemsJSON, calc.SubtotalMinor, calc.DeliveryFeeMinor, calc.TotalMinor, calc.Currency, calc.ExpiresAt)
	if err != nil {
		return core.Calculation{}, err
	}
	calc.Token = token
	return calc, nil
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
	if !verifiedAt.Valid || strings.TrimSpace(phoneCipher) == "" {
		return core.VerifiedContact{Verified: false}, nil
	}
	phone, err := s.box.Decrypt(phoneCipher)
	if err != nil {
		return core.VerifiedContact{}, err
	}
	return core.VerifiedContact{
		Verified:   true,
		Phone:      phone,
		Masked:     maskPhone(phone),
		VerifiedAt: &verifiedAt.Time,
	}, nil
}

func (s *Store) VerifyTelegramContact(ctx context.Context, telegramUserID, contactUserID int64, phone string) error {
	phone = safe(phone)
	if telegramUserID <= 0 || telegramUserID != contactUserID || phone == "" {
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
	`, telegramUserID, phoneCipher, hashPII(phone))
	return err
}

func (s *Store) CreateCashLocationChallenge(ctx context.Context, sess core.Session, input CreateCashLocationChallengeInput, now time.Time, devBypass bool) (core.CashLocationChallenge, error) {
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
			WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND expires_at > now()
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
	var promptMessageID sql.NullInt64
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, user_id, prompt_message_id, expires_at
		FROM cash_location_challenges
		WHERE telegram_user_id=$1 AND status='PENDING' AND used_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1
		FOR UPDATE
	`, telegramUserID).Scan(&id, &userID, &promptMessageID, &expiresAt)
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
	if promptMessageID.Valid && replyToMessageID > 0 && promptMessageID.Int64 != replyToMessageID {
		return s.rejectCashLocationChallengeTx(ctx, tx, id, userID, "PROMPT_MISMATCH")
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
	if accuracyMeters != nil {
		if *accuracyMeters < 0 {
			return s.rejectCashLocationChallengeTx(ctx, tx, id, userID, "LOCATION_INACCURATE")
		}
		accuracy = int(math.Ceil(*accuracyMeters))
	}
	if accuracy > settings.CashLocationMaxAccuracyMeters {
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
	address := safe(input.Address)
	comment := safe(input.Comment)
	if address == "" {
		return core.Order{}, core.ErrInvalidInput
	}
	if len([]rune(comment)) > settings.MaxCommentLength {
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

	tokenHash := hashString(input.CalculationToken)
	var rawItems []byte
	var subtotal, delivery, total int
	var currency string
	err = tx.QueryRow(ctx, `
		SELECT items_json, subtotal_minor, delivery_fee_minor, total_minor, currency
		FROM calculation_tokens
		WHERE token_hash=$1 AND user_id=$2 AND used_at IS NULL AND expires_at > now()
		FOR UPDATE
	`, tokenHash, sess.UserID).Scan(&rawItems, &subtotal, &delivery, &total, &currency)
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
	phone, err := s.verifiedPhoneForCashOrder(ctx, tx, sess.UserID, input.Phone)
	if err != nil {
		return core.Order{}, err
	}
	cashLocationChallengeID, cashLocationVerifiedAt, cashLocationDistance, err := s.useCashLocationChallengeTx(ctx, tx, sess, input.CashLocationChallengeID, tokenHash, settings, now)
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
	phoneHash := hashPII(phone)
	var orderID uuid.UUID
	var publicNumber int
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO orders (
			client_user_id, fulfillment_status, payment_method, payment_status, subtotal_minor, delivery_fee_minor,
			total_minor, currency, phone_ciphertext, phone_hash, address_ciphertext, customer_comment, locale,
			cash_location_challenge_id, cash_location_verified_at, cash_location_distance_meters
		)
		VALUES ($1, 'NEW', 'cash', 'CASH_PENDING', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING id, public_number, created_at
	`, sess.UserID, subtotal, delivery, total, currency, phoneCipher, phoneHash, addressCipher, comment, localeOrDefault(input.Locale),
		uuidSQL(cashLocationChallengeID), timeSQL(cashLocationVerifiedAt), intSQL(cashLocationDistance)).
		Scan(&orderID, &publicNumber, &createdAt)
	if err != nil {
		return core.Order{}, err
	}
	for pos, item := range items {
		_, err := tx.Exec(ctx, `
			INSERT INTO order_items (order_id, menu_item_id, snapshot_title, unit_price_minor, quantity, line_total_minor, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, orderID, item.ItemID, item.Title, item.UnitPriceMinor, item.Quantity, item.LineTotalMinor, pos)
		if err != nil {
			return core.Order{}, err
		}
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

func (s *Store) KitchenOrders(ctx context.Context, sess core.Session) ([]core.Order, error) {
	if sess.ActiveRole != core.RoleKitchen {
		return nil, core.ErrForbidden
	}
	return s.ordersByStatus(ctx, core.StatusNew, false)
}

func (s *Store) CourierOrders(ctx context.Context, sess core.Session) ([]core.Order, error) {
	if sess.ActiveRole != core.RoleCourier {
		return nil, core.ErrForbidden
	}
	return s.ordersByStatus(ctx, core.StatusOutForDelivery, true)
}

func (s *Store) ClientOrders(ctx context.Context, sess core.Session) ([]core.Order, error) {
	if sess.ActiveRole != core.RoleClient {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id FROM orders WHERE client_user_id=$1 ORDER BY created_at DESC LIMIT 50
	`, sess.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.ordersFromIDRows(ctx, rows, true)
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

func (s *Store) AdminOrders(ctx context.Context, sess core.Session, filter AdminOrderFilter) ([]core.Order, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	where := []string{"true"}
	args := []any{}
	if filter.Status != "" {
		where = append(where, fmt.Sprintf("fulfillment_status=$%d", len(args)+1))
		args = append(args, filter.Status)
	}
	if filter.Date != "" {
		where = append(where, fmt.Sprintf("to_char(created_at AT TIME ZONE 'Europe/Belgrade', 'YYYY-MM-DD')=$%d", len(args)+1))
		args = append(args, filter.Date)
	}
	query := strings.TrimSpace(filter.Query)
	if query != "" {
		if publicNumber, err := strconv.Atoi(query); err == nil {
			where = append(where, fmt.Sprintf("(public_number=$%d OR phone_hash=$%d)", len(args)+1, len(args)+2))
			args = append(args, publicNumber, hashPII(query))
		} else {
			where = append(where, fmt.Sprintf("phone_hash=$%d", len(args)+1))
			args = append(args, hashPII(query))
		}
	}
	sqlQuery := fmt.Sprintf(`SELECT id FROM orders WHERE %s ORDER BY created_at DESC LIMIT 100`, strings.Join(where, " AND "))
	rows, err := s.pool.Query(ctx, sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.ordersFromIDRows(ctx, rows, true)
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
	if reason == "" {
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
			WHERE id=$1 AND fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY')
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
	if reason == "" {
		return core.Order{}, core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Order{}, err
	}
	defer rollback(ctx, tx)
	tag, err := tx.Exec(ctx, `
		UPDATE orders
		SET fulfillment_status='NEW', ready_at=NULL, updated_at=now(), version=version+1
		WHERE id=$1 AND fulfillment_status='OUT_FOR_DELIVERY'
	`, orderID)
	if err != nil {
		return core.Order{}, err
	}
	if tag.RowsAffected() == 0 {
		return core.Order{}, core.ErrOrderStatusConflict
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_events (order_id, from_status, to_status, action, actor_user_id, actor_role, reason)
		VALUES ($1, 'OUT_FOR_DELIVERY', 'NEW', 'admin_return_to_new', $2, $3, $4)
	`, orderID, sess.UserID, string(sess.ActiveRole), reason); err != nil {
		return core.Order{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "order.return_to_new", "order", &orderID, reason, map[string]any{"status": "OUT_FOR_DELIVERY"}, map[string]any{"status": "NEW"}); err != nil {
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
	if phone == "" || address == "" || reason == "" {
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
		WHERE id=$4 AND fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY')
	`, phoneCipher, hashPII(phone), addressCipher, orderID)
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
	_, err := s.pool.Exec(ctx, `
		INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
		VALUES ($1, $2, $3, $4)
	`, orderID, recipient, template, fmt.Sprintf("order:%s:resend:%s:%d", orderID, recipient, time.Now().UnixNano()))
	if err != nil {
		return err
	}
	return s.insertAudit(ctx, sess, "order.resend_notification", "order", &orderID, safe(reason), nil, map[string]any{"recipient": recipient})
}

func (s *Store) AddOrderNote(ctx context.Context, sess core.Session, orderID uuid.UUID, reason string) error {
	if sess.ActiveRole != core.RoleAdmin {
		return core.ErrForbidden
	}
	reason = safe(reason)
	if reason == "" {
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
	if input.Active && input.Role == core.RoleCourier {
		if err := s.ensureNoOtherActiveCourier(ctx, uuid.Nil); err != nil {
			return core.StaffMember{}, err
		}
	}
	user, err := s.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: input.TelegramUserID,
		FirstName:      safe(input.DisplayLabel),
		LanguageCode:   "ru",
	})
	if err != nil {
		return core.StaffMember{}, err
	}
	var id uuid.UUID
	err = s.pool.QueryRow(ctx, `
		INSERT INTO staff (user_id, telegram_user_id, role, display_label, active, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (telegram_user_id, role)
		DO UPDATE SET user_id=EXCLUDED.user_id, display_label=EXCLUDED.display_label,
			active=EXCLUDED.active, updated_at=now()
		RETURNING id
	`, user.ID, input.TelegramUserID, string(input.Role), safe(input.DisplayLabel), input.Active, sess.UserID).Scan(&id)
	if err != nil {
		return core.StaffMember{}, err
	}
	member, err := s.staffByID(ctx, id)
	if err != nil {
		return core.StaffMember{}, err
	}
	_ = s.insertAudit(ctx, sess, "staff.upsert", "staff", &id, "", nil, staffAudit(member))
	return member, nil
}

func (s *Store) UpdateStaff(ctx context.Context, sess core.Session, id uuid.UUID, input UpdateStaffInput) (core.StaffMember, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.StaffMember{}, core.ErrForbidden
	}
	if !validStaffRole(input.Role) {
		return core.StaffMember{}, core.ErrInvalidInput
	}
	before, err := s.staffByID(ctx, id)
	if err != nil {
		return core.StaffMember{}, err
	}
	if before.Role == core.RoleAdmin && before.Active && !input.Active {
		if err := s.ensureNotLastAdmin(ctx, id); err != nil {
			return core.StaffMember{}, err
		}
	}
	if input.Active && input.Role == core.RoleCourier {
		if err := s.ensureNoOtherActiveCourier(ctx, id); err != nil {
			return core.StaffMember{}, err
		}
	}
	if input.DisplayLabel == "" {
		input.DisplayLabel = before.DisplayLabel
	}
	result, err := s.pool.Exec(ctx, `
		UPDATE staff SET role=$1, display_label=$2, active=$3, updated_at=now()
		WHERE id=$4
	`, string(input.Role), safe(input.DisplayLabel), input.Active, id)
	if err != nil {
		return core.StaffMember{}, err
	}
	if result.RowsAffected() == 0 {
		return core.StaffMember{}, core.ErrInvalidInput
	}
	after, err := s.staffByID(ctx, id)
	if err != nil {
		return core.StaffMember{}, err
	}
	if before.Active && !after.Active {
		_, _ = s.pool.Exec(ctx, `
			UPDATE sessions SET revoked_at=now()
			WHERE telegram_user_id=$1 AND active_role=$2 AND revoked_at IS NULL
		`, after.TelegramUserID, string(after.Role))
	}
	_ = s.insertAudit(ctx, sess, "staff.update", "staff", &id, "", staffAudit(before), staffAudit(after))
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
		DayOffBanner:             settings.DayOffBanner,
		FlatDeliveryFeeMinor:     settings.FlatDeliveryFeeMinor,
		Currency:                 settings.Currency,
		EnabledPayments:          payments,
		SupportedLocales:         []string{"ru", "sr", "en"},
		SupportText:              settings.SupportText,
		CashLocationRequired:     settings.CashLocationRequired,
		CashLocationRadiusMeters: settings.CashLocationRadiusMeters,
	}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		loc = time.FixedZone("Europe/Belgrade", 3600)
	}
	localNow := now.In(loc)
	startLocal := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), 0, 0, 0, 0, loc)
	endLocal := startLocal.Add(24 * time.Hour)
	var dashboard core.AdminDashboard
	err = s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE fulfillment_status='NEW')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='OUT_FOR_DELIVERY')::int,
			COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2)::int,
			COALESCE(SUM(total_minor) FILTER (
				WHERE created_at >= $1 AND created_at < $2
					AND fulfillment_status='DELIVERED' AND payment_status='PAID'
			), 0)::int
		FROM orders
	`, startLocal.UTC(), endLocal.UTC()).Scan(&dashboard.NewOrders, &dashboard.OutForDelivery, &dashboard.OrdersToday, &dashboard.RevenueTodayMinor)
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
		Currency:    settings.Currency,
		From:        from.UTC(),
		To:          to.UTC(),
		GeneratedAt: now.UTC(),
	}
	err = s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE fulfillment_status='DELIVERED')::int,
			COUNT(*) FILTER (WHERE fulfillment_status='CANCELLED')::int,
			COALESCE(SUM(total_minor) FILTER (WHERE fulfillment_status='DELIVERED' AND payment_status='PAID'), 0)::int
		FROM orders
		WHERE created_at >= $1 AND created_at < $2
	`, from.UTC(), to.UTC()).Scan(
		&analytics.Summary.AllOrders,
		&analytics.Summary.DeliveredOrders,
		&analytics.Summary.CancelledOrders,
		&analytics.Summary.RevenueMinor,
	)
	if err != nil {
		return core.AdminAnalytics{}, err
	}
	if analytics.Summary.DeliveredOrders > 0 {
		analytics.Summary.AverageCheckMinor = analytics.Summary.RevenueMinor / analytics.Summary.DeliveredOrders
	}
	statusRows, err := s.pool.Query(ctx, `
		SELECT fulfillment_status, COUNT(*)::int,
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
		if err := statusRows.Scan(&row.Key, &row.Count, &row.RevenueMinor); err != nil {
			return core.AdminAnalytics{}, err
		}
		analytics.Statuses = append(analytics.Statuses, row)
	}
	if err := statusRows.Err(); err != nil {
		return core.AdminAnalytics{}, err
	}
	paymentRows, err := s.pool.Query(ctx, `
		SELECT payment_method, COUNT(*)::int,
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
		if err := paymentRows.Scan(&row.Key, &row.Count, &row.RevenueMinor); err != nil {
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
	return analytics, dailyRows.Err()
}

func (s *Store) AuditLog(ctx context.Context, sess core.Session) ([]core.AuditEntry, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, actor_role, action, target_type, target_id, reason, before_json, after_json, created_at
		FROM audit_log
		ORDER BY created_at DESC
		LIMIT 100
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []core.AuditEntry{}
	for rows.Next() {
		var entry core.AuditEntry
		var targetID *uuid.UUID
		var beforeRaw, afterRaw []byte
		if err := rows.Scan(&entry.ID, &entry.ActorRole, &entry.Action, &entry.TargetType, &targetID, &entry.Reason, &beforeRaw, &afterRaw, &entry.CreatedAt); err != nil {
			return nil, err
		}
		entry.TargetID = targetID
		_ = json.Unmarshal(beforeRaw, &entry.Before)
		_ = json.Unmarshal(afterRaw, &entry.After)
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Store) MarkReady(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string) (core.Order, error) {
	if sess.ActiveRole != core.RoleKitchen {
		return core.Order{}, core.ErrForbidden
	}
	return s.transition(ctx, sess, orderID, "orders.mark_ready", idempotencyKey, requestHash, core.StatusNew, core.StatusOutForDelivery)
}

func (s *Store) MarkDelivered(ctx context.Context, sess core.Session, orderID uuid.UUID, idempotencyKey, requestHash string) (core.Order, error) {
	if sess.ActiveRole != core.RoleCourier {
		return core.Order{}, core.ErrForbidden
	}
	return s.transition(ctx, sess, orderID, "orders.mark_delivered", idempotencyKey, requestHash, core.StatusOutForDelivery, core.StatusDelivered)
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
		WHERE id=$1 AND fulfillment_status='OUT_FOR_DELIVERY'
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

func (s *Store) transition(ctx context.Context, sess core.Session, orderID uuid.UUID, operation, idempotencyKey, requestHash string, from, to core.FulfillmentStatus) (core.Order, error) {
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
	if to == core.StatusOutForDelivery {
		action = "mark_ready"
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET fulfillment_status='OUT_FOR_DELIVERY', ready_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_status='NEW'
			RETURNING id, 'NEW'
		`, orderID).Scan(&updatedID, &previous)
	} else {
		action = "mark_delivered"
		err = tx.QueryRow(ctx, `
			UPDATE orders
			SET fulfillment_status='DELIVERED', payment_status='PAID', delivered_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND fulfillment_status='OUT_FOR_DELIVERY'
			RETURNING id, 'OUT_FOR_DELIVERY'
		`, orderID).Scan(&updatedID, &previous)
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
	`, orderID, string(from), string(to), action, sess.UserID, string(sess.ActiveRole))
	if err != nil {
		return core.Order{}, err
	}
	if to == core.StatusOutForDelivery {
		if _, err := tx.Exec(ctx, `
			INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key)
			VALUES
				($1, 'client', 'client_order_out_for_delivery', $2),
				($1, 'courier', 'courier_ready_order', $2)
			ON CONFLICT (event_key, recipient_kind) DO NOTHING
		`, orderID, fmt.Sprintf("order:%s:ready", orderID)); err != nil {
			return core.Order{}, err
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
	var ready, delivered, cancelled sql.NullTime
	var locationVerified sql.NullTime
	var locationDistance sql.NullInt32
	err := s.pool.QueryRow(ctx, `
		SELECT o.id, o.public_number, o.client_user_id, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency, o.phone_ciphertext, o.address_ciphertext,
			o.customer_comment, o.locale, o.version, o.created_at, o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=$1
	`, orderID).Scan(
		&order.ID, &order.PublicNumber, &order.ClientUserID, &order.ClientUsername, &order.ClientFirstName, &order.ClientPhotoURL,
		&order.FulfillmentStatus, &order.PaymentMethod,
		&order.PaymentStatus, &order.SubtotalMinor, &order.DeliveryFeeMinor, &order.TotalMinor, &order.Currency,
		&phoneCipher, &addressCipher, &order.CustomerComment, &order.Locale, &order.Version, &order.CreatedAt,
		&ready, &delivered, &cancelled,
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
	items, err := s.orderItems(ctx, order.ID)
	if err != nil {
		return core.Order{}, err
	}
	order.Items = items
	return order, nil
}

func (s *Store) orderItems(ctx context.Context, orderID uuid.UUID) ([]core.OrderItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT menu_item_id, snapshot_title, unit_price_minor, quantity, line_total_minor
		FROM order_items WHERE order_id=$1 ORDER BY sort_order
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []core.OrderItem{}
	for rows.Next() {
		var item core.OrderItem
		if err := rows.Scan(&item.MenuItemID, &item.SnapshotTitle, &item.UnitPriceMinor, &item.Quantity, &item.LineTotalMinor); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
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
		SELECT id FROM orders WHERE fulfillment_status=$1 ORDER BY updated_at ASC LIMIT 50
	`, string(status))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.ordersFromIDRows(ctx, rows, includePII)
}

func (s *Store) ordersFromIDRows(ctx context.Context, rows pgx.Rows, includePII bool) ([]core.Order, error) {
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	orders := make([]core.Order, 0, len(ids))
	for _, id := range ids {
		order, err := s.OrderByID(ctx, id, includePII)
		if err != nil {
			return nil, err
		}
		orders = append(orders, order)
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
	err := s.pool.QueryRow(ctx, `
		SELECT mi.id, mi.category_id, mi.title_ru, mi.title_sr, mi.title_en, mi.description_ru, mi.description_sr,
			mi.description_en, mi.price_minor, mi.currency, mi.photo_path, mi.weight_text, mi.min_quantity,
			mi.allergen_text_ru, mi.allergen_text_sr, mi.allergen_text_en, mi.sort_order, mi.visible, mi.archived,
			EXISTS (SELECT 1 FROM order_items oi WHERE oi.menu_item_id=mi.id) AS used_in_orders,
			mi.version, mi.created_at, mi.updated_at
		FROM menu_items mi
		WHERE mi.id=$1
	`, id).Scan(
		&item.ID, &item.CategoryID, &item.TitleRU, &item.TitleSR, &item.TitleEN, &item.DescriptionRU, &item.DescriptionSR,
		&item.DescriptionEN, &item.PriceMinor, &item.Currency, &item.PhotoPath, &item.WeightText, &item.MinQuantity,
		&item.AllergenTextRU, &item.AllergenTextSR, &item.AllergenTextEN, &item.SortOrder, &item.Visible, &item.Archived, &item.UsedInOrders,
		&item.Version, &item.CreatedAt, &item.UpdatedAt,
	)
	return item, err
}

func (s *Store) staffByID(ctx context.Context, id uuid.UUID) (core.StaffMember, error) {
	var member core.StaffMember
	err := s.pool.QueryRow(ctx, `
		SELECT id, telegram_user_id, display_label, role, active, created_at, updated_at
		FROM staff WHERE id=$1
	`, id).Scan(&member.ID, &member.TelegramUserID, &member.DisplayLabel, &member.Role, &member.Active, &member.CreatedAt, &member.UpdatedAt)
	return member, err
}

func (s *Store) ensureNotLastAdmin(ctx context.Context, id uuid.UUID) error {
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM staff WHERE role='ADMIN' AND active=true AND id<>$1`, id).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return core.ErrInvalidInput
	}
	return nil
}

func (s *Store) ensureNoOtherActiveCourier(ctx context.Context, id uuid.UUID) error {
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM staff WHERE role='COURIER' AND active=true AND id<>$1`, id).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return core.ErrInvalidInput
	}
	return nil
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
		"title_ru":    item.TitleRU,
		"price_minor": item.PriceMinor,
		"visible":     item.Visible,
		"archived":    item.Archived,
		"version":     item.Version,
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
	if trimmed := safe(inputPhone); trimmed != "" && hashPII(trimmed) != phoneHash {
		return "", core.ErrContactNotVerified
	}
	return phone, nil
}

func (s *Store) useCashLocationChallengeTx(ctx context.Context, tx pgx.Tx, sess core.Session, challengeIDText, calculationTokenHash string, settings core.Settings, now time.Time) (*uuid.UUID, *time.Time, *int, error) {
	if !settings.CashLocationRequired {
		return nil, nil, nil, nil
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

func hashPII(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return hashString(normalized)
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
