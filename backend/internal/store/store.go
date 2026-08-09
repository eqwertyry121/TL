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
	"strings"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	cryptobox "github.com/eqwertyry121/TL/backend/internal/crypto"
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
	CalculationToken string             `json:"calculation_token"`
	Phone            string             `json:"phone"`
	Address          string             `json:"address"`
	Comment          string             `json:"comment"`
	PaymentMethod    core.PaymentMethod `json:"payment_method"`
	TermsAccepted    bool               `json:"terms_accepted"`
	Locale           string             `json:"locale"`
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
		LanguageCode:   "ru",
	})
	if err != nil {
		return err
	}
	for _, role := range []core.Role{core.RoleAdmin, core.RoleKitchen, core.RoleCourier} {
		_, err := s.pool.Exec(ctx, `
			INSERT INTO staff (user_id, telegram_user_id, role, active, created_by)
			VALUES ($1, $2, $3, true, $1)
			ON CONFLICT (telegram_user_id, role)
			DO UPDATE SET active=true, user_id=EXCLUDED.user_id, updated_at=now()
		`, user.ID, telegramUserID, string(role))
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
		INSERT INTO users (telegram_user_id, username, first_name, language_code)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (telegram_user_id)
		DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name,
			language_code=EXCLUDED.language_code, updated_at=now()
		RETURNING id, telegram_user_id, username, first_name, language_code
	`, user.TelegramUserID, safe(user.Username), safe(user.FirstName), safe(user.LanguageCode)).
		Scan(&user.ID, &user.TelegramUserID, &user.Username, &user.FirstName, &user.LanguageCode)
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
		Audience:       audience,
		ActiveRole:     role,
		ExpiresAt:      expiresAt,
	}, roles, nil
}

func (s *Store) SessionByToken(ctx context.Context, token string) (core.Session, error) {
	hash := hashString(token)
	var sess core.Session
	err := s.pool.QueryRow(ctx, `
		SELECT token_hash, user_id, telegram_user_id, audience, active_role, expires_at
		FROM sessions
		WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at > now()
	`, hash).Scan(&sess.TokenHash, &sess.UserID, &sess.TelegramUserID, &sess.Audience, &sess.ActiveRole, &sess.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Session{}, core.ErrForbidden
	}
	return sess, err
}

func (s *Store) Settings(ctx context.Context) (core.Settings, error) {
	var settings core.Settings
	err := s.pool.QueryRow(ctx, `
		SELECT timezone, currency, manual_day_off, day_off_banner, flat_delivery_fee_minor,
			support_text, max_item_quantity, max_comment_length, cash_enabled, card_enabled, crypto_enabled
		FROM app_settings WHERE id=true
	`).Scan(
		&settings.Timezone,
		&settings.Currency,
		&settings.ManualDayOff,
		&settings.DayOffBanner,
		&settings.FlatDeliveryFeeMinor,
		&settings.SupportText,
		&settings.MaxItemQuantity,
		&settings.MaxCommentLength,
		&settings.CashEnabled,
		&settings.CardEnabled,
		&settings.CryptoEnabled,
	)
	return settings, err
}

func (s *Store) SetManualDayOff(ctx context.Context, sess core.Session, enabled bool) (core.Settings, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Settings{}, core.ErrForbidden
	}
	_, err := s.pool.Exec(ctx, `
		UPDATE app_settings SET manual_day_off=$1, updated_at=now() WHERE id=true
	`, enabled)
	if err != nil {
		return core.Settings{}, err
	}
	_, _ = s.pool.Exec(ctx, `
		INSERT INTO audit_log (actor_user_id, actor_role, action, target_type)
		VALUES ($1, $2, 'settings.manual_day_off', 'app_settings')
	`, sess.UserID, string(sess.ActiveRole))
	return s.Settings(ctx)
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
			price_minor, currency, photo_path, weight_text, allergen_text_ru, allergen_text_sr, allergen_text_en,
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
			&item.PriceMinor, &item.Currency, &item.PhotoPath, &item.WeightText, &allergenRU, &allergenSR, &allergenEN,
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
		var price, version int
		err := s.pool.QueryRow(ctx, `
			SELECT title_ru, price_minor, version
			FROM menu_items
			WHERE id=$1 AND visible=true AND archived=false
		`, id).Scan(&title, &price, &version)
		if errors.Is(err, pgx.ErrNoRows) {
			return core.Calculation{}, core.ErrItemUnavailable
		}
		if err != nil {
			return core.Calculation{}, err
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

func (s *Store) CreateCashOrder(ctx context.Context, sess core.Session, input CreateOrderInput, idempotencyKey, requestHash string, now time.Time) (core.Order, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Order{}, core.ErrForbidden
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return core.Order{}, core.ErrIdempotencyConflict
	}
	if !input.TermsAccepted {
		return core.Order{}, core.ErrTermsRequired
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
	if len([]rune(input.Comment)) > settings.MaxCommentLength {
		return core.Order{}, core.ErrInvalidQuantity
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
	phoneCipher, err := s.box.Encrypt(strings.TrimSpace(input.Phone))
	if err != nil {
		return core.Order{}, err
	}
	addressCipher, err := s.box.Encrypt(strings.TrimSpace(input.Address))
	if err != nil {
		return core.Order{}, err
	}
	phoneHash := hashPII(input.Phone)
	var orderID uuid.UUID
	var publicNumber int
	var createdAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO orders (
			client_user_id, fulfillment_status, payment_method, payment_status, subtotal_minor, delivery_fee_minor,
			total_minor, currency, phone_ciphertext, phone_hash, address_ciphertext, customer_comment, locale
		)
		VALUES ($1, 'NEW', 'cash', 'CASH_PENDING', $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, public_number, created_at
	`, sess.UserID, subtotal, delivery, total, currency, phoneCipher, phoneHash, addressCipher, safe(input.Comment), localeOrDefault(input.Locale)).
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
		ID:                orderID,
		PublicNumber:      publicNumber,
		ClientUserID:      sess.UserID,
		FulfillmentStatus: core.StatusNew,
		PaymentMethod:     core.PaymentCash,
		PaymentStatus:     core.PaymentCashPending,
		SubtotalMinor:     subtotal,
		DeliveryFeeMinor:  delivery,
		TotalMinor:        total,
		Currency:          currency,
		Phone:             strings.TrimSpace(input.Phone),
		Address:           strings.TrimSpace(input.Address),
		CustomerComment:   safe(input.Comment),
		Locale:            localeOrDefault(input.Locale),
		Version:           1,
		CreatedAt:         createdAt,
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

