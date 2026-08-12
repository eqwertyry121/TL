package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	cryptobox "github.com/eqwertyry121/TL/backend/internal/crypto"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Worker struct {
	pool          *pgxpool.Pool
	interval      time.Duration
	dryRun        bool
	clientToken   string
	staffToken    string
	publicBaseURL string
	box           *cryptobox.Box
	httpClient    *http.Client
	logger        *slog.Logger
}

type job struct {
	id            uuid.UUID
	orderID       uuid.UUID
	recipientKind string
	template      string
	attempts      int
}

func New(pool *pgxpool.Pool, box *cryptobox.Box, interval time.Duration, dryRun bool, clientToken, staffToken, publicBaseURL string, logger *slog.Logger) *Worker {
	return &Worker{
		pool:          pool,
		box:           box,
		interval:      interval,
		dryRun:        dryRun,
		clientToken:   strings.TrimSpace(clientToken),
		staffToken:    strings.TrimSpace(staffToken),
		publicBaseURL: strings.TrimRight(strings.TrimSpace(publicBaseURL), "/"),
		httpClient:    &http.Client{Timeout: 8 * time.Second},
		logger:        logger,
	}
}

func (w *Worker) Run(ctx context.Context) {
	if w.interval <= 0 {
		w.interval = 5 * time.Second
	}
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()
	for {
		if err := w.ProcessOnce(ctx); err != nil {
			w.logger.Warn("notification worker error", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) ProcessOnce(ctx context.Context) error {
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

func (w *Worker) processTelegram(ctx context.Context) error {
	jobs, err := w.claimJobs(ctx)
	if err != nil {
		return err
	}

	for _, current := range jobs {
		if err := w.processJob(ctx, current); err != nil {
			w.logger.Warn("telegram notification failed", "job_id", current.id, "recipient_kind", current.recipientKind, "template", current.template, "error", redactedError(err))
		}
	}
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
		RETURNING j.id, j.order_id, j.recipient_kind, j.template, j.attempts
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := []job{}
	for rows.Next() {
		var current job
		if err := rows.Scan(&current.id, &current.orderID, &current.recipientKind, &current.template, &current.attempts); err != nil {
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
	token, chatID, text, err := w.buildMessage(ctx, current)
	if err != nil {
		w.markFailed(ctx, current, err)
		return err
	}
	if err := w.sendMessage(ctx, token, chatID, text); err != nil {
		w.markFailed(ctx, current, err)
		return err
	}
	_, err = w.pool.Exec(ctx, `
		UPDATE notification_jobs
		SET status='sent', last_error_code='', updated_at=now()
		WHERE id=$1 AND status='processing'
	`, current.id)
	return err
}

func (w *Worker) buildMessage(ctx context.Context, current job) (string, int64, string, error) {
	switch current.recipientKind {
	case "client":
		if w.clientToken == "" {
			return "", 0, "", fmt.Errorf("missing_client_bot_token")
		}
		chatID, number, err := w.clientOrderTarget(ctx, current.orderID)
		if err != nil {
			return "", 0, "", err
		}
		return w.clientToken, chatID, clientText(number, current.template), nil
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
		text, err := w.kitchenText(ctx, current.orderID)
		if err != nil {
			return "", 0, "", err
		}
		return w.staffToken, chatID, text, nil
	case "admin":
		if w.staffToken == "" {
			return "", 0, "", fmt.Errorf("missing_staff_bot_token")
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

func (w *Worker) clientOrderTarget(ctx context.Context, orderID uuid.UUID) (int64, int, error) {
	var chatID int64
	var publicNumber int
	err := w.pool.QueryRow(ctx, `
		SELECT u.telegram_user_id, o.public_number
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.id=$1
	`, orderID).Scan(&chatID, &publicNumber)
	return chatID, publicNumber, err
}

func (w *Worker) staffTarget(ctx context.Context, role string) (int64, error) {
	var chatID int64
	err := w.pool.QueryRow(ctx, `
		SELECT telegram_user_id
		FROM staff
		WHERE role=$1 AND active=true
		ORDER BY created_at
		LIMIT 1
	`, role).Scan(&chatID)
	return chatID, err
}

func (w *Worker) kitchenText(ctx context.Context, orderID uuid.UUID) (string, error) {
	var publicNumber, total int
	var paymentMethod, comment string
	err := w.pool.QueryRow(ctx, `
		SELECT public_number, total_minor, payment_method, customer_comment
		FROM orders
		WHERE id=$1
	`, orderID).Scan(&publicNumber, &total, &paymentMethod, &comment)
	if err != nil {
		return "", err
	}
	lines := []string{
		fmt.Sprintf("Новый заказ #%d", publicNumber),
		fmt.Sprintf("Оплата: %s", paymentText(paymentMethod, total)),
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

func (w *Worker) courierText(ctx context.Context, orderID uuid.UUID) (string, error) {
	var publicNumber, total int
	var paymentMethod, phoneCipher, addressCipher string
	err := w.pool.QueryRow(ctx, `
		SELECT public_number, total_minor, payment_method, phone_ciphertext, address_ciphertext
		FROM orders
		WHERE id=$1
	`, orderID).Scan(&publicNumber, &total, &paymentMethod, &phoneCipher, &addressCipher)
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
	payload, err := json.Marshal(map[string]any{
		"chat_id": chatID,
		"text":    text,
	})
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

func clientText(publicNumber int, template string) string {
	if strings.HasPrefix(template, "client_eta_") {
		minutes := strings.TrimPrefix(template, "client_eta_")
		return fmt.Sprintf("Заказ #%d скоро приедет. Курьер ориентировочно будет у вас в течение %s минут.", publicNumber, minutes)
	}
	switch template {
	case "client_order_out_for_delivery":
		return fmt.Sprintf("Заказ #%d передан в доставку.", publicNumber)
	case "client_order_delivered":
		return fmt.Sprintf("Заказ #%d доставлен. Спасибо!", publicNumber)
	default:
		return fmt.Sprintf("Обновление по заказу #%d.", publicNumber)
	}
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
