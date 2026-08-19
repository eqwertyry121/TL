package notifications

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const integrationDBLockKey = int64(812379421)

func TestNewTelegramHTTPClientHasBoundedTransport(t *testing.T) {
	client := newTelegramHTTPClient()
	if client.Timeout != 8*time.Second {
		t.Fatalf("client timeout = %s, want 8s", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.MaxIdleConns != 16 {
		t.Fatalf("MaxIdleConns = %d, want 16", transport.MaxIdleConns)
	}
	if transport.MaxIdleConnsPerHost != 4 {
		t.Fatalf("MaxIdleConnsPerHost = %d, want 4", transport.MaxIdleConnsPerHost)
	}
	if transport.ResponseHeaderTimeout != 5*time.Second {
		t.Fatalf("ResponseHeaderTimeout = %s, want 5s", transport.ResponseHeaderTimeout)
	}
	if transport.TLSHandshakeTimeout != 5*time.Second {
		t.Fatalf("TLSHandshakeTimeout = %s, want 5s", transport.TLSHandshakeTimeout)
	}
}

func TestProcessTelegramUsesBoundedConcurrencyAndContinuesPastBlockedJob(t *testing.T) {
	firstJobID := uuid.New()
	jobs := []job{
		{id: firstJobID, orderID: uuid.New(), recipientKind: "client", template: "first"},
		{id: uuid.New(), orderID: uuid.New(), recipientKind: "client", template: "second"},
		{id: uuid.New(), orderID: uuid.New(), recipientKind: "client", template: "failing"},
		{id: uuid.New(), orderID: uuid.New(), recipientKind: "client", template: "fourth"},
	}
	firstStarted := make(chan struct{})
	anotherStartedWhileFirstBlocked := make(chan struct{})
	releaseFirst := make(chan struct{})
	done := make(chan error, 1)
	var firstOnce sync.Once
	var anotherOnce sync.Once
	var active atomic.Int64
	var maxActive atomic.Int64
	var processed atomic.Int64

	worker := &Worker{
		concurrency: 2,
		logger:      slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	worker.claimJobsFunc = func(context.Context) ([]job, error) {
		return jobs, nil
	}
	worker.processJobFunc = func(_ context.Context, current job) error {
		currentActive := active.Add(1)
		updateMaxActive(&maxActive, currentActive)
		defer active.Add(-1)
		processed.Add(1)
		if current.id == firstJobID {
			firstOnce.Do(func() { close(firstStarted) })
			<-releaseFirst
			return nil
		}
		anotherOnce.Do(func() { close(anotherStartedWhileFirstBlocked) })
		if current.template == "failing" {
			return errors.New("telegram_network_error")
		}
		return nil
	}

	go func() {
		done <- worker.processTelegram(context.Background())
	}()

	select {
	case <-firstStarted:
	case <-time.After(time.Second):
		close(releaseFirst)
		t.Fatal("first notification job did not start")
	}
	select {
	case <-anotherStartedWhileFirstBlocked:
	case <-time.After(time.Second):
		close(releaseFirst)
		t.Fatal("blocked notification job prevented the next job from starting")
	}
	close(releaseFirst)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("process telegram: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("process telegram did not finish after releasing blocked job")
	}
	if got := processed.Load(); got != int64(len(jobs)) {
		t.Fatalf("processed jobs = %d, want %d", got, len(jobs))
	}
	if got := maxActive.Load(); got > 2 {
		t.Fatalf("max concurrent jobs = %d, want <= 2", got)
	}
}

func TestProcessTelegramDefaultsZeroConcurrencyToOne(t *testing.T) {
	jobs := []job{
		{id: uuid.New(), orderID: uuid.New(), recipientKind: "client", template: "first"},
		{id: uuid.New(), orderID: uuid.New(), recipientKind: "client", template: "second"},
	}
	var active atomic.Int64
	var maxActive atomic.Int64
	var processed atomic.Int64
	worker := &Worker{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	worker.claimJobsFunc = func(context.Context) ([]job, error) {
		return jobs, nil
	}
	worker.processJobFunc = func(context.Context, job) error {
		currentActive := active.Add(1)
		updateMaxActive(&maxActive, currentActive)
		defer active.Add(-1)
		processed.Add(1)
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := worker.processTelegram(ctx); err != nil {
		t.Fatalf("process telegram: %v", err)
	}
	if got := processed.Load(); got != int64(len(jobs)) {
		t.Fatalf("processed jobs = %d, want %d", got, len(jobs))
	}
	if got := maxActive.Load(); got > 1 {
		t.Fatalf("max concurrent jobs = %d, want <= 1", got)
	}
}

func TestClaimJobsDoesNotDoubleClaimAcrossWorkers(t *testing.T) {
	ctx := context.Background()
	pool := newNotificationsIntegrationPool(t, ctx)
	defer pool.Close()

	orderID := insertNotificationTestOrder(t, ctx, pool)
	const jobCount = 25
	for i := 0; i < jobCount; i++ {
		if _, err := pool.Exec(ctx, `
			INSERT INTO notification_jobs (order_id, recipient_kind, template, event_key, status, next_attempt_at)
			VALUES ($1, 'client', 'client_order_out_for_delivery', $2, 'pending', now() - interval '1 second')
		`, orderID, "claim-partition-"+uuid.NewString()); err != nil {
			t.Fatalf("insert notification job %d: %v", i, err)
		}
	}

	workers := []*Worker{
		{pool: pool, logger: slog.New(slog.NewTextHandler(io.Discard, nil))},
		{pool: pool, logger: slog.New(slog.NewTextHandler(io.Discard, nil))},
	}
	start := make(chan struct{})
	results := make(chan []job, len(workers))
	errs := make(chan error, len(workers))
	for _, worker := range workers {
		go func(worker *Worker) {
			<-start
			claimed, err := worker.claimJobs(ctx)
			if err != nil {
				errs <- err
				return
			}
			results <- claimed
		}(worker)
	}
	close(start)

	seen := map[uuid.UUID]bool{}
	for range workers {
		select {
		case err := <-errs:
			t.Fatalf("claim jobs: %v", err)
		case claimed := <-results:
			for _, current := range claimed {
				if seen[current.id] {
					t.Fatalf("notification job claimed twice: %s", current.id)
				}
				seen[current.id] = true
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for concurrent claim")
		}
	}
	if len(seen) != jobCount {
		t.Fatalf("claimed jobs = %d, want %d", len(seen), jobCount)
	}
	assertNotificationJobStatusCount(t, ctx, pool, "processing", jobCount)
	assertNotificationJobStatusCount(t, ctx, pool, "pending", 0)

	thirdWorker := &Worker{pool: pool, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	claimed, err := thirdWorker.claimJobs(ctx)
	if err != nil {
		t.Fatalf("third claim: %v", err)
	}
	if len(claimed) != 0 {
		t.Fatalf("fresh processing jobs were claimed again: %d", len(claimed))
	}
}

func TestClaimJobsReclaimsOnlyStaleProcessingJobs(t *testing.T) {
	ctx := context.Background()
	pool := newNotificationsIntegrationPool(t, ctx)
	defer pool.Close()

	orderID := insertNotificationTestOrder(t, ctx, pool)
	staleID := uuid.New()
	freshID := uuid.New()
	if _, err := pool.Exec(ctx, `
		INSERT INTO notification_jobs (id, order_id, recipient_kind, template, event_key, status, attempts, next_attempt_at, updated_at)
		VALUES
			($1, $3, 'client', 'client_order_out_for_delivery', $4, 'processing', 1, now() - interval '10 minutes', now() - interval '6 minutes'),
			($2, $3, 'client', 'client_order_out_for_delivery', $5, 'processing', 1, now() - interval '10 minutes', now())
	`, staleID, freshID, orderID, "claim-stale-"+uuid.NewString(), "claim-fresh-"+uuid.NewString()); err != nil {
		t.Fatalf("insert processing notification jobs: %v", err)
	}

	worker := &Worker{pool: pool, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	claimed, err := worker.claimJobs(ctx)
	if err != nil {
		t.Fatalf("claim jobs: %v", err)
	}
	if len(claimed) != 1 || claimed[0].id != staleID {
		t.Fatalf("expected only stale job %s, got %+v", staleID, claimed)
	}
	if claimed[0].attempts != 2 {
		t.Fatalf("stale job attempts = %d, want 2", claimed[0].attempts)
	}
	assertNotificationJobStatusCount(t, ctx, pool, "processing", 2)
}

func TestStaffTargetPrefersRealStaffOverBootstrapOwner(t *testing.T) {
	ctx := context.Background()
	pool := newNotificationsIntegrationPool(t, ctx)
	defer pool.Close()

	ownerTelegramID := int64(1048084234)
	realCourierTelegramID := int64(7000000001)
	ownerUserID := insertNotificationTestUserWithTelegram(t, ctx, pool, ownerTelegramID)
	realCourierUserID := insertNotificationTestUserWithTelegram(t, ctx, pool, realCourierTelegramID)
	if _, err := pool.Exec(ctx, `
		INSERT INTO staff (user_id, telegram_user_id, role, display_label, active)
		VALUES
			($1, $2, 'COURIER', 'Owner Courier', true),
			($3, $4, 'COURIER', 'Real Courier', true)
		ON CONFLICT (telegram_user_id, role)
		DO UPDATE SET user_id=EXCLUDED.user_id, active=true, updated_at=now()
	`, ownerUserID, ownerTelegramID, realCourierUserID, realCourierTelegramID); err != nil {
		t.Fatalf("insert staff: %v", err)
	}

	worker := &Worker{
		pool:             pool,
		ownerTelegramIDs: []int64{ownerTelegramID, 8241921060},
		logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	got, err := worker.staffTarget(ctx, "COURIER")
	if err != nil {
		t.Fatalf("staff target: %v", err)
	}
	if got != realCourierTelegramID {
		t.Fatalf("staff target = %d, want real courier %d", got, realCourierTelegramID)
	}
}

func TestClientTextUsesLocale(t *testing.T) {
	if got := clientText(123, "client_order_ready_for_pickup", "en"); !strings.Contains(got, "ready for pickup") {
		t.Fatalf("English client text = %q", got)
	}
	if got := clientText(123, "client_order_ready_for_pickup", "sr"); !strings.Contains(got, "spremna") {
		t.Fatalf("Serbian client text = %q", got)
	}
	if got := clientText(123, "client_order_ready_for_pickup", "ru"); !strings.Contains(got, "готов") {
		t.Fatalf("Russian client text = %q", got)
	}
}

func TestCleanupExpiredKeepsUnexpiredAndUnfinishedRows(t *testing.T) {
	ctx := context.Background()
	pool := newNotificationsIntegrationPool(t, ctx)
	defer pool.Close()

	userID := insertNotificationTestUser(t, ctx, pool)
	orderID := insertNotificationTestOrderForUser(t, ctx, pool, userID)
	oldReferencedChallengeID := uuid.New()
	oldUnreferencedChallengeID := uuid.New()
	recentChallengeID := uuid.New()
	oldSentJobID := uuid.New()
	oldFailedJobID := uuid.New()
	recentSentJobID := uuid.New()
	oldPendingJobID := uuid.New()
	oldProcessingJobID := uuid.New()
	expiredSession := "cleanup-session-expired-" + uuid.NewString()
	recentSession := "cleanup-session-recent-" + uuid.NewString()
	expiredCalculation := "cleanup-calculation-expired-" + uuid.NewString()
	recentCalculation := "cleanup-calculation-recent-" + uuid.NewString()
	expiredIdempotencyID := uuid.New()
	recentIdempotencyID := uuid.New()
	oldPIIUserID := insertNotificationTestUserWithTelegram(t, ctx, pool, 3000000099)
	oldPIIOrderID := uuid.New()

	if _, err := pool.Exec(ctx, `
		INSERT INTO sessions (token_hash, user_id, telegram_user_id, audience, active_role, expires_at)
		VALUES
			($1, $3, 3000000001, 'client', 'CLIENT', now() - interval '8 days'),
			($2, $3, 3000000001, 'client', 'CLIENT', now() - interval '6 days')
	`, expiredSession, recentSession, userID); err != nil {
		t.Fatalf("insert sessions: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO calculation_tokens (token_hash, user_id, items_json, subtotal_minor, delivery_fee_minor, total_minor, expires_at)
		VALUES
			($1, $3, '[]'::jsonb, 0, 0, 0, now() - interval '2 days'),
			($2, $3, '[]'::jsonb, 0, 0, 0, now() - interval '12 hours')
	`, expiredCalculation, recentCalculation, userID); err != nil {
		t.Fatalf("insert calculation tokens: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO idempotency_keys (id, actor_user_id, operation, key, request_hash, expires_at)
		VALUES
			($1, $3, 'cleanup-expired', $4, 'hash-expired', now() - interval '2 days'),
			($2, $3, 'cleanup-recent', $5, 'hash-recent', now() - interval '12 hours')
	`, expiredIdempotencyID, recentIdempotencyID, userID, "expired-"+uuid.NewString(), "recent-"+uuid.NewString()); err != nil {
		t.Fatalf("insert idempotency keys: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO cash_location_challenges (
			id,
			user_id,
			telegram_user_id,
			calculation_token_hash,
			status,
			expires_at,
			updated_at
		)
		VALUES
			($1, $4, 3000000001, $5, 'EXPIRED', now() - interval '8 days', now() - interval '8 days'),
			($2, $4, 3000000001, $6, 'EXPIRED', now() - interval '8 days', now() - interval '8 days'),
			($3, $4, 3000000001, $7, 'EXPIRED', now() - interval '6 days', now() - interval '6 days')
	`, oldReferencedChallengeID, oldUnreferencedChallengeID, recentChallengeID, userID, "referenced-"+uuid.NewString(), "unreferenced-"+uuid.NewString(), "recent-"+uuid.NewString()); err != nil {
		t.Fatalf("insert cash location challenges: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE orders
		SET cash_location_challenge_id=$2
		WHERE id=$1
	`, orderID, oldReferencedChallengeID); err != nil {
		t.Fatalf("reference cash location challenge from order: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO notification_jobs (id, order_id, recipient_kind, template, event_key, status, updated_at)
		VALUES
			($1, $6, 'client', 'client_order_delivered', $7, 'sent', now() - interval '31 days'),
			($2, $6, 'client', 'client_order_delivered', $8, 'failed', now() - interval '31 days'),
			($3, $6, 'client', 'client_order_delivered', $9, 'sent', now() - interval '29 days'),
			($4, $6, 'client', 'client_order_delivered', $10, 'pending', now() - interval '31 days'),
			($5, $6, 'client', 'client_order_delivered', $11, 'processing', now() - interval '31 days')
	`, oldSentJobID, oldFailedJobID, recentSentJobID, oldPendingJobID, oldProcessingJobID, orderID, "sent-old-"+uuid.NewString(), "failed-old-"+uuid.NewString(), "sent-recent-"+uuid.NewString(), "pending-old-"+uuid.NewString(), "processing-old-"+uuid.NewString()); err != nil {
		t.Fatalf("insert notification jobs: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE users
		SET phone_ciphertext='encrypted-phone',
			phone_hash='hmac-sha256:old',
			phone_verified_at=now() - interval '40 days',
			updated_at=now() - interval '40 days'
		WHERE id=$1
	`, oldPIIUserID); err != nil {
		t.Fatalf("set old user PII: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO orders (
			id,
			client_user_id,
			fulfillment_status,
			payment_method,
			payment_status,
			subtotal_minor,
			delivery_fee_minor,
			total_minor,
			phone_ciphertext,
			phone_hash,
			address_ciphertext,
			customer_comment,
			locale,
			delivered_at,
			updated_at
		)
		VALUES ($1, $2, 'DELIVERED', 'cash', 'PAID', 100, 0, 100, 'encrypted-phone', 'hmac-sha256:old', 'encrypted-address', 'old comment', 'ru', now() - interval '40 days', now() - interval '40 days')
	`, oldPIIOrderID, oldPIIUserID); err != nil {
		t.Fatalf("insert old PII order: %v", err)
	}

	worker := &Worker{
		pool:             pool,
		piiRetentionDays: 30,
		logger:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	if err := worker.cleanupExpired(ctx); err != nil {
		t.Fatalf("cleanup expired: %v", err)
	}

	assertRowExists(t, ctx, pool, "sessions", "token_hash", expiredSession, false)
	assertRowExists(t, ctx, pool, "sessions", "token_hash", recentSession, true)
	assertRowExists(t, ctx, pool, "calculation_tokens", "token_hash", expiredCalculation, false)
	assertRowExists(t, ctx, pool, "calculation_tokens", "token_hash", recentCalculation, true)
	assertRowExists(t, ctx, pool, "idempotency_keys", "id", expiredIdempotencyID.String(), false)
	assertRowExists(t, ctx, pool, "idempotency_keys", "id", recentIdempotencyID.String(), true)
	assertRowExists(t, ctx, pool, "cash_location_challenges", "id", oldReferencedChallengeID.String(), true)
	assertRowExists(t, ctx, pool, "cash_location_challenges", "id", oldUnreferencedChallengeID.String(), false)
	assertRowExists(t, ctx, pool, "cash_location_challenges", "id", recentChallengeID.String(), true)
	assertRowExists(t, ctx, pool, "notification_jobs", "id", oldSentJobID.String(), false)
	assertRowExists(t, ctx, pool, "notification_jobs", "id", oldFailedJobID.String(), false)
	assertRowExists(t, ctx, pool, "notification_jobs", "id", recentSentJobID.String(), true)
	assertRowExists(t, ctx, pool, "notification_jobs", "id", oldPendingJobID.String(), true)
	assertRowExists(t, ctx, pool, "notification_jobs", "id", oldProcessingJobID.String(), true)
	assertOrderPIICleared(t, ctx, pool, oldPIIOrderID)
	assertUserPIICleared(t, ctx, pool, oldPIIUserID)
}

func updateMaxActive(maxActive *atomic.Int64, value int64) {
	for {
		current := maxActive.Load()
		if value <= current || maxActive.CompareAndSwap(current, value) {
			return
		}
	}
}

func newNotificationsIntegrationPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TK_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set TK_TEST_POSTGRES_DSN to run notification integration tests")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	lockIntegrationDatabase(t, ctx, pool)
	if _, err := pool.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`); err != nil {
		pool.Close()
		t.Fatalf("reset schema: %v", err)
	}
	migrationsDir := filepath.Clean(filepath.Join("..", "..", "migrations"))
	if err := db.Migrate(ctx, pool, migrationsDir); err != nil {
		pool.Close()
		t.Fatalf("migrate: %v", err)
	}
	return pool
}

func lockIntegrationDatabase(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx, `SELECT pg_advisory_lock($1)`, integrationDBLockKey); err != nil {
		pool.Close()
		t.Fatalf("lock integration database: %v", err)
	}
}

func insertNotificationTestOrder(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	userID := insertNotificationTestUser(t, ctx, pool)
	return insertNotificationTestOrderForUser(t, ctx, pool, userID)
}

func insertNotificationTestUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	return insertNotificationTestUserWithTelegram(t, ctx, pool, time.Now().UnixNano())
}

func insertNotificationTestUserWithTelegram(t *testing.T, ctx context.Context, pool *pgxpool.Pool, telegramUserID int64) uuid.UUID {
	t.Helper()
	var userID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (telegram_user_id, username, first_name)
		VALUES ($1, 'notification_test', 'Notification Test')
		ON CONFLICT (telegram_user_id)
		DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, updated_at=now()
		RETURNING id
	`, telegramUserID).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return userID
}

func insertNotificationTestOrderForUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) uuid.UUID {
	t.Helper()
	var orderID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO orders (
			client_user_id,
			fulfillment_status,
			payment_method,
			payment_status,
			subtotal_minor,
			delivery_fee_minor,
			total_minor,
			phone_ciphertext,
			address_ciphertext,
			locale
		)
		VALUES ($1, 'NEW', 'cash', 'CASH_PENDING', 100, 0, 100, 'encrypted-phone', 'encrypted-address', 'ru')
		RETURNING id
	`, userID).Scan(&orderID); err != nil {
		t.Fatalf("insert order: %v", err)
	}
	return orderID
}

func assertRowExists(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table, column, value string, want bool) {
	t.Helper()
	allowed := map[string]map[string]bool{
		"sessions":                 {"token_hash": true},
		"calculation_tokens":       {"token_hash": true},
		"idempotency_keys":         {"id": true},
		"cash_location_challenges": {"id": true},
		"notification_jobs":        {"id": true},
	}
	if !allowed[table][column] {
		t.Fatalf("assertRowExists called with unsupported table/column: %s.%s", table, column)
	}
	var got bool
	query := "SELECT EXISTS (SELECT 1 FROM " + table + " WHERE " + column + "::text=$1)"
	if err := pool.QueryRow(ctx, query, value).Scan(&got); err != nil {
		t.Fatalf("check %s.%s=%s exists: %v", table, column, value, err)
	}
	if got != want {
		t.Fatalf("%s.%s=%s exists = %t, want %t", table, column, value, got, want)
	}
}

func assertOrderPIICleared(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID) {
	t.Helper()
	var phoneCiphertext, phoneHash, addressCiphertext, comment string
	if err := pool.QueryRow(ctx, `
		SELECT phone_ciphertext, phone_hash, address_ciphertext, customer_comment
		FROM orders
		WHERE id=$1
	`, orderID).Scan(&phoneCiphertext, &phoneHash, &addressCiphertext, &comment); err != nil {
		t.Fatalf("read cleared order PII: %v", err)
	}
	if phoneCiphertext != "" || phoneHash != "" || addressCiphertext != "" || comment != "" {
		t.Fatalf("order PII was not cleared: phone=%q hash=%q address=%q comment=%q", phoneCiphertext, phoneHash, addressCiphertext, comment)
	}
}

func assertUserPIICleared(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID) {
	t.Helper()
	var phoneCiphertext, phoneHash string
	var verifiedAt *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT phone_ciphertext, phone_hash, phone_verified_at
		FROM users
		WHERE id=$1
	`, userID).Scan(&phoneCiphertext, &phoneHash, &verifiedAt); err != nil {
		t.Fatalf("read cleared user PII: %v", err)
	}
	if phoneCiphertext != "" || phoneHash != "" || verifiedAt != nil {
		t.Fatalf("user PII was not cleared: phone=%q hash=%q verified=%v", phoneCiphertext, phoneHash, verifiedAt)
	}
}

func assertNotificationJobStatusCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, status string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM notification_jobs WHERE status=$1`, status).Scan(&got); err != nil {
		t.Fatalf("count notification jobs with status %s: %v", status, err)
	}
	if got != want {
		t.Fatalf("notification jobs with status %s = %d, want %d", status, got, want)
	}
}
