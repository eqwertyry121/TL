package notifications

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"

	cryptobox "github.com/eqwertyry121/TL/backend/internal/crypto"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errOperationalStaffUnavailable = errors.New("operational_staff_unavailable")

var (
	telegramMentionRegexp  = regexp.MustCompile(`@[A-Za-z0-9_]{5,32}`)
	telegramUsernameRegexp = regexp.MustCompile(`^[A-Za-z0-9_]{5,32}$`)
)

type telegramMessageEntity struct {
	Type   string `json:"type"`
	Offset int    `json:"offset"`
	Length int    `json:"length"`
	URL    string `json:"url"`
}

type Worker struct {
	pool             *pgxpool.Pool
	interval         time.Duration
	dryRun           bool
	concurrency      int
	backlogAfter     time.Duration
	lastBacklogWarn  time.Time
	clientToken      string
	staffToken       string
	publicBaseURL    string
	box              *cryptobox.Box
	httpClient       *http.Client
	logger           *slog.Logger
	ownerTelegramIDs []int64
	piiRetentionDays int
	claimJobsFunc    func(context.Context) ([]job, error)
	processJobFunc   func(context.Context, job) error
}

type job struct {
	id            uuid.UUID
	orderID       uuid.UUID
	reservationID uuid.UUID
	recipientKind string
	template      string
	eventKey      string
	attempts      int
}

func New(pool *pgxpool.Pool, box *cryptobox.Box, interval time.Duration, dryRun bool, concurrency int, backlogAfter time.Duration, clientToken, staffToken, publicBaseURL string, logger *slog.Logger, ownerTelegramIDs []int64, piiRetentionDays int) *Worker {
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > 4 {
		concurrency = 4
	}
	if piiRetentionDays < 30 {
		piiRetentionDays = 30
	}
	if piiRetentionDays > 3650 {
		piiRetentionDays = 3650
	}
	return &Worker{
		pool:             pool,
		box:              box,
		interval:         interval,
		dryRun:           dryRun,
		concurrency:      concurrency,
		backlogAfter:     backlogAfter,
		clientToken:      strings.TrimSpace(clientToken),
		staffToken:       strings.TrimSpace(staffToken),
		publicBaseURL:    strings.TrimRight(strings.TrimSpace(publicBaseURL), "/"),
		httpClient:       newTelegramHTTPClient(),
		logger:           logger,
		ownerTelegramIDs: append([]int64(nil), ownerTelegramIDs...),
		piiRetentionDays: piiRetentionDays,
	}
}

func newTelegramHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 8 * time.Second,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   3 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			MaxIdleConns:          16,
			MaxIdleConnsPerHost:   4,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 5 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}
}

func (w *Worker) Run(ctx context.Context) {
	if w.interval <= 0 {
		w.interval = 5 * time.Second
	}
	jobTicker := time.NewTicker(w.interval)
	defer jobTicker.Stop()
	maintenanceTicker := time.NewTicker(time.Minute)
	defer maintenanceTicker.Stop()
	cleanupTicker := time.NewTicker(24 * time.Hour)
	defer cleanupTicker.Stop()
	if err := w.cleanupExpired(ctx); err != nil {
		w.logger.Warn("cleanup failed", "error", err)
	}
	if err := w.ProcessOnce(ctx); err != nil {
		w.logger.Warn("notification worker error", "error", err)
	}
	if err := w.warnIfBacklogIsStale(ctx); err != nil {
		w.logger.Warn("notification backlog check failed", "error", err)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-jobTicker.C:
			if err := w.processPending(ctx); err != nil {
				w.logger.Warn("notification worker error", "error", err)
			}
		case <-maintenanceTicker.C:
			if err := w.enqueueReservationReminders(ctx); err != nil {
				w.logger.Warn("reservation reminder enqueue failed", "error", err)
			}
			if err := w.warnIfBacklogIsStale(ctx); err != nil {
				w.logger.Warn("notification backlog check failed", "error", err)
			}
		case <-cleanupTicker.C:
			if err := w.cleanupExpired(ctx); err != nil {
				w.logger.Warn("cleanup failed", "error", err)
			}
		}
	}
}

func (w *Worker) ProcessOnce(ctx context.Context) error {
	if err := w.enqueueReservationReminders(ctx); err != nil {
		return err
	}
	return w.processPending(ctx)
}

func (w *Worker) processPending(ctx context.Context) error {
	if !w.dryRun {
		return w.processTelegram(ctx)
	}
	_, err := w.pool.Exec(ctx, `
		UPDATE notification_jobs
		SET status='sent', attempts=attempts+1, updated_at=now()
		WHERE id IN (
			SELECT id FROM notification_jobs
			WHERE (status='pending' AND next_attempt_at <= now())
				OR (status='processing' AND updated_at < now() - interval '5 minutes')
			ORDER BY created_at
			LIMIT 20
			FOR UPDATE SKIP LOCKED
		)
	`)
	return err
}

