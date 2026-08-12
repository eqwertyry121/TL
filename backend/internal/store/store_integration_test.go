package store_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	cryptobox "github.com/eqwertyry121/TL/backend/internal/crypto"
	"github.com/eqwertyry121/TL/backend/internal/db"
	"github.com/eqwertyry121/TL/backend/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ownerTelegramID   = int64(1048084234)
	clientTelegramID  = int64(2000000001)
	adminTelegramID   = int64(2000000002)
	courierTelegramID = int64(2000000003)
	secondCourierID   = int64(2000000004)
)

var classicKhinkaliID = uuid.MustParse("22222222-2222-2222-2222-222222222001")

func TestCreateCashOrderRejectsStaleHiddenItemCalculation(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	clientSession := clientSession(t, ctx, st, clientTelegramID)
	if err := st.VerifyTelegramContact(ctx, clientTelegramID, clientTelegramID, "+38160111222"); err != nil {
		t.Fatalf("verify contact: %v", err)
	}

	now := time.Now().UTC()
	calc, err := st.Calculate(ctx, clientSession, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}, now)
	if err != nil {
		t.Fatalf("calculate: %v", err)
	}
	challenge, err := st.CreateCashLocationChallenge(ctx, clientSession, store.CreateCashLocationChallengeInput{
		CalculationToken: calc.Token,
	}, now, true)
	if err != nil {
		t.Fatalf("create location challenge: %v", err)
	}
	if _, err := st.ArchiveMenuItem(ctx, adminSession, classicKhinkaliID, "integration test"); err != nil {
		t.Fatalf("archive menu item: %v", err)
	}

	_, err = st.CreateCashOrder(ctx, clientSession, store.CreateOrderInput{
		CalculationToken:        calc.Token,
		CashLocationChallengeID: challenge.ID.String(),
		Phone:                   "+38160111222",
		Address:                 "Novi Sad test address",
		PaymentMethod:           core.PaymentCash,
		TermsAccepted:           true,
		Locale:                  "ru",
	}, "idem-stale-hidden-item", "request-hash", now)
	if !errors.Is(err, core.ErrItemUnavailable) && !errors.Is(err, core.ErrCalculationExpired) {
		t.Fatalf("expected stale calculation rejection, got %v", err)
	}
}

func TestStaffRoleChangeRevokesOldSessionAndProtectsLastAdmin(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	ownerSession := bootstrapOwnerSession(t, ctx, st)
	ownerAdmin := findStaff(t, ctx, st, ownerSession, ownerTelegramID, core.RoleAdmin)
	if _, err := st.UpdateStaff(ctx, ownerSession, ownerAdmin.ID, store.UpdateStaffInput{
		DisplayLabel: ownerAdmin.DisplayLabel,
		Role:         core.RoleKitchen,
		Active:       true,
	}); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected last admin protection, got %v", err)
	}

	member, err := st.AddStaff(ctx, ownerSession, store.AddStaffInput{
		TelegramUserID: adminTelegramID,
		DisplayLabel:   "Integration Admin",
		Role:           core.RoleAdmin,
		Active:         true,
	})
	if err != nil {
		t.Fatalf("add second admin: %v", err)
	}
	adminUser, err := st.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: adminTelegramID,
		Username:       "integration_admin",
		FirstName:      "Integration Admin",
		LanguageCode:   "ru",
	})
	if err != nil {
		t.Fatalf("upsert second admin user: %v", err)
	}
	adminSession, _, err := st.CreateSession(ctx, adminUser, core.RoleAdmin, time.Hour)
	if err != nil {
		t.Fatalf("create second admin session: %v", err)
	}
	if _, err := st.UpdateStaff(ctx, ownerSession, member.ID, store.UpdateStaffInput{
		DisplayLabel: member.DisplayLabel,
		Role:         core.RoleKitchen,
		Active:       true,
	}); err != nil {
		t.Fatalf("change second admin role: %v", err)
	}
	if _, err := st.SessionByToken(ctx, adminSession.Token); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("expected old admin session to be forbidden, got %v", err)
	}
}