func (s *Store) AdminOrders(ctx context.Context, sess core.Session) ([]core.Order, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `SELECT id FROM orders ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return s.ordersFromIDRows(ctx, rows, true)
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
	err := s.pool.QueryRow(ctx, `
		SELECT id, public_number, client_user_id, fulfillment_status, payment_method, payment_status,
			subtotal_minor, delivery_fee_minor, total_minor, currency, phone_ciphertext, address_ciphertext,
			customer_comment, locale, version, created_at, ready_at, delivered_at, cancelled_at
		FROM orders WHERE id=$1
	`, orderID).Scan(
		&order.ID, &order.PublicNumber, &order.ClientUserID, &order.FulfillmentStatus, &order.PaymentMethod,
		&order.PaymentStatus, &order.SubtotalMinor, &order.DeliveryFeeMinor, &order.TotalMinor, &order.Currency,
		&phoneCipher, &addressCipher, &order.CustomerComment, &order.Locale, &order.Version, &order.CreatedAt,
		&ready, &delivered, &cancelled,
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
	_, err := tx.Exec(ctx, `
		INSERT INTO idempotency_keys (actor_user_id, operation, key, request_hash, expires_at)
		VALUES ($1, $2, $3, $4, now() + interval '24 hours')
	`, userID, operation, key, requestHash)
	if err == nil {
		return uuid.Nil, false, nil
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return uuid.Nil, false, err
	}
	var existingHash string
	var result struct {
		OrderID uuid.UUID `json:"order_id"`
	}
	var raw []byte
	err = tx.QueryRow(ctx, `
		SELECT request_hash, COALESCE(result_json, '{}'::jsonb)
		FROM idempotency_keys
		WHERE actor_user_id=$1 AND operation=$2 AND key=$3
		FOR UPDATE
	`, userID, operation, key).Scan(&existingHash, &raw)
	if err != nil {
		return uuid.Nil, false, err
	}
	if existingHash != requestHash {
		return uuid.Nil, false, core.ErrIdempotencyConflict
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return uuid.Nil, false, err
	}
	if result.OrderID == uuid.Nil {
		return uuid.Nil, false, core.ErrIdempotencyConflict
	}
	return result.OrderID, true, nil
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