func (w *Worker) warnIfBacklogIsStale(ctx context.Context) error {
	if w.backlogAfter <= 0 {
		return nil
	}
	var pendingCount int
	var oldestDue sql.NullTime
	if err := w.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int, MIN(created_at)
		FROM notification_jobs
		WHERE status='pending' AND next_attempt_at <= now()
	`).Scan(&pendingCount, &oldestDue); err != nil {
		return err
	}
	if pendingCount == 0 || !oldestDue.Valid {
		return nil
	}
	now := time.Now().UTC()
	oldestAge := now.Sub(oldestDue.Time)
	if oldestAge < w.backlogAfter {
		return nil
	}
	if !w.lastBacklogWarn.IsZero() && now.Sub(w.lastBacklogWarn) < w.backlogAfter {
		return nil
	}
	w.lastBacklogWarn = now
	w.logger.Warn(
		"notification backlog stale",
		"pending_count", pendingCount,
		"oldest_age_seconds", int(oldestAge.Seconds()),
	)
	return nil
}

func (w *Worker) processTelegram(ctx context.Context) error {
	claimJobs := w.claimJobs
	if w.claimJobsFunc != nil {
		claimJobs = w.claimJobsFunc
	}
	processJob := w.processJob
	if w.processJobFunc != nil {
		processJob = w.processJobFunc
	}
	jobs, err := claimJobs(ctx)
	if err != nil {
		return err
	}

	concurrency := w.concurrency
	if concurrency < 1 {
		concurrency = 1
	}
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for _, current := range jobs {
		select {
		case <-ctx.Done():
			wg.Wait()
			return ctx.Err()
		case sem <- struct{}{}:
		}
		wg.Add(1)
		go func(current job) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := processJob(ctx, current); err != nil {
				w.logger.Warn("telegram notification failed", "job_id", current.id, "recipient_kind", current.recipientKind, "template", current.template, "error", redactedError(err))
			}
		}(current)
	}
	wg.Wait()
	return nil
}

func (w *Worker) claimJobs(ctx context.Context) ([]job, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	rows, err := tx.Query(ctx, `
		WITH candidates AS (
			SELECT id
			FROM notification_jobs
			WHERE (status='pending' AND next_attempt_at <= now())
				OR (status='processing' AND updated_at < now() - interval '5 minutes')
			ORDER BY created_at
			LIMIT 20
			FOR UPDATE SKIP LOCKED
		)
		UPDATE notification_jobs j
		SET status='processing', attempts=attempts+1, last_error_code='', updated_at=now()
		FROM candidates
		WHERE j.id=candidates.id
		RETURNING j.id,
			COALESCE(j.order_id, '00000000-0000-0000-0000-000000000000'::uuid),
			COALESCE(j.reservation_id, '00000000-0000-0000-0000-000000000000'::uuid),
			j.recipient_kind, j.template, j.event_key, j.attempts
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := []job{}
	for rows.Next() {
		var current job
		if err := rows.Scan(&current.id, &current.orderID, &current.reservationID, &current.recipientKind, &current.template, &current.eventKey, &current.attempts); err != nil {
			return nil, err
		}
		jobs = append(jobs, current)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return jobs, nil
}

func (w *Worker) processJob(ctx context.Context, current job) error {
	// Ordinary order operations stay inside the Mini App. The explicit owner
	// delivery alert is the only order event allowed into an admin private chat.
	if current.reservationID == uuid.Nil && current.recipientKind == "admin" &&
		!strings.HasPrefix(current.template, "owner_delivery_alert_") {
		return w.markSent(ctx, current.id)
	}
	token, chatID, text, err := w.buildMessage(ctx, current)
	if err != nil {
		if errors.Is(err, errOperationalStaffUnavailable) {
			return w.markSent(ctx, current.id)
		}
		w.markFailed(ctx, current, err)
		return err
	}
	if err := w.sendMessage(ctx, token, chatID, text); err != nil {
		w.markFailed(ctx, current, err)
		return err
	}
	return w.markSent(ctx, current.id)
}

func (w *Worker) markSent(ctx context.Context, id uuid.UUID) error {
	_, err := w.pool.Exec(ctx, `
		UPDATE notification_jobs
		SET status='sent', last_error_code='', updated_at=now()
		WHERE id=$1 AND status='processing'
	`, id)
	return err
}

func (w *Worker) buildMessage(ctx context.Context, current job) (string, int64, string, error) {
	if current.reservationID != uuid.Nil {
		return w.reservationMessage(ctx, current)
	}
	switch current.recipientKind {
	case "client":
		if w.clientToken == "" {
			return "", 0, "", fmt.Errorf("missing_client_bot_token")
		}
		chatID, number, locale, err := w.clientOrderTarget(ctx, current.orderID)
		if err != nil {
			return "", 0, "", err
		}
		message := clientText(number, current.template, locale)
		if current.template == "client_kitchen_eta_set" || current.template == "client_kitchen_eta_updated" {
			message, err = w.kitchenETAText(ctx, current.orderID, number, locale, current.eventKey, current.template == "client_kitchen_eta_updated")
			if err != nil {
				return "", 0, "", err
			}
		}
		if current.template == "client_order_ready_for_pickup" {
			message, err = w.pickupReadyText(ctx, current.orderID, number, locale)
			if err != nil {
				return "", 0, "", err
			}
		}
		return w.clientToken, chatID, message, nil
	case "courier":
		if w.staffToken == "" {
			return "", 0, "", fmt.Errorf("missing_staff_bot_token")
		}
		chatID, err := w.staffTarget(ctx, "COURIER")
		if err != nil {
			return "", 0, "", err
		}
		text, err := w.courierText(ctx, current.orderID)
		if err != nil {
			return "", 0, "", err
		}
		return w.staffToken, chatID, text, nil
	case "kitchen":
		if w.staffToken == "" {
			return "", 0, "", fmt.Errorf("missing_staff_bot_token")
		}
		chatID, err := w.staffTarget(ctx, "KITCHEN")
		if err != nil {
			return "", 0, "", err
		}
		text, err := w.kitchenText(ctx, current.orderID, current.template)
		if err != nil {
			return "", 0, "", err
		}
		return w.staffToken, chatID, text, nil
	case "admin":
		if w.staffToken == "" {
			return "", 0, "", fmt.Errorf("missing_staff_bot_token")
		}
		if strings.HasPrefix(current.template, "owner_delivery_alert_") {
			chatID, err := w.ownerReservationTarget(current.eventKey)
			if err != nil {
				return "", 0, "", err
			}
			text, err := w.ownerDeliveryAlertText(ctx, current.orderID, current.template)
			if err != nil {
				return "", 0, "", err
			}
			return w.staffToken, chatID, text, nil
		}
		chatID, err := w.staffTarget(ctx, "ADMIN")
		if err != nil {
			return "", 0, "", err
		}
		return w.staffToken, chatID, fmt.Sprintf("Нужно проверить заказ %s", current.orderID), nil
	default:
		return "", 0, "", fmt.Errorf("unknown_recipient_kind")
	}
}

func (w *Worker) kitchenETAText(ctx context.Context, orderID uuid.UUID, number int, locale, eventKey string, updated bool) (string, error) {
	var at time.Time
	version := eventKey[strings.LastIndex(eventKey, ":")+1:]
	var reason string
	err := w.pool.QueryRow(ctx, `
		SELECT reason FROM order_events
		WHERE order_id=$1 AND action IN ('kitchen.estimate_ready', 'kitchen.update_estimated_ready')
			AND reason LIKE $2
		ORDER BY created_at DESC
		LIMIT 1
	`, orderID, "version="+version+";at=%").Scan(&reason)
	if err == nil {
		value := strings.TrimPrefix(reason, "version="+version+";at=")
		at, err = time.Parse(time.RFC3339, value)
	}
	if err != nil {
		// Compatibility fallback for jobs created before ETA revisions were
		// embedded into the immutable order event.
		if queryErr := w.pool.QueryRow(ctx, `SELECT estimated_ready_at FROM orders WHERE id=$1 AND estimated_ready_at IS NOT NULL`, orderID).Scan(&at); queryErr != nil {
			return "", queryErr
		}
	}
	loc, err := time.LoadLocation("Europe/Belgrade")
	if err != nil {
		return "", err
	}
	clock := at.In(loc).Format("15:04")
	locale = normalizeLocale(locale)
	if updated {
		switch locale {
		case "sr":
			return fmt.Sprintf("Novo okvirno vreme pripreme porudžbine #%d je %s.", number, clock), nil
		case "en":
			return fmt.Sprintf("The new estimated preparation time for order #%d is %s.", number, clock), nil
		default:
			return fmt.Sprintf("Новое ориентировочное время готовности заказа #%d — %s.", number, clock), nil
		}
	}
	switch locale {
	case "sr":
		return fmt.Sprintf("Porudžbina #%d biće spremna i predata kuriru okvirno do %s.", number, clock), nil
	case "en":
		return fmt.Sprintf("Order #%d should be ready and handed to the courier at approximately %s.", number, clock), nil
	default:
		return fmt.Sprintf("Заказ #%d будет готов и передан курьеру ориентировочно к %s.", number, clock), nil
	}
}

func (w *Worker) enqueueReservationReminders(ctx context.Context) error {
	_, err := w.pool.Exec(ctx, `
		INSERT INTO notification_jobs (reservation_id, recipient_kind, template, event_key)
		SELECT r.id, 'client', 'reservation_reminder', 'reservation:' || r.id::text || ':reminder'
		FROM reservations r
		WHERE r.status='CONFIRMED'
			AND ((r.reservation_date + make_interval(hours => r.start_hour)) AT TIME ZONE 'Europe/Belgrade') > now()
			AND ((r.reservation_date + make_interval(hours => r.start_hour)) AT TIME ZONE 'Europe/Belgrade') <= now() + interval '1 hour'
		ON CONFLICT (event_key, recipient_kind) DO NOTHING
	`)
	return err
}

func (w *Worker) reservationMessage(ctx context.Context, current job) (string, int64, string, error) {
	var clientChatID int64
	var startHour, endHour, guests int
	var date, username, firstName, tableLabel, locale string
	err := w.pool.QueryRow(ctx, `
		SELECT u.telegram_user_id, to_char(r.reservation_date, 'DD.MM.YYYY'),
			r.start_hour, r.end_hour, r.guests, r.client_username, r.client_first_name, t.label, r.locale
		FROM reservations r
		JOIN users u ON u.id=r.client_user_id
		JOIN restaurant_tables t ON t.id=r.table_id
		WHERE r.id=$1
	`, current.reservationID).Scan(
		&clientChatID, &date, &startHour, &endHour, &guests,
		&username, &firstName, &tableLabel, &locale,
	)
	if err != nil {
		return "", 0, "", err
	}
	if current.recipientKind == "client" {
		if w.clientToken == "" {
			return "", 0, "", fmt.Errorf("missing_client_bot_token")
		}
		var text string
		switch current.template {
		case "reservation_cancelled_by_admin":
			text = localizedReservationText(locale,
				fmt.Sprintf("Бронь на %s в %02d:00 отменена рестораном.", date, startHour),
				fmt.Sprintf("Rezervacija za %s u %02d:00 je otkazana od strane restorana.", date, startHour),
				fmt.Sprintf("Your reservation for %s at %02d:00 was cancelled by the restaurant.", date, startHour))
		case "reservation_reminder":
			text = localizedReservationText(locale,
				fmt.Sprintf("Напоминаем: ждём вас сегодня в %02d:00. Бронь на %d гостей.", startHour, guests),
				fmt.Sprintf("Podsetnik: očekujemo vas danas u %02d:00. Rezervacija za %d gostiju.", startHour, guests),
				fmt.Sprintf("Reminder: we expect you today at %02d:00. Reservation for %d guests.", startHour, guests))
		default:
			text = localizedReservationText(locale,
				fmt.Sprintf("Стол забронирован на %s с %02d:00 до %02d:00. Гостей: %d. До встречи!", date, startHour, endHour, guests),
				fmt.Sprintf("Sto je rezervisan za %s od %02d:00 do %02d:00. Gostiju: %d. Vidimo se!", date, startHour, endHour, guests),
				fmt.Sprintf("Your table is booked for %s from %02d:00 to %02d:00. Guests: %d. See you!", date, startHour, endHour, guests))
		}
		return w.clientToken, clientChatID, text, nil
	}
	if w.staffToken == "" {
		return "", 0, "", fmt.Errorf("missing_staff_bot_token")
	}
	adminChatID := int64(0)
	if current.recipientKind == "admin" {
		adminChatID, err = w.ownerReservationTarget(current.eventKey)
		if errors.Is(err, errLegacyOwnerTarget) {
			// Backward compatibility for jobs created before per-owner delivery.
			adminChatID, err = w.staffTarget(ctx, "ADMIN")
		}
	} else {
		err = fmt.Errorf("unknown_reservation_recipient")
	}
	if err != nil {
		return "", 0, "", err
	}
	clientLabel := strings.TrimSpace(firstName)
	if strings.TrimSpace(username) != "" {
		clientLabel = "@" + strings.TrimPrefix(strings.TrimSpace(username), "@")
	}
	if clientLabel == "" {
		clientLabel = fmt.Sprintf("Telegram %d", clientChatID)
	}
	text := ownerReservationText(current.template, tableLabel, date, startHour, guests, clientLabel)
	return w.staffToken, adminChatID, text, nil
}

func ownerReservationText(template, tableLabel, date string, startHour, guests int, clientLabel string) string {
	if template == "reservation_cancelled_by_client" {
		return fmt.Sprintf("Бронь отменена клиентом\n%s · %s · %02d:00\nГостей: %d\nКлиент: %s", tableLabel, date, startHour, guests, clientLabel)
	}
	return fmt.Sprintf("%s забронирован на %02d:00\nДата: %s\nГостей: %d\nКлиент: %s", tableLabel, startHour, date, guests, clientLabel)
}

var errLegacyOwnerTarget = errors.New("legacy_owner_target")

func (w *Worker) ownerReservationTarget(eventKey string) (int64, error) {
	const marker = ":owner:"
	markerIndex := strings.LastIndex(eventKey, marker)
	if markerIndex < 0 {
		return 0, errLegacyOwnerTarget
	}
	telegramID, err := strconv.ParseInt(eventKey[markerIndex+len(marker):], 10, 64)
	if err != nil || telegramID <= 0 {
		return 0, fmt.Errorf("invalid_reservation_owner")
	}
	for _, allowed := range w.ownerTelegramIDs {
		if telegramID == allowed {
			return telegramID, nil
		}
	}
	return 0, errOperationalStaffUnavailable
}

func localizedReservationText(locale, ru, sr, en string) string {
	switch normalizeLocale(locale) {
	case "sr":
		return sr
	case "en":
		return en
	default:
		return ru
	}
}

func (w *Worker) clientOrderTarget(ctx context.Context, orderID uuid.UUID) (int64, int, string, error) {
	var chatID int64
	var publicNumber int
	var locale string
	err := w.pool.QueryRow(ctx, `
		SELECT u.telegram_user_id, o.public_number, o.locale
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=$1
	`, orderID).Scan(&chatID, &publicNumber, &locale)
	return chatID, publicNumber, locale, err
}

func (w *Worker) staffTarget(ctx context.Context, role string) (int64, error) {
	var chatID int64
	if len(w.ownerTelegramIDs) > 0 {
		err := w.pool.QueryRow(ctx, `
			SELECT target.telegram_user_id
			FROM staff target
			WHERE target.role=$1 AND target.active=true
				AND ($1='ADMIN' OR NOT EXISTS (
					SELECT 1
					FROM staff admin_staff
					WHERE admin_staff.telegram_user_id=target.telegram_user_id
						AND admin_staff.role='ADMIN'
						AND admin_staff.active=true
				))
			ORDER BY
				CASE WHEN target.telegram_user_id = ANY($2::bigint[]) THEN 1 ELSE 0 END,
				target.updated_at DESC,
				target.created_at DESC,
				target.telegram_user_id
			LIMIT 1
		`, role, w.ownerTelegramIDs).Scan(&chatID)
		if errors.Is(err, pgx.ErrNoRows) && role != "ADMIN" {
			return 0, errOperationalStaffUnavailable
		}
		return chatID, err
	}
	err := w.pool.QueryRow(ctx, `
		SELECT target.telegram_user_id
		FROM staff target
		WHERE target.role=$1 AND target.active=true
			AND ($1='ADMIN' OR NOT EXISTS (
				SELECT 1
				FROM staff admin_staff
				WHERE admin_staff.telegram_user_id=target.telegram_user_id
					AND admin_staff.role='ADMIN'
					AND admin_staff.active=true
			))
		ORDER BY target.updated_at DESC, target.created_at DESC, target.telegram_user_id
		LIMIT 1
	`, role).Scan(&chatID)
	if errors.Is(err, pgx.ErrNoRows) && role != "ADMIN" {
		return 0, errOperationalStaffUnavailable
	}
	return chatID, err
}

func (w *Worker) kitchenText(ctx context.Context, orderID uuid.UUID, template string) (string, error) {
	var publicNumber, total int
	var paymentMethod, comment, fulfillmentType, pickupTime, username string
	err := w.pool.QueryRow(ctx, `
		SELECT o.public_number, o.total_minor, o.payment_method, o.customer_comment, o.fulfillment_type,
			COALESCE(u.username, ''),
			COALESCE(to_char(pickup_at AT TIME ZONE 'Europe/Belgrade', 'HH24:MI'), '')
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=$1
	`, orderID).Scan(&publicNumber, &total, &paymentMethod, &comment, &fulfillmentType, &username, &pickupTime)
	if err != nil {
		return "", err
	}
	title := fmt.Sprintf("Новый заказ #%d", publicNumber)
	if template == "kitchen_order_addition" {
		title = fmt.Sprintf("Дозаказ к заказу #%d", publicNumber)
	}
	lines := []string{
		title,
		"Тип: " + fulfillmentText(fulfillmentType),
		fmt.Sprintf("Оплата: %s", paymentText(paymentMethod, total)),
	}
	if label := telegramUsernameLabel(username); label != "" {
		lines = append(lines, "Клиент: "+label)
	}
	if fulfillmentType == "pickup" && pickupTime != "" {
		lines = append(lines, "Заберут в: "+pickupTime)
	}
	items, err := w.orderItems(ctx, orderID)
	if err != nil {
		return "", err
	}
	lines = append(lines, items...)
	if strings.TrimSpace(comment) != "" {
		lines = append(lines, "Комментарий: "+strings.TrimSpace(comment))
	}
	return strings.Join(lines, "\n"), nil
}

func (w *Worker) ownerDeliveryAlertText(ctx context.Context, orderID uuid.UUID, template string) (string, error) {
	var publicNumber, total int
	var paymentMethod, fulfillmentType, username string
	err := w.pool.QueryRow(ctx, `
		SELECT o.public_number, o.total_minor, o.payment_method, o.fulfillment_type, COALESCE(u.username, '')
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=$1
	`, orderID).Scan(&publicNumber, &total, &paymentMethod, &fulfillmentType, &username)
	if err != nil {
		return "", err
	}
	if fulfillmentType != "delivery" {
		return "", fmt.Errorf("owner_alert_not_delivery")
	}

	title := "🚨🚨🚨 НОВЫЙ ЗАКАЗ НА ДОСТАВКУ 🚨🚨🚨"
	callToAction := "ОТКРОЙТЕ КУХНЮ — ЗАКАЗ ЖДЁТ"
	if template == "owner_delivery_alert_started" {
		title = "🔥🔥🔥 ЗАКАЗ УЖЕ В ПРОЦЕССЕ 🔥🔥🔥"
		callToAction = "КУХНЯ ГОТОВИТ — БУДЬТЕ ГОТОВЫ К ДОСТАВКЕ"
	}
	items, err := w.orderItems(ctx, orderID)
	if err != nil {
		return "", err
	}
	lines := []string{
		title,
		fmt.Sprintf("ЗАКАЗ #%d", publicNumber),
		fmt.Sprintf("Оплата: %s", paymentText(paymentMethod, total)),
	}
	if label := telegramUsernameLabel(username); label != "" {
		lines = append(lines, "Клиент: "+label)
	}
	lines = append(lines, "Состав:")
	lines = append(lines, items...)
	lines = append(lines, "", callToAction)
	return strings.Join(lines, "\n"), nil
}

func (w *Worker) pickupReadyText(ctx context.Context, orderID uuid.UUID, publicNumber int, locale string) (string, error) {
	var pickupTime, address string
	err := w.pool.QueryRow(ctx, `
		SELECT COALESCE(to_char(pickup_at AT TIME ZONE 'Europe/Belgrade', 'HH24:MI'), ''),
			pickup_address_snapshot
		FROM orders WHERE id=$1 AND fulfillment_type='pickup'
	`, orderID).Scan(&pickupTime, &address)
	if err != nil {
		return "", err
	}
	switch normalizeLocale(locale) {
	case "sr":
		return fmt.Sprintf("Porudžbina #%d je spremna za preuzimanje u %s. Adresa: %s", publicNumber, pickupTime, address), nil
	case "en":
		return fmt.Sprintf("Order #%d is ready for pickup at %s. Address: %s", publicNumber, pickupTime, address), nil
	default:
		return fmt.Sprintf("Заказ #%d готов к самовывозу на %s. Адрес: %s", publicNumber, pickupTime, address), nil
	}
}

func (w *Worker) courierText(ctx context.Context, orderID uuid.UUID) (string, error) {
	var publicNumber, total int
	var paymentMethod, phoneCipher, addressCipher, username string
	err := w.pool.QueryRow(ctx, `
		SELECT o.public_number, o.total_minor, o.payment_method, o.phone_ciphertext, o.address_ciphertext,
			COALESCE(u.username, '')
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=$1 AND o.fulfillment_type='delivery'
	`, orderID).Scan(&publicNumber, &total, &paymentMethod, &phoneCipher, &addressCipher, &username)
	if err != nil {
		return "", err
	}
	phone, err := w.box.Decrypt(phoneCipher)
	if err != nil {
		return "", err
	}
	address, err := w.box.Decrypt(addressCipher)
	if err != nil {
		return "", err
	}
	lines := []string{
		fmt.Sprintf("Заказ #%d готов к доставке", publicNumber),
		"Адрес: " + address,
		"Телефон: " + phone,
		fmt.Sprintf("Оплата: %s", paymentText(paymentMethod, total)),
	}
	if label := telegramUsernameLabel(username); label != "" {
		lines = append(lines, "Клиент: "+label)
	}
	items, err := w.orderItems(ctx, orderID)
	if err != nil {
		return "", err
	}
	lines = append(lines, items...)
	if w.publicBaseURL != "" {
		lines = append(lines, w.publicBaseURL+"/courier/")
	}
	return strings.Join(lines, "\n"), nil
}

func (w *Worker) orderItems(ctx context.Context, orderID uuid.UUID) ([]string, error) {
	rows, err := w.pool.Query(ctx, `
		SELECT quantity, snapshot_title
		FROM order_items
		WHERE order_id=$1
		ORDER BY sort_order
	`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var quantity int
		var title string
		if err := rows.Scan(&quantity, &title); err != nil {
			return nil, err
		}
		items = append(items, fmt.Sprintf("%d × %s", quantity, title))
	}
	return items, rows.Err()
}

func (w *Worker) sendMessage(ctx context.Context, token string, chatID int64, text string) error {
	requestPayload := map[string]any{
		"chat_id": chatID,
		"text":    text,
	}
	if entities := telegramUsernameEntities(text); len(entities) > 0 {
		requestPayload["entities"] = entities
	}
	payload, err := json.Marshal(requestPayload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := w.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("telegram_network_error")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("telegram_http_%d", response.StatusCode)
	}
	return nil
}

func telegramUsernameLabel(value string) string {
	username := strings.TrimLeft(strings.TrimSpace(value), "@")
	if !telegramUsernameRegexp.MatchString(username) {
		return ""
	}
	return "@" + username
}

func telegramUsernameEntities(text string) []telegramMessageEntity {
	matches := telegramMentionRegexp.FindAllStringIndex(text, -1)
	entities := make([]telegramMessageEntity, 0, len(matches))
	for _, match := range matches {
		if match[0] > 0 && telegramUsernameByte(text[match[0]-1]) {
			continue
		}
		if match[1] < len(text) && telegramUsernameByte(text[match[1]]) {
			continue
		}
		mention := text[match[0]:match[1]]
		entities = append(entities, telegramMessageEntity{
			Type:   "text_link",
			Offset: utf16Length(text[:match[0]]),
			Length: utf16Length(mention),
			URL:    "https://t.me/" + mention[1:],
		})
	}
	return entities
}

func telegramUsernameByte(value byte) bool {
	return value == '_' || value >= '0' && value <= '9' || value >= 'A' && value <= 'Z' || value >= 'a' && value <= 'z'
}

func utf16Length(value string) int {
	return len(utf16.Encode([]rune(value)))
}

func (w *Worker) markFailed(ctx context.Context, current job, cause error) {
	nextAttempts := current.attempts
	status := "pending"
	if nextAttempts >= 5 {
		status = "failed"
	}
	nextAttemptAt := time.Now().UTC().Add(time.Duration(nextAttempts) * time.Minute)
	_, _ = w.pool.Exec(ctx, `
		UPDATE notification_jobs
		SET status=$2, next_attempt_at=$3, last_error_code=$4, updated_at=now()
		WHERE id=$1 AND status='processing'
	`, current.id, status, nextAttemptAt, redactedError(cause))
}

func (w *Worker) cleanupExpired(ctx context.Context) error {
	piiRetentionDays := w.piiRetentionDays
	if piiRetentionDays < 30 {
		piiRetentionDays = 30
	}
	if piiRetentionDays > 3650 {
		piiRetentionDays = 3650
	}
	statements := []struct {
		name string
		sql  string
		args []any
	}{
		{
			name: "sessions",
			sql: `
				WITH expired AS (
					SELECT token_hash
					FROM sessions
					WHERE expires_at < now() - interval '7 days'
					LIMIT 500
				)
				DELETE FROM sessions s
				USING expired
				WHERE s.token_hash = expired.token_hash
			`,
		},
		{
			name: "calculation_tokens",
			sql: `
				WITH expired AS (
					SELECT token_hash
					FROM calculation_tokens
					WHERE expires_at < now() - interval '1 day'
					LIMIT 500
				)
				DELETE FROM calculation_tokens t
				USING expired
				WHERE t.token_hash = expired.token_hash
			`,
		},
		{
			name: "idempotency_keys",
			sql: `
				WITH expired AS (
					SELECT id
					FROM idempotency_keys
					WHERE expires_at < now() - interval '1 day'
					LIMIT 500
				)
				DELETE FROM idempotency_keys k
				USING expired
				WHERE k.id = expired.id
			`,
		},
		{
			name: "notification_jobs",
			sql: `
				WITH expired AS (
					SELECT id
					FROM notification_jobs
					WHERE status IN ('sent', 'failed')
						AND updated_at < now() - interval '30 days'
					LIMIT 500
				)
				DELETE FROM notification_jobs j
				USING expired
				WHERE j.id = expired.id
			`,
		},
		{
			name: "client_product_events",
			sql: `
				WITH expired AS (
					SELECT id FROM client_product_events
					WHERE occurred_at < now() - interval '400 days'
					LIMIT 10000
				)
				DELETE FROM client_product_events e
				USING expired
				WHERE e.id = expired.id
			`,
		},
		{
			name: "client_app_visits",
			sql: `
				WITH expired AS (
					SELECT id FROM client_app_visits
					WHERE visited_at < now() - interval '400 days'
					LIMIT 500
				)
				DELETE FROM client_app_visits v
				USING expired
				WHERE v.id = expired.id
			`,
		},
		{
			name: "cash_location_challenges",
			sql: `
				WITH expired AS (
					SELECT c.id
					FROM cash_location_challenges c
					WHERE c.expires_at < now() - interval '7 days'
						AND NOT EXISTS (
							SELECT 1
							FROM orders o
							WHERE o.cash_location_challenge_id = c.id
						)
					LIMIT 500
				)
				DELETE FROM cash_location_challenges c
				USING expired
				WHERE c.id = expired.id
			`,
		},
		{
			name: "order_pii",
			sql: `
				WITH expired AS (
					SELECT id
					FROM orders
					WHERE fulfillment_status IN ('DELIVERED', 'CANCELLED')
						AND updated_at < now() - ($1::int * interval '1 day')
						AND (phone_ciphertext <> '' OR phone_hash <> '' OR address_ciphertext <> '' OR customer_comment <> '')
					LIMIT 200
				)
				UPDATE orders o
				SET phone_ciphertext='',
					phone_hash='',
					address_ciphertext='',
					customer_comment='',
					updated_at=now()
				FROM expired
				WHERE o.id = expired.id
			`,
			args: []any{piiRetentionDays},
		},
		{
			name: "user_pii",
			sql: `
				WITH expired AS (
					SELECT u.id
					FROM users u
					WHERE (u.phone_ciphertext <> '' OR u.phone_hash <> '' OR u.phone_verified_at IS NOT NULL)
						AND NOT EXISTS (
							SELECT 1
							FROM orders o
							WHERE o.client_user_id = u.id
								AND (
									o.fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')
									OR (
										o.fulfillment_status IN ('DELIVERED', 'CANCELLED')
										AND COALESCE(o.delivered_at, o.cancelled_at, o.created_at) >= now() - ($1::int * interval '1 day')
									)
								)
						)
					LIMIT 200
				)
				UPDATE users u
				SET phone_ciphertext='',
					phone_hash='',
					phone_verified_at=NULL,
					updated_at=now()
				FROM expired
				WHERE u.id = expired.id
			`,
			args: []any{piiRetentionDays},
		},
	}
	for _, statement := range statements {
		tag, err := w.pool.Exec(ctx, statement.sql, statement.args...)
		if err != nil {
			return fmt.Errorf("%s: %w", statement.name, err)
		}
		if deleted := tag.RowsAffected(); deleted > 0 {
			w.logger.Info("cleanup deleted expired rows", "table", statement.name, "rows", deleted)
		}
	}
	return nil
}

func clientText(publicNumber int, template string, locale string) string {
	locale = normalizeLocale(locale)
	if strings.HasPrefix(template, "client_eta_") {
		minutes := strings.TrimPrefix(template, "client_eta_")
		switch locale {
		case "sr":
			return fmt.Sprintf("Porudžbina #%d uskoro stiže. Kurir će okvirno biti kod vas za %s minuta.", publicNumber, minutes)
		case "en":
			return fmt.Sprintf("Order #%d is arriving soon. The courier should reach you in about %s minutes.", publicNumber, minutes)
		default:
			return fmt.Sprintf("Заказ #%d скоро приедет. Курьер ориентировочно будет у вас в течение %s минут.", publicNumber, minutes)
		}
	}
	switch template {
	case "client_order_out_for_delivery":
		return localizedOrderText(publicNumber, locale, "Заказ #%d передан в доставку.", "Porudžbina #%d je predata kuriru.", "Order #%d is out for delivery.")
	case "client_order_ready_for_pickup":
		return localizedOrderText(publicNumber, locale, "Заказ #%d готов к самовывозу. Можно забирать.", "Porudžbina #%d je spremna za preuzimanje.", "Order #%d is ready for pickup.")
	case "client_order_delivered":
		return localizedOrderText(publicNumber, locale, "Заказ #%d доставлен. Спасибо!", "Porudžbina #%d je dostavljena. Hvala!", "Order #%d has been delivered. Thank you!")
	case "client_order_pickup_completed":
		return localizedOrderText(publicNumber, locale, "Заказ #%d выдан. Спасибо!", "Porudžbina #%d je preuzeta. Hvala!", "Order #%d has been picked up. Thank you!")
	default:
		return localizedOrderText(publicNumber, locale, "Обновление по заказу #%d.", "Ažuriranje za porudžbinu #%d.", "Update for order #%d.")
	}
}

func localizedOrderText(publicNumber int, locale, ru, sr, en string) string {
	switch normalizeLocale(locale) {
	case "sr":
		return fmt.Sprintf(sr, publicNumber)
	case "en":
		return fmt.Sprintf(en, publicNumber)
	default:
		return fmt.Sprintf(ru, publicNumber)
	}
}

func normalizeLocale(locale string) string {
	switch strings.ToLower(strings.TrimSpace(locale)) {
	case "sr", "sr-latn", "sr_rs", "sr-rs":
		return "sr"
	case "en", "en-us", "en-gb":
		return "en"
	default:
		return "ru"
	}
}

func fulfillmentText(value string) string {
	if value == "pickup" {
		return "самовывоз"
	}
	return "доставка"
}

func paymentText(method string, total int) string {
	if method == "cash" {
		return fmt.Sprintf("наличными %d RSD", total)
	}
	return "оплачен"
}

func redactedError(err error) string {
	value := strings.TrimSpace(err.Error())
	if value == "" {
		return "unknown"
	}
	if strings.Contains(value, "api.telegram.org/bot") {
		return "telegram_request_error"
	}
	if len(value) > 80 {
		return value[:80]
	}
	return value
}