func TestOnlyOneActiveCourierAllowed(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	ownerSession := bootstrapOwnerSession(t, ctx, st)
	ownerCourier := findStaff(t, ctx, st, ownerSession, ownerTelegramID, core.RoleCourier)
	if _, err := st.UpdateStaff(ctx, ownerSession, ownerCourier.ID, store.UpdateStaffInput{
		DisplayLabel: ownerCourier.DisplayLabel,
		Role:         core.RoleCourier,
		Active:       false,
	}); err != nil {
		t.Fatalf("disable bootstrap courier: %v", err)
	}
	if _, err := st.AddStaff(ctx, ownerSession, store.AddStaffInput{
		TelegramUserID: courierTelegramID,
		DisplayLabel:   "First Courier",
		Role:           core.RoleCourier,
		Active:         true,
	}); err != nil {
		t.Fatalf("add first courier: %v", err)
	}
	if _, err := st.AddStaff(ctx, ownerSession, store.AddStaffInput{
		TelegramUserID: secondCourierID,
		DisplayLabel:   "Second Courier",
		Role:           core.RoleCourier,
		Active:         true,
	}); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected active courier conflict, got %v", err)
	}

	inactiveCourier, err := st.AddStaff(ctx, ownerSession, store.AddStaffInput{
		TelegramUserID: secondCourierID,
		DisplayLabel:   "Second Courier",
		Role:           core.RoleCourier,
		Active:         false,
	})
	if err != nil {
		t.Fatalf("add inactive second courier: %v", err)
	}
	if _, err := st.UpdateStaff(ctx, ownerSession, inactiveCourier.ID, store.UpdateStaffInput{
		DisplayLabel: inactiveCourier.DisplayLabel,
		Role:         core.RoleCourier,
		Active:       true,
	}); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected active courier update conflict, got %v", err)
	}
}

func TestAdminDashboardReturnsEmptyNotificationErrorsArray(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	dashboard, err := st.AdminDashboard(ctx, adminSession, time.Now().UTC())
	if err != nil {
		t.Fatalf("admin dashboard: %v", err)
	}
	if dashboard.NotificationErrors == nil {
		t.Fatal("expected non-nil notification errors slice")
	}
	payload, err := json.Marshal(dashboard)
	if err != nil {
		t.Fatalf("marshal dashboard: %v", err)
	}
	if !strings.Contains(string(payload), `"notification_errors":[]`) {
		t.Fatalf("expected notification_errors to encode as [], got %s", payload)
	}
}

func TestAdminOrdersSupportsFiltersAndPagination(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	now := time.Now().UTC()
	firstOrder := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111001", "Novi Sad one", "idem-admin-orders-1", now)
	secondOrder := createVerifiedCashOrder(t, ctx, st, clientTelegramID+1, "+38160111002", "Novi Sad two", "idem-admin-orders-2", now.Add(time.Second))

	page, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Limit: 1, Offset: 0})
	if err != nil {
		t.Fatalf("admin orders first page: %v", err)
	}
	if page.Limit != 1 || page.Offset != 0 || len(page.Orders) != 1 || !page.HasMore {
		t.Fatalf("unexpected first page: limit=%d offset=%d len=%d has_more=%t", page.Limit, page.Offset, len(page.Orders), page.HasMore)
	}
	if page.Orders[0].ID != secondOrder.ID {
		t.Fatalf("expected newest order on first page, got %s want %s", page.Orders[0].ID, secondOrder.ID)
	}
	secondPage, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Limit: 1, Offset: 1})
	if err != nil {
		t.Fatalf("admin orders second page: %v", err)
	}
	if len(secondPage.Orders) != 1 || secondPage.Orders[0].ID != firstOrder.ID || secondPage.HasMore {
		t.Fatalf("unexpected second page: orders=%v has_more=%t", secondPage.Orders, secondPage.HasMore)
	}
	byNumber, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Query: strconv.Itoa(firstOrder.PublicNumber), Limit: 100})
	if err != nil {
		t.Fatalf("admin orders by public number: %v", err)
	}
	if len(byNumber.Orders) != 1 || byNumber.Orders[0].ID != firstOrder.ID {
		t.Fatalf("expected public number filter to return first order, got %+v", byNumber.Orders)
	}
	byUsername, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Query: "client", Limit: 100})
	if err != nil {
		t.Fatalf("admin orders by username: %v", err)
	}
	if len(byUsername.Orders) != 2 {
		t.Fatalf("expected username filter to return both client orders, got %d", len(byUsername.Orders))
	}
	if _, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Status: "PREPARING", Limit: 100}); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected invalid status rejection, got %v", err)
	}
}

func TestResendCourierNotificationRequiresOutForDelivery(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	order := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111003", "Novi Sad courier", "idem-resend-guard", time.Now().UTC())

	if err := st.ResendOrderNotification(ctx, adminSession, order.ID, "client", "integration test"); err != nil {
		t.Fatalf("client resend for NEW order: %v", err)
	}
	if err := st.ResendOrderNotification(ctx, adminSession, order.ID, "courier", "integration test"); !errors.Is(err, core.ErrOrderStatusConflict) {
		t.Fatalf("expected courier resend status conflict for NEW order, got %v", err)
	}
	kitchenSession := adminSession
	kitchenSession.ActiveRole = core.RoleKitchen
	if _, err := st.MarkReady(ctx, kitchenSession, order.ID, "idem-ready-resend-guard", "request-hash-ready"); err != nil {
		t.Fatalf("mark ready: %v", err)
	}
	if err := st.ResendOrderNotification(ctx, adminSession, order.ID, "courier", "integration test"); err != nil {
		t.Fatalf("courier resend for OUT_FOR_DELIVERY order: %v", err)
	}
}

func TestPhoneHashUsesHMACAndMigratesLegacySHA(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	phone := "+38160111999"
	if err := st.VerifyTelegramContact(ctx, clientTelegramID, clientTelegramID, phone); err != nil {
		t.Fatalf("verify contact: %v", err)
	}
	var userID uuid.UUID
	var storedHash string
	if err := pool.QueryRow(ctx, `
		SELECT id, phone_hash
		FROM users
		WHERE telegram_user_id=$1
	`, clientTelegramID).Scan(&userID, &storedHash); err != nil {
		t.Fatalf("read user phone hash: %v", err)
	}
	if !strings.HasPrefix(storedHash, "hmac-sha256:") {
		t.Fatalf("expected HMAC phone hash, got %q", storedHash)
	}
	legacy := legacyPhoneHashForTest(phone)
	if _, err := pool.Exec(ctx, `UPDATE users SET phone_hash=$2 WHERE id=$1`, userID, legacy); err != nil {
		t.Fatalf("set legacy phone hash: %v", err)
	}
	if err := st.MigrateLegacyPhoneHashes(ctx); err != nil {
		t.Fatalf("migrate legacy phone hash: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT phone_hash FROM users WHERE id=$1`, userID).Scan(&storedHash); err != nil {
		t.Fatalf("read migrated phone hash: %v", err)
	}
	if storedHash == legacy || !strings.HasPrefix(storedHash, "hmac-sha256:") {
		t.Fatalf("expected migrated HMAC hash, got %q", storedHash)
	}
}

func TestServerSideTextLimits(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	ownerSession := bootstrapOwnerSession(t, ctx, st)
	if err := st.VerifyTelegramContact(ctx, clientTelegramID, clientTelegramID, strings.Repeat("1", 40)); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected long phone rejection, got %v", err)
	}
	if _, err := st.AddStaff(ctx, ownerSession, store.AddStaffInput{
		TelegramUserID: secondCourierID,
		DisplayLabel:   strings.Repeat("x", 90),
		Role:           core.RoleKitchen,
		Active:         true,
	}); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected long staff label rejection, got %v", err)
	}
	if _, err := st.CreateCategory(ctx, ownerSession, store.UpsertCategoryInput{
		TitleRU: strings.Repeat("x", 90),
		TitleSR: "sr",
		TitleEN: "en",
		Visible: true,
	}); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("expected long category title rejection, got %v", err)
	}
}

func createVerifiedCashOrder(t *testing.T, ctx context.Context, st *store.Store, telegramID int64, phone, address, idempotencyKey string, now time.Time) core.Order {
	t.Helper()
	clientSession := clientSession(t, ctx, st, telegramID)
	if err := st.VerifyTelegramContact(ctx, telegramID, telegramID, phone); err != nil {
		t.Fatalf("verify contact: %v", err)
	}
	calc, err := st.Calculate(ctx, clientSession, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}, now)
	if err != nil {
		t.Fatalf("calculate: %v", err)
	}
	challenge, err := st.CreateCashLocationChallenge(ctx, clientSession, store.CreateCashLocationChallengeInput{
		CalculationToken: calc.Token,
	}, now, true)
	if err != nil {
		t.Fatalf("create location challenge: %v", err)
	}
	order, err := st.CreateCashOrder(ctx, clientSession, store.CreateOrderInput{
		CalculationToken:        calc.Token,
		CashLocationChallengeID: challenge.ID.String(),
		Phone:                   phone,
		Address:                 address,
		PaymentMethod:           core.PaymentCash,
		TermsAccepted:           true,
		Locale:                  "ru",
	}, idempotencyKey, "request-hash-"+idempotencyKey, now)
	if err != nil {
		t.Fatalf("create cash order: %v", err)
	}
	return order
}

func newIntegrationStore(t *testing.T, ctx context.Context) (*store.Store, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TK_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set TK_TEST_POSTGRES_DSN to run store integration tests")
	}
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	if _, err := pool.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`); err != nil {
		pool.Close()
		t.Fatalf("reset schema: %v", err)
	}
	migrationsDir := filepath.Clean(filepath.Join("..", "..", "migrations"))
	if err := db.Migrate(ctx, pool, migrationsDir); err != nil {
		pool.Close()
		t.Fatalf("migrate: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE restaurant_schedule
		SET closed=false, open_time='00:00', order_cutoff_time='23:59', close_time='23:59'
	`); err != nil {
		pool.Close()
		t.Fatalf("open test schedule: %v", err)
	}
	box, err := cryptobox.NewBox(bytes.Repeat([]byte{7}, 32))
	if err != nil {
		pool.Close()
		t.Fatalf("create crypto box: %v", err)
	}
	return store.New(pool, box, bytes.Repeat([]byte{9}, 32)), pool
}

func legacyPhoneHashForTest(phone string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(phone))))
	return hex.EncodeToString(sum[:])
}

func bootstrapOwnerSession(t *testing.T, ctx context.Context, st *store.Store) core.Session {
	t.Helper()
	if err := st.BootstrapOwner(ctx, ownerTelegramID); err != nil {
		t.Fatalf("bootstrap owner: %v", err)
	}
	owner, err := st.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: ownerTelegramID,
		Username:       "owner",
		FirstName:      "Owner",
		LanguageCode:   "ru",
	})
	if err != nil {
		t.Fatalf("upsert owner: %v", err)
	}
	session, _, err := st.CreateSession(ctx, owner, core.RoleAdmin, time.Hour)
	if err != nil {
		t.Fatalf("create owner session: %v", err)
	}
	return session
}

func clientSession(t *testing.T, ctx context.Context, st *store.Store, telegramID int64) core.Session {
	t.Helper()
	user, err := st.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: telegramID,
		Username:       "client",
		FirstName:      "Client",
		LanguageCode:   "ru",
	})
	if err != nil {
		t.Fatalf("upsert client: %v", err)
	}
	session, _, err := st.CreateSession(ctx, user, core.RoleClient, time.Hour)
	if err != nil {
		t.Fatalf("create client session: %v", err)
	}
	return session
}

func findStaff(t *testing.T, ctx context.Context, st *store.Store, sess core.Session, telegramID int64, role core.Role) core.StaffMember {
	t.Helper()
	members, err := st.AdminStaff(ctx, sess)
	if err != nil {
		t.Fatalf("admin staff: %v", err)
	}
	for _, member := range members {
		if member.TelegramUserID == telegramID && member.Role == role {
			return member
		}
	}
	t.Fatalf("staff member not found: telegram_id=%d role=%s", telegramID, role)
	return core.StaffMember{}
}
