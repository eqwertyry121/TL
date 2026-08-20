package store_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	cryptobox "github.com/eqwertyry121/TL/backend/internal/crypto"
	"github.com/eqwertyry121/TL/backend/internal/db"
	"github.com/eqwertyry121/TL/backend/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ownerTelegramID   = int64(1048084234)
	clientTelegramID  = int64(2000000001)
	adminTelegramID   = int64(2000000002)
	courierTelegramID = int64(2000000003)
	secondCourierID   = int64(2000000004)
	secondOwnerID     = int64(8241921060)

	integrationDBLockKey = int64(812379421)
)

var classicKhinkaliID = uuid.MustParse("44444444-4444-4444-4444-444444444001")
var khinkaliCategoryID = uuid.MustParse("33333333-3333-3333-3333-333333333001")

var seededMenuItemInputs = []core.CartItemInput{
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444001"), Quantity: 1},
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444002"), Quantity: 1},
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444003"), Quantity: 1},
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444004"), Quantity: 1},
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444005"), Quantity: 1},
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444006"), Quantity: 1},
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444007"), Quantity: 1},
	{ItemID: uuid.MustParse("44444444-4444-4444-4444-444444444008"), Quantity: 1},
}

type queryCounter struct {
	count atomic.Int64
}

func (q *queryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	q.count.Add(1)
	return ctx
}

func (q *queryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func (q *queryCounter) Reset() {
	q.count.Store(0)
}

func (q *queryCounter) Count() int64 {
	return q.count.Load()
}

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

func TestAddOrderItemsAppendsOnceAndProtectsKitchenVersion(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	now := time.Now().UTC()
	clientSession, input := prepareCashOrderForCart(
		t,
		ctx,
		st,
		clientTelegramID,
		"+38160111233",
		"Novi Sad add items",
		[]core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}},
		now,
	)
	order, err := st.CreateCashOrder(ctx, clientSession, input, "idem-add-base-order", "request-hash-add-base-order", now)
	if err != nil {
		t.Fatalf("create cash order: %v", err)
	}

	addCalc, err := st.CalculateAddition(ctx, clientSession, order.ID, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 1}}, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("calculate addition: %v", err)
	}
	if addCalc.DeliveryFeeMinor != 0 || addCalc.TotalMinor != addCalc.SubtotalMinor {
		t.Fatalf("addition calculation charged delivery or wrong total: %+v", addCalc)
	}
	updated, err := st.AddOrderItems(ctx, clientSession, order.ID, store.AddOrderItemsInput{
		CalculationToken: addCalc.Token,
		ExpectedVersion:  order.Version,
	}, "idem-add-items", "request-hash-add-items", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("add order items: %v", err)
	}
	if updated.Version != order.Version+1 {
		t.Fatalf("updated version = %d, want %d", updated.Version, order.Version+1)
	}
	if updated.TotalMinor != order.TotalMinor+addCalc.SubtotalMinor {
		t.Fatalf("updated total = %d, want %d", updated.TotalMinor, order.TotalMinor+addCalc.SubtotalMinor)
	}
	if updated.LatestAddition == nil {
		t.Fatalf("latest addition missing")
	}
	hasAddedItem := false
	for _, item := range updated.Items {
		if item.AdditionID != nil && item.Quantity == 1 && item.MenuItemID == classicKhinkaliID {
			hasAddedItem = true
		}
	}
	if !hasAddedItem {
		t.Fatalf("updated order missing added item marker: %+v", updated.Items)
	}

	if err := st.BootstrapOwner(ctx, ownerTelegramID); err != nil {
		t.Fatalf("bootstrap owner: %v", err)
	}
	kitchenUser, err := st.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: ownerTelegramID,
		Username:       "owner",
		FirstName:      "Owner",
		LanguageCode:   "ru",
	})
	if err != nil {
		t.Fatalf("upsert kitchen owner: %v", err)
	}
	kitchenSession, _, err := st.CreateSession(ctx, kitchenUser, core.RoleKitchen, time.Hour)
	if err != nil {
		t.Fatalf("create kitchen session: %v", err)
	}
	if _, err := st.MarkReady(ctx, kitchenSession, order.ID, "idem-ready-stale-addition", "request-hash-ready-stale-addition", order.Version); !errors.Is(err, core.ErrOrderStatusConflict) {
		t.Fatalf("expected stale ready conflict, got %v", err)
	}

	secondCalc, err := st.CalculateAddition(ctx, clientSession, order.ID, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 1}}, now.Add(2*time.Minute))
	if err == nil {
		_, err = st.AddOrderItems(ctx, clientSession, order.ID, store.AddOrderItemsInput{
			CalculationToken: secondCalc.Token,
			ExpectedVersion:  updated.Version + 1,
		}, "idem-add-items-second", "request-hash-add-items-second", now.Add(2*time.Minute))
	}
	if !errors.Is(err, core.ErrOrderStatusConflict) {
		t.Fatalf("expected second addition/status conflict, got %v", err)
	}
	if _, err := st.MarkReady(ctx, kitchenSession, order.ID, "idem-ready-fresh-addition", "request-hash-ready-fresh-addition", updated.Version); err != nil {
		t.Fatalf("mark ready with fresh version: %v", err)
	}
}

func TestMenuRevisionBumpsOnAdminMenuMutations(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	revision := menuRevision(t, ctx, st)
	category, err := st.CreateCategory(ctx, adminSession, store.UpsertCategoryInput{
		TitleRU:   "Тест",
		TitleSR:   "Test",
		TitleEN:   "Test",
		SortOrder: 90,
		Visible:   true,
	})
	if err != nil {
		t.Fatalf("create category: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "create category")

	category.TitleRU = "Тест 2"
	category.TitleSR = "Test 2"
	category.TitleEN = "Test 2"
	updatedCategory, err := st.UpdateCategory(ctx, adminSession, category.ID, store.UpsertCategoryInput{
		TitleRU:   category.TitleRU,
		TitleSR:   category.TitleSR,
		TitleEN:   category.TitleEN,
		SortOrder: category.SortOrder,
		Visible:   category.Visible,
		Version:   category.Version,
	})
	if err != nil {
		t.Fatalf("update category: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "update category")

	archivedCategory, err := st.ArchiveCategory(ctx, adminSession, updatedCategory.ID, "revision test")
	if err != nil {
		t.Fatalf("archive category: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "archive category")

	restoredCategory, err := st.RestoreCategory(ctx, adminSession, archivedCategory.ID, "revision test")
	if err != nil {
		t.Fatalf("restore category: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "restore category")

	action, err := st.DeleteOrArchiveCategory(ctx, adminSession, restoredCategory.ID, "revision test")
	if err != nil {
		t.Fatalf("delete category: %v", err)
	}
	if action != "deleted" {
		t.Fatalf("expected unused category to be deleted, got %s", action)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "delete category")

	item, err := st.CreateMenuItem(ctx, adminSession, store.UpsertMenuItemInput{
		CategoryID:    khinkaliCategoryID,
		TitleRU:       "Тестовое блюдо",
		TitleSR:       "Test jelo",
		TitleEN:       "Test dish",
		DescriptionRU: "Описание",
		DescriptionSR: "Opis",
		DescriptionEN: "Description",
		PriceMinor:    100,
		MinQuantity:   1,
		SortOrder:     100,
		Visible:       true,
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "create item")

	item.TitleRU = "Тестовое блюдо 2"
	item.TitleSR = "Test jelo 2"
	item.TitleEN = "Test dish 2"
	updatedItem, err := st.UpdateMenuItem(ctx, adminSession, item.ID, store.UpsertMenuItemInput{
		CategoryID:     item.CategoryID,
		TitleRU:        item.TitleRU,
		TitleSR:        item.TitleSR,
		TitleEN:        item.TitleEN,
		DescriptionRU:  item.DescriptionRU,
		DescriptionSR:  item.DescriptionSR,
		DescriptionEN:  item.DescriptionEN,
		PriceMinor:     item.PriceMinor + 1,
		PhotoPath:      item.PhotoPath,
		WeightText:     item.WeightText,
		MinQuantity:    item.MinQuantity,
		AllergenTextRU: item.AllergenTextRU,
		AllergenTextSR: item.AllergenTextSR,
		AllergenTextEN: item.AllergenTextEN,
		SortOrder:      item.SortOrder,
		Visible:        item.Visible,
		Version:        item.Version,
	})
	if err != nil {
		t.Fatalf("update item: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "update item")

	archivedItem, err := st.ArchiveMenuItem(ctx, adminSession, updatedItem.ID, "revision test")
	if err != nil {
		t.Fatalf("archive item: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "archive item")

	restoredItem, err := st.RestoreMenuItem(ctx, adminSession, archivedItem.ID, "revision test")
	if err != nil {
		t.Fatalf("restore item: %v", err)
	}
	revision = requireRevisionIncrease(t, ctx, st, revision, "restore item")

	action, err = st.DeleteOrArchiveMenuItem(ctx, adminSession, restoredItem.ID, "revision test")
	if err != nil {
		t.Fatalf("delete item: %v", err)
	}
	if action != "deleted" {
		t.Fatalf("expected unused item to be deleted, got %s", action)
	}
	requireRevisionIncrease(t, ctx, st, revision, "delete item")
}

func TestScheduleUpdateBumpsRuntimeRevision(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	before, err := st.Settings(ctx)
	if err != nil {
		t.Fatalf("settings before: %v", err)
	}
	schedule, err := st.Schedule(ctx)
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}
	if _, err := st.UpdateSchedule(ctx, adminSession, schedule); err != nil {
		t.Fatalf("update schedule: %v", err)
	}
	after, err := st.Settings(ctx)
	if err != nil {
		t.Fatalf("settings after: %v", err)
	}
	if after.Version <= before.Version {
		t.Fatalf("expected runtime revision to increase after schedule update, before=%d after=%d", before.Version, after.Version)
	}
}

func TestBootstrapOwnerPreservesTelegramProfileAndStaffLabels(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	user, err := st.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: ownerTelegramID,
		Username:       "eqwertyry",
		FirstName:      "Real owner name",
		PhotoURL:       "https://example.test/avatar.jpg",
		LanguageCode:   "sr",
	})
	if err != nil {
		t.Fatalf("seed real Telegram profile: %v", err)
	}
	if err := st.BootstrapOwner(ctx, ownerTelegramID); err != nil {
		t.Fatalf("bootstrap owner first time: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE staff SET display_label='Kitchen owner label'
		WHERE telegram_user_id=$1 AND role='KITCHEN'
	`, ownerTelegramID); err != nil {
		t.Fatalf("customize owner staff label: %v", err)
	}
	if err := st.BootstrapOwner(ctx, ownerTelegramID); err != nil {
		t.Fatalf("bootstrap owner second time: %v", err)
	}

	var username, firstName, photoURL, languageCode, kitchenLabel string
	if err := pool.QueryRow(ctx, `
		SELECT username, first_name, photo_url, language_code
		FROM users WHERE id=$1
	`, user.ID).Scan(&username, &firstName, &photoURL, &languageCode); err != nil {
		t.Fatalf("load owner profile: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		SELECT display_label FROM staff
		WHERE telegram_user_id=$1 AND role='KITCHEN'
	`, ownerTelegramID).Scan(&kitchenLabel); err != nil {
		t.Fatalf("load owner kitchen label: %v", err)
	}
	if username != "eqwertyry" || firstName != "Real owner name" || photoURL != "https://example.test/avatar.jpg" || languageCode != "sr" {
		t.Fatalf("bootstrap owner overwrote Telegram profile: username=%q first_name=%q photo=%q language=%q", username, firstName, photoURL, languageCode)
	}
	if kitchenLabel != "Kitchen owner label" {
		t.Fatalf("bootstrap owner overwrote staff label: %q", kitchenLabel)
	}
}

func TestStaffRoleChangeRevokesOldSessionAndProtectsLastAdmin(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	ownerSession := bootstrapOwnerSession(t, ctx, st)
	seededSecondOwner := findStaff(t, ctx, st, ownerSession, secondOwnerID, core.RoleAdmin)
	if _, err := st.UpdateStaff(ctx, ownerSession, seededSecondOwner.ID, store.UpdateStaffInput{
		DisplayLabel: seededSecondOwner.DisplayLabel,
		Role:         core.RoleAdmin,
		Active:       false,
	}); err != nil {
		t.Fatalf("deactivate seeded second owner admin: %v", err)
	}
	ownerAdmin := findStaff(t, ctx, st, ownerSession, ownerTelegramID, core.RoleAdmin)
	if _, err := st.UpdateStaff(ctx, ownerSession, ownerAdmin.ID, store.UpdateStaffInput{
		DisplayLabel: ownerAdmin.DisplayLabel,
		Role:         core.RoleAdmin,
		Active:       false,
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

func TestCreateSessionRejectsUnassignedStaffRole(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	ownerSession := bootstrapOwnerSession(t, ctx, st)
	if _, err := st.AddStaff(ctx, ownerSession, store.AddStaffInput{
		TelegramUserID: secondCourierID,
		DisplayLabel:   "Kitchen Only",
		Role:           core.RoleKitchen,
		Active:         true,
	}); err != nil {
		t.Fatalf("add kitchen-only staff: %v", err)
	}
	staffUser, err := st.UpsertTelegramUser(ctx, core.User{
		TelegramUserID: secondCourierID,
		Username:       "kitchen_only",
		FirstName:      "Kitchen Only",
		LanguageCode:   "ru",
	})
	if err != nil {
		t.Fatalf("upsert kitchen-only staff user: %v", err)
	}
	session, roles, err := st.CreateSession(ctx, staffUser, core.RoleKitchen, time.Hour)
	if err != nil {
		t.Fatalf("create assigned kitchen session: %v", err)
	}
	if session.ActiveRole != core.RoleKitchen || !roleListContains(roles, core.RoleKitchen) || roleListContains(roles, core.RoleCourier) {
		t.Fatalf("unexpected kitchen-only session/roles: session=%+v roles=%v", session, roles)
	}
	if _, _, err := st.CreateSession(ctx, staffUser, core.RoleCourier, time.Hour); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("expected unassigned courier role to be forbidden, got %v", err)
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

func TestAdminAnalyticsReturnsEmptyArrays(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	now := time.Now().UTC()
	analytics, err := st.AdminAnalytics(ctx, adminSession, now.Add(-24*time.Hour), now, now)
	if err != nil {
		t.Fatalf("admin analytics: %v", err)
	}
	if analytics.Statuses == nil || analytics.Payments == nil || analytics.TopDishes == nil || analytics.DailyRows == nil {
		t.Fatalf("expected non-nil analytics slices: statuses=%v payments=%v top_dishes=%v daily_rows=%v", analytics.Statuses, analytics.Payments, analytics.TopDishes, analytics.DailyRows)
	}
	payload, err := json.Marshal(analytics)
	if err != nil {
		t.Fatalf("marshal analytics: %v", err)
	}
	for _, field := range []string{"statuses", "payments", "top_dishes", "daily_rows"} {
		if !strings.Contains(string(payload), `"`+field+`":[]`) {
			t.Fatalf("expected %s to encode as [], got %s", field, payload)
		}
	}
}

func TestAuditLogIsPaginatedAndBounded(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	for index := 0; index < 105; index++ {
		if _, err := st.CreateCategory(ctx, adminSession, store.UpsertCategoryInput{
			TitleRU:   "Аудит " + strconv.Itoa(index),
			TitleSR:   "Audit " + strconv.Itoa(index),
			TitleEN:   "Audit " + strconv.Itoa(index),
			SortOrder: 1000 + index,
			Visible:   true,
		}); err != nil {
			t.Fatalf("create category for audit %d: %v", index, err)
		}
	}

	firstPage, err := st.AuditLog(ctx, adminSession, store.AuditLogFilter{Limit: 20, Offset: 0})
	if err != nil {
		t.Fatalf("audit first page: %v", err)
	}
	if len(firstPage.Entries) != 20 || firstPage.Limit != 20 || firstPage.Offset != 0 || !firstPage.HasMore {
		t.Fatalf("unexpected audit first page: len=%d limit=%d offset=%d has_more=%t", len(firstPage.Entries), firstPage.Limit, firstPage.Offset, firstPage.HasMore)
	}
	secondPage, err := st.AuditLog(ctx, adminSession, store.AuditLogFilter{Limit: 20, Offset: 20})
	if err != nil {
		t.Fatalf("audit second page: %v", err)
	}
	if len(secondPage.Entries) != 20 || secondPage.Offset != 20 || !secondPage.HasMore {
		t.Fatalf("unexpected audit second page: len=%d offset=%d has_more=%t", len(secondPage.Entries), secondPage.Offset, secondPage.HasMore)
	}
	if firstPage.Entries[0].ID == secondPage.Entries[0].ID {
		t.Fatalf("audit pages overlap at first entry: %s", firstPage.Entries[0].ID)
	}
	cappedPage, err := st.AuditLog(ctx, adminSession, store.AuditLogFilter{Limit: 500, Offset: 0})
	if err != nil {
		t.Fatalf("audit capped page: %v", err)
	}
	if cappedPage.Limit != 100 || len(cappedPage.Entries) != 100 || !cappedPage.HasMore {
		t.Fatalf("expected audit limit cap at 100 with more rows, got len=%d limit=%d has_more=%t", len(cappedPage.Entries), cappedPage.Limit, cappedPage.HasMore)
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

func TestAdminOrdersDateFilterUsesBelgradeLocalDayBounds(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	base := time.Now().UTC()
	beforeDay := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111301", "Novi Sad before local day", "idem-admin-date-before", base)
	startOfDay := createVerifiedCashOrder(t, ctx, st, clientTelegramID+1, "+38160111302", "Novi Sad start local day", "idem-admin-date-start", base.Add(time.Minute))
	endOfDay := createVerifiedCashOrder(t, ctx, st, clientTelegramID+2, "+38160111303", "Novi Sad end local day", "idem-admin-date-end", base.Add(2*time.Minute))
	afterDay := createVerifiedCashOrder(t, ctx, st, clientTelegramID+3, "+38160111304", "Novi Sad after local day", "idem-admin-date-after", base.Add(3*time.Minute))

	setOrderCreatedAt(t, ctx, pool, beforeDay.ID, time.Date(2026, time.March, 28, 22, 59, 59, 0, time.UTC))
	setOrderCreatedAt(t, ctx, pool, startOfDay.ID, time.Date(2026, time.March, 28, 23, 0, 0, 0, time.UTC))
	setOrderCreatedAt(t, ctx, pool, endOfDay.ID, time.Date(2026, time.March, 29, 21, 59, 59, 0, time.UTC))
	setOrderCreatedAt(t, ctx, pool, afterDay.ID, time.Date(2026, time.March, 29, 22, 0, 0, 0, time.UTC))

	page, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Date: "2026-03-29", Limit: 10})
	if err != nil {
		t.Fatalf("admin orders by local date: %v", err)
	}
	gotIDs := make([]uuid.UUID, 0, len(page.Orders))
	for _, order := range page.Orders {
		gotIDs = append(gotIDs, order.ID)
	}
	wantIDs := []uuid.UUID{endOfDay.ID, startOfDay.ID}
	if !uuidSlicesEqual(gotIDs, wantIDs) {
		t.Fatalf("admin orders for Belgrade local date returned %v, want %v", gotIDs, wantIDs)
	}
}

func TestReservationsUseSharedCapacityAndOneActiveBookingPerClient(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC) // Tuesday 10:00 in Belgrade.
	date := "2026-08-19"
	firstClient := clientSession(t, ctx, st, clientTelegramID)
	secondClient := clientSession(t, ctx, st, clientTelegramID+10)
	thirdClient := clientSession(t, ctx, st, clientTelegramID+11)

	first, err := st.CreateReservation(ctx, firstClient, store.CreateReservationInput{
		Date: date, StartHour: 18, Guests: 2, Locale: "ru",
	}, "reservation-first", now)
	if err != nil {
		t.Fatalf("create first reservation: %v", err)
	}
	assertReservationOwnerJobs(t, ctx, pool, first.ID, "reservation_created", fmt.Sprintf("reservation:%s:created", first.ID))
	replayed, err := st.CreateReservation(ctx, firstClient, store.CreateReservationInput{
		Date: date, StartHour: 18, Guests: 2, Locale: "ru",
	}, "reservation-first", now)
	if err != nil || replayed.ID != first.ID {
		t.Fatalf("idempotent replay = (%s, %v), want %s", replayed.ID, err, first.ID)
	}
	_, err = st.CreateReservation(ctx, firstClient, store.CreateReservationInput{
		Date: date, StartHour: 20, Guests: 2, Locale: "ru",
	}, "reservation-second-for-same-client", now)
	if !errors.Is(err, core.ErrActiveReservationExists) {
		t.Fatalf("second active reservation error = %v, want %v", err, core.ErrActiveReservationExists)
	}

	second, err := st.CreateReservation(ctx, secondClient, store.CreateReservationInput{
		Date: date, StartHour: 18, Guests: 2, Locale: "sr",
	}, "reservation-second-table", now)
	if err != nil {
		t.Fatalf("create second table reservation: %v", err)
	}
	if first.TableID == second.TableID {
		t.Fatal("overlapping reservations were assigned to the same table")
	}
	_, err = st.CreateReservation(ctx, thirdClient, store.CreateReservationInput{
		Date: date, StartHour: 18, Guests: 2, Locale: "en",
	}, "reservation-no-capacity", now)
	if !errors.Is(err, core.ErrReservationUnavailable) {
		t.Fatalf("third overlapping reservation error = %v, want %v", err, core.ErrReservationUnavailable)
	}

	availability, err := st.ReservationAvailability(ctx, thirdClient, 2, now)
	if err != nil {
		t.Fatalf("reservation availability: %v", err)
	}
	for _, day := range availability.Days {
		if day.Date != date {
			continue
		}
		for _, hour := range day.Hours {
			if hour == 18 || hour == 19 {
				t.Fatalf("occupied overlapping hour %d was returned as available", hour)
			}
		}
	}

	if _, err := st.CancelReservation(ctx, thirdClient, first.ID, false); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("foreign cancellation error = %v, want %v", err, core.ErrForbidden)
	}
	cancelled, err := st.CancelReservation(ctx, firstClient, first.ID, false)
	if err != nil || cancelled.Status != core.ReservationCancelled {
		t.Fatalf("cancel own reservation = (%s, %v)", cancelled.Status, err)
	}
	assertReservationOwnerJobs(t, ctx, pool, first.ID, "reservation_cancelled_by_client", fmt.Sprintf("reservation:%s:cancelled:CLIENT", first.ID))
	if _, err := st.CreateReservation(ctx, thirdClient, store.CreateReservationInput{
		Date: date, StartHour: 18, Guests: 2, Locale: "en",
	}, "reservation-after-cancel", now); err != nil {
		t.Fatalf("reuse released table: %v", err)
	}
}

func TestAdminCanListAndCancelReservation(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	client := clientSession(t, ctx, st, clientTelegramID)
	admin := bootstrapOwnerSession(t, ctx, st)
	created, err := st.CreateReservation(ctx, client, store.CreateReservationInput{
		Date: "2026-08-20", StartHour: 19, Guests: 5, Locale: "ru",
	}, "reservation-admin-test", now)
	if err != nil {
		t.Fatalf("create reservation: %v", err)
	}

	reservations, err := st.AdminReservations(ctx, admin, now)
	if err != nil || len(reservations) != 1 || reservations[0].ID != created.ID {
		t.Fatalf("admin reservations = (%+v, %v)", reservations, err)
	}
	cancelled, err := st.CancelReservation(ctx, admin, created.ID, true)
	if err != nil || cancelled.Status != core.ReservationCancelled {
		t.Fatalf("admin cancel = (%s, %v)", cancelled.Status, err)
	}
}

func TestAdminOrdersDateFilterUsesCreatedAtIndexOnRealisticDataset(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	clientSession := clientSession(t, ctx, st, clientTelegramID)
	_, err := pool.Exec(ctx, `
		INSERT INTO orders (
			client_user_id, fulfillment_status, payment_method, payment_status,
			subtotal_minor, delivery_fee_minor, total_minor, currency,
			phone_ciphertext, phone_hash, address_ciphertext, customer_comment, locale,
			created_at, updated_at, delivered_at
		)
		SELECT
			$1, 'DELIVERED', 'cash', 'PAID',
			100, 0, 100, 'RSD',
			'encrypted-phone', 'hmac-sha256:explain-test', 'encrypted-address', '', 'ru',
			TIMESTAMPTZ '2026-05-01 00:00:00+00' + (series.index * INTERVAL '1 hour'),
			TIMESTAMPTZ '2026-05-01 00:00:00+00' + (series.index * INTERVAL '1 hour'),
			TIMESTAMPTZ '2026-05-01 00:00:00+00' + (series.index * INTERVAL '1 hour')
		FROM generate_series(0, 3999) AS series(index)
	`, clientSession.UserID)
	if err != nil {
		t.Fatalf("seed realistic orders: %v", err)
	}
	if _, err := pool.Exec(ctx, `ANALYZE orders`); err != nil {
		t.Fatalf("analyze orders: %v", err)
	}

	page, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Date: "2026-07-15", Limit: 20})
	if err != nil {
		t.Fatalf("admin orders by date on realistic dataset: %v", err)
	}
	if len(page.Orders) != 20 || !page.HasMore {
		t.Fatalf("expected bounded first page with more rows, got len=%d has_more=%t", len(page.Orders), page.HasMore)
	}

	from, to := belgradeDayUTCRange(t, "2026-07-15")
	plan := explainPlanJSON(t, ctx, pool, `
		SELECT o.id, o.public_number, COALESCE(u.username, ''), COALESCE(u.first_name, ''),
			COALESCE(u.photo_url, ''),
			o.fulfillment_status, o.payment_method, o.payment_status,
			o.subtotal_minor, o.delivery_fee_minor, o.total_minor, o.currency,
			o.locale, o.version, o.created_at, o.ready_at, o.delivered_at, o.cancelled_at,
			o.cash_location_verified_at, o.cash_location_distance_meters
		FROM orders o
		JOIN users u ON u.id=o.client_user_id
		WHERE o.created_at >= $1 AND o.created_at < $2
		ORDER BY o.created_at DESC
		LIMIT $3 OFFSET $4
	`, from, to, 21, 0)
	if planHasRelationNodeType(plan, "orders", "Seq Scan") {
		t.Fatalf("admin date filter plan used Seq Scan on orders: %s", mustMarshalJSON(t, plan))
	}
	if !planHasIndexName(plan, "idx_orders_created_desc") {
		t.Fatalf("admin date filter plan did not use idx_orders_created_desc: %s", mustMarshalJSON(t, plan))
	}
}

func TestOrderSummaryPagesDoNotDecryptPIIOrLoadDetailData(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	clientListSession := clientSession(t, ctx, st, clientTelegramID)
	order := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111321", "Novi Sad corrupt PII", "idem-summary-no-pii", time.Now().UTC())
	corruptOrderPII(t, ctx, pool, order.ID)

	adminPage, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Limit: 20})
	if err != nil {
		t.Fatalf("admin order summaries should not decrypt PII: %v", err)
	}
	if !orderSummaryPageContains(adminPage.Orders, order.ID) {
		t.Fatalf("admin order summaries did not include order %s: %+v", order.ID, adminPage.Orders)
	}
	clientPage, err := st.ClientOrders(ctx, clientListSession, store.ClientOrderFilter{Limit: 20})
	if err != nil {
		t.Fatalf("client order summaries should not decrypt PII: %v", err)
	}
	if !orderSummaryPageContains(clientPage.Orders, order.ID) {
		t.Fatalf("client order summaries did not include order %s: %+v", order.ID, clientPage.Orders)
	}
	if _, err := st.AdminOrderByID(ctx, adminSession, order.ID); err == nil {
		t.Fatal("admin order detail unexpectedly succeeded with corrupt encrypted PII")
	}
	if _, err := st.ClientOrderByID(ctx, clientListSession, order.ID); err == nil {
		t.Fatal("client order detail unexpectedly succeeded with corrupt encrypted PII")
	}
}

func TestClientOrderAccessIsScopedToSessionUser(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	firstClientSession := clientSession(t, ctx, st, clientTelegramID)
	firstOrder := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111331", "Novi Sad first client", "idem-client-scope-first", time.Now().UTC())
	secondOrder := createVerifiedCashOrder(t, ctx, st, clientTelegramID+1, "+38160111332", "Novi Sad second client", "idem-client-scope-second", time.Now().UTC().Add(time.Second))

	page, err := st.ClientOrders(ctx, firstClientSession, store.ClientOrderFilter{Limit: 20})
	if err != nil {
		t.Fatalf("first client order summaries: %v", err)
	}
	if !orderSummaryPageContains(page.Orders, firstOrder.ID) {
		t.Fatalf("first client summaries did not include own order %s: %+v", firstOrder.ID, page.Orders)
	}
	if orderSummaryPageContains(page.Orders, secondOrder.ID) {
		t.Fatalf("first client summaries leaked second client order %s: %+v", secondOrder.ID, page.Orders)
	}
	bootstrapOrders, err := st.ClientBootstrapOrders(ctx, firstClientSession)
	if err != nil {
		t.Fatalf("first client bootstrap orders: %v", err)
	}
	if !orderSummaryPageContains(bootstrapOrders, firstOrder.ID) || orderSummaryPageContains(bootstrapOrders, secondOrder.ID) {
		t.Fatalf("first client bootstrap order scope is wrong: got %+v own=%s foreign=%s", bootstrapOrders, firstOrder.ID, secondOrder.ID)
	}
	if _, err := st.ClientOrderByID(ctx, firstClientSession, secondOrder.ID); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("expected foreign client order detail to be forbidden, got %v", err)
	}
	if _, err := st.ClientOrderByID(ctx, firstClientSession, firstOrder.ID); err != nil {
		t.Fatalf("own client order detail: %v", err)
	}
}

func TestClientBootstrapOrdersPreferActiveAndFallbackToLatest(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	kitchenSession := adminSession
	kitchenSession.ActiveRole = core.RoleKitchen
	courierSession := adminSession
	courierSession.ActiveRole = core.RoleCourier
	clientListSession := clientSession(t, ctx, st, clientTelegramID)
	now := time.Now().UTC()

	firstOrder := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111401", "Novi Sad bootstrap one", "idem-client-bootstrap-1", now)
	if _, err := st.MarkReady(ctx, kitchenSession, firstOrder.ID, "idem-ready-client-bootstrap-1", "ready-hash-client-bootstrap-1"); err != nil {
		t.Fatalf("mark first ready: %v", err)
	}
	if _, err := st.MarkDelivered(ctx, courierSession, firstOrder.ID, "idem-delivered-client-bootstrap-1", "delivered-hash-client-bootstrap-1"); err != nil {
		t.Fatalf("mark first delivered: %v", err)
	}
	secondOrder := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111402", "Novi Sad bootstrap two", "idem-client-bootstrap-2", now.Add(time.Hour))

	orders, err := st.ClientBootstrapOrders(ctx, clientListSession)
	if err != nil {
		t.Fatalf("client bootstrap orders with active: %v", err)
	}
	if len(orders) != 1 || orders[0].ID != secondOrder.ID || orders[0].FulfillmentStatus != core.StatusNew {
		t.Fatalf("expected active second order only, got %+v", orders)
	}

	if _, err := st.MarkReady(ctx, kitchenSession, secondOrder.ID, "idem-ready-client-bootstrap-2", "ready-hash-client-bootstrap-2"); err != nil {
		t.Fatalf("mark second ready: %v", err)
	}
	if _, err := st.MarkDelivered(ctx, courierSession, secondOrder.ID, "idem-delivered-client-bootstrap-2", "delivered-hash-client-bootstrap-2"); err != nil {
		t.Fatalf("mark second delivered: %v", err)
	}
	orders, err = st.ClientBootstrapOrders(ctx, clientListSession)
	if err != nil {
		t.Fatalf("client bootstrap orders without active: %v", err)
	}
	if len(orders) != 1 || orders[0].ID != secondOrder.ID || orders[0].FulfillmentStatus != core.StatusDelivered {
		t.Fatalf("expected latest delivered second order only, got %+v", orders)
	}
}

func TestMarkReadyPersistsStatusBeforeNotificationDelivery(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	kitchenSession := adminSession
	kitchenSession.ActiveRole = core.RoleKitchen
	order := createVerifiedCashOrder(t, ctx, st, clientTelegramID, "+38160111421", "Novi Sad notification queue", "idem-ready-before-telegram-order", time.Now().UTC())

	readyOrder, err := st.MarkReady(ctx, kitchenSession, order.ID, "idem-ready-before-telegram", "ready-before-telegram-hash")
	if err != nil {
		t.Fatalf("mark ready: %v", err)
	}
	if readyOrder.FulfillmentStatus != core.StatusOutForDelivery {
		t.Fatalf("ready order status = %s, want %s", readyOrder.FulfillmentStatus, core.StatusOutForDelivery)
	}
	assertNotificationJobs(t, ctx, pool, order.ID, map[string]int{
		"kitchen": 1,
		"client":  1,
		"courier": 1,
	})

	replayedOrder, err := st.MarkReady(ctx, kitchenSession, order.ID, "idem-ready-before-telegram", "ready-before-telegram-hash")
	if err != nil {
		t.Fatalf("mark ready replay: %v", err)
	}
	if replayedOrder.ID != order.ID || replayedOrder.FulfillmentStatus != core.StatusOutForDelivery {
		t.Fatalf("unexpected replayed order: id=%s status=%s", replayedOrder.ID, replayedOrder.FulfillmentStatus)
	}
	assertNotificationJobs(t, ctx, pool, order.ID, map[string]int{
		"kitchen": 1,
		"client":  1,
		"courier": 1,
	})
}

func TestPickupOrderStaysOutOfCourierFlow(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	kitchenSession := adminSession
	kitchenSession.ActiveRole = core.RoleKitchen
	courierSession := adminSession
	courierSession.ActiveRole = core.RoleCourier
	clientSession := clientSession(t, ctx, st, clientTelegramID)
	phone := "+38160111422"
	if err := st.VerifyTelegramContact(ctx, clientTelegramID, clientTelegramID, phone); err != nil {
		t.Fatalf("verify contact: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE app_settings
		SET pickup_last_time='23:59'
	`); err != nil {
		t.Fatalf("open pickup slots for test: %v", err)
	}
	now := time.Now().UTC()
	calc, err := st.CalculateForFulfillment(ctx, clientSession, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}, core.FulfillmentPickup, now)
	if err != nil {
		t.Fatalf("calculate pickup: %v", err)
	}
	if calc.FulfillmentType != core.FulfillmentPickup || calc.DeliveryFeeMinor != 0 || calc.TotalMinor != calc.SubtotalMinor {
		t.Fatalf("pickup calculation should be zero-delivery pickup, got %+v", calc)
	}
	challenge, err := st.CreateCashLocationChallenge(ctx, clientSession, store.CreateCashLocationChallengeInput{
		CalculationToken: calc.Token,
	}, now, true)
	if err != nil {
		t.Fatalf("pickup cash order must support location challenge: %v", err)
	}
	slots, err := st.PickupSlots(ctx, clientSession, now)
	if err != nil || len(slots.Slots) == 0 {
		t.Fatalf("pickup slots: %+v, %v", slots, err)
	}

	order, err := st.CreateCashOrder(ctx, clientSession, store.CreateOrderInput{
		CalculationToken:        calc.Token,
		CashLocationChallengeID: challenge.ID.String(),
		Phone:                   phone,
		FulfillmentType:         core.FulfillmentPickup,
		PickupAt:                &slots.Slots[0].PickupAt,
		PaymentMethod:           core.PaymentCash,
		TermsAccepted:           true,
		Locale:                  "ru",
	}, "idem-pickup-order", "request-hash-pickup-order", now)
	if err != nil {
		t.Fatalf("create pickup cash order: %v", err)
	}
	if order.FulfillmentType != core.FulfillmentPickup || order.PickupAt == nil || order.PickupCookAt == nil || order.PickupAddress == "" {
		t.Fatalf("pickup order snapshot mismatch: %+v", order)
	}
	if _, err := st.CreateCashOrder(ctx, clientSession, store.CreateOrderInput{
		CalculationToken:        calc.Token,
		CashLocationChallengeID: challenge.ID.String(),
		Phone:                   phone,
		FulfillmentType:         core.FulfillmentPickup,
		PickupAt:                &slots.Slots[0].PickupAt,
		PaymentMethod:           core.PaymentCash,
		TermsAccepted:           true,
		Locale:                  "ru",
	}, "idem-second-active-pickup", "request-hash-second-active-pickup", now); !errors.Is(err, core.ErrActiveOrderExists) {
		t.Fatalf("second active pickup order should be blocked, got %v", err)
	}
	if want := order.PickupAt.Add(-40 * time.Minute); !order.PickupCookAt.Equal(want) {
		t.Fatalf("pickup cook time = %s, want %s", order.PickupCookAt, want)
	}
	assertNotificationJobs(t, ctx, pool, order.ID, map[string]int{"kitchen": 1})

	ready, err := st.MarkReady(ctx, kitchenSession, order.ID, "idem-pickup-ready", "request-hash-pickup-ready", order.Version)
	if err != nil {
		t.Fatalf("mark pickup ready: %v", err)
	}
	if ready.FulfillmentStatus != core.StatusReadyForPickup || ready.FulfillmentType != core.FulfillmentPickup {
		t.Fatalf("pickup ready order mismatch: %+v", ready)
	}
	assertNotificationJobs(t, ctx, pool, order.ID, map[string]int{
		"kitchen": 1,
		"client":  1,
	})

	courierOrders, err := st.CourierOrders(ctx, courierSession)
	if err != nil {
		t.Fatalf("courier orders: %v", err)
	}
	if len(courierOrders) != 0 {
		t.Fatalf("pickup order leaked to courier queue: %+v", courierOrders)
	}
	if err := st.SendCourierETA(ctx, courierSession, order.ID, 10); !errors.Is(err, core.ErrOrderStatusConflict) {
		t.Fatalf("pickup ETA should be blocked, got %v", err)
	}
	if _, err := st.MarkDelivered(ctx, courierSession, order.ID, "idem-pickup-courier-delivered", "request-hash-pickup-courier-delivered", ready.Version); !errors.Is(err, core.ErrOrderStatusConflict) {
		t.Fatalf("courier delivery should be blocked for pickup, got %v", err)
	}
	if err := st.ResendOrderNotification(ctx, adminSession, order.ID, "courier", "pickup should not notify courier"); !errors.Is(err, core.ErrOrderStatusConflict) {
		t.Fatalf("admin courier resend should be blocked for pickup, got %v", err)
	}

	kitchenOrders, err := st.KitchenOrders(ctx, kitchenSession)
	if err != nil {
		t.Fatalf("kitchen orders: %v", err)
	}
	if len(kitchenOrders) != 1 || kitchenOrders[0].ID != order.ID || kitchenOrders[0].FulfillmentStatus != core.StatusReadyForPickup {
		t.Fatalf("pickup ready order should stay visible for kitchen handoff, got %+v", kitchenOrders)
	}
	delivered, err := st.MarkPickupCollected(ctx, kitchenSession, order.ID, "idem-pickup-collected", "request-hash-pickup-collected", ready.Version)
	if err != nil {
		t.Fatalf("mark pickup collected: %v", err)
	}
	if delivered.FulfillmentStatus != core.StatusDelivered || delivered.PaymentStatus != core.PaymentPaid {
		t.Fatalf("pickup collected order mismatch: %+v", delivered)
	}
	assertNotificationJobs(t, ctx, pool, order.ID, map[string]int{
		"kitchen": 1,
		"client":  2,
	})

	nextCalc, err := st.CalculateForFulfillment(ctx, clientSession, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}, core.FulfillmentPickup, now)
	if err != nil {
		t.Fatalf("calculate pickup after collection: %v", err)
	}
	nextChallenge, err := st.CreateCashLocationChallenge(ctx, clientSession, store.CreateCashLocationChallengeInput{CalculationToken: nextCalc.Token}, now, true)
	if err != nil {
		t.Fatalf("create pickup challenge after collection: %v", err)
	}
	nextSlots, err := st.PickupSlots(ctx, clientSession, now)
	if err != nil || len(nextSlots.Slots) == 0 {
		t.Fatalf("pickup slots after collection: %+v, %v", nextSlots, err)
	}
	if _, err := st.CreateCashOrder(ctx, clientSession, store.CreateOrderInput{
		CalculationToken:        nextCalc.Token,
		CashLocationChallengeID: nextChallenge.ID.String(),
		Phone:                   phone,
		FulfillmentType:         core.FulfillmentPickup,
		PickupAt:                &nextSlots.Slots[0].PickupAt,
		PaymentMethod:           core.PaymentCash,
		TermsAccepted:           true,
		Locale:                  "ru",
	}, "idem-pickup-after-collection", "request-hash-pickup-after-collection", now); err != nil {
		t.Fatalf("pickup order should be allowed after collection: %v", err)
	}
}

func TestOrderItemSnapshotsSurviveMenuEditAndArchive(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	clientSession := clientSession(t, ctx, st, clientTelegramID)
	phone := "+38160111431"
	if err := st.VerifyTelegramContact(ctx, clientTelegramID, clientTelegramID, phone); err != nil {
		t.Fatalf("verify contact: %v", err)
	}

	cart := []core.CartItemInput{
		seededMenuItemInputs[1],
		seededMenuItemInputs[0],
	}
	now := time.Now().UTC()
	calc, err := st.Calculate(ctx, clientSession, cart, now)
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
		Address:                 "Novi Sad snapshot history",
		PaymentMethod:           core.PaymentCash,
		TermsAccepted:           true,
		Locale:                  "ru",
	}, "idem-order-snapshot-history", "request-hash-order-snapshot-history", now)
	if err != nil {
		t.Fatalf("create cash order: %v", err)
	}
	if len(order.Items) != len(cart) {
		t.Fatalf("order item count = %d, want %d", len(order.Items), len(cart))
	}
	for index, cartItem := range cart {
		if order.Items[index].MenuItemID != cartItem.ItemID {
			t.Fatalf("order item %d id = %s, want cart order id %s", index, order.Items[index].MenuItemID, cartItem.ItemID)
		}
	}
	snapshot := append([]core.OrderItem(nil), order.Items...)

	item := adminMenuItemForTest(t, ctx, st, adminSession, cart[0].ItemID)
	updated, err := st.UpdateMenuItem(ctx, adminSession, item.ID, store.UpsertMenuItemInput{
		CategoryID:     item.CategoryID,
		TitleRU:        "Изменённое блюдо для snapshot",
		TitleSR:        "Izmenjeno snapshot jelo",
		TitleEN:        "Changed snapshot dish",
		DescriptionRU:  item.DescriptionRU,
		DescriptionSR:  item.DescriptionSR,
		DescriptionEN:  item.DescriptionEN,
		PriceMinor:     item.PriceMinor + 777,
		PhotoPath:      item.PhotoPath,
		WeightText:     item.WeightText,
		MinQuantity:    item.MinQuantity,
		AllergenTextRU: item.AllergenTextRU,
		AllergenTextSR: item.AllergenTextSR,
		AllergenTextEN: item.AllergenTextEN,
		SortOrder:      item.SortOrder,
		Visible:        item.Visible,
		Version:        item.Version,
	})
	if err != nil {
		t.Fatalf("update menu item: %v", err)
	}
	if updated.TitleRU == snapshot[0].SnapshotTitle || updated.PriceMinor == snapshot[0].UnitPriceMinor {
		t.Fatalf("menu item did not change enough to prove snapshot isolation: updated=%+v snapshot=%+v", updated, snapshot[0])
	}

	action, err := st.DeleteOrArchiveMenuItem(ctx, adminSession, updated.ID, "snapshot history regression")
	if err != nil {
		t.Fatalf("delete/archive used item: %v", err)
	}
	if action != "archived" {
		t.Fatalf("used menu item delete/archive action = %s, want archived", action)
	}

	clientDetail, err := st.ClientOrderByID(ctx, clientSession, order.ID)
	if err != nil {
		t.Fatalf("client order detail after menu mutation: %v", err)
	}
	assertOrderItemsEqual(t, "client detail after menu edit/archive", clientDetail.Items, snapshot)

	adminDetail, err := st.AdminOrderByID(ctx, adminSession, order.ID)
	if err != nil {
		t.Fatalf("admin order detail after menu mutation: %v", err)
	}
	assertOrderItemsEqual(t, "admin detail after menu edit/archive", adminDetail.Items, snapshot)
	if adminDetail.TotalMinor != order.TotalMinor || adminDetail.SubtotalMinor != order.SubtotalMinor {
		t.Fatalf("order totals changed after menu mutation: got subtotal=%d total=%d want subtotal=%d total=%d",
			adminDetail.SubtotalMinor, adminDetail.TotalMinor, order.SubtotalMinor, order.TotalMinor)
	}
}

func TestCalculateQueryCountIsBoundedByCartSize(t *testing.T) {
	ctx := context.Background()
	st, pool, counter := newIntegrationStoreWithQueryCounter(t, ctx)
	defer pool.Close()

	clientSession := clientSession(t, ctx, st, clientTelegramID)
	now := time.Now().UTC()

	counter.Reset()
	if _, err := st.Calculate(ctx, clientSession, seededMenuItemInputs[:1], now); err != nil {
		t.Fatalf("calculate single item: %v", err)
	}
	singleItemQueries := counter.Count()

	counter.Reset()
	if _, err := st.Calculate(ctx, clientSession, seededMenuItemInputs, now); err != nil {
		t.Fatalf("calculate eight items: %v", err)
	}
	eightItemQueries := counter.Count()

	assertQueryBudget(t, "calculate one item", singleItemQueries, 4)
	assertQueryBudget(t, "calculate eight items", eightItemQueries, singleItemQueries)
}

func TestCreateCashOrderQueryCountIsBoundedByCartSize(t *testing.T) {
	ctx := context.Background()
	st, pool, counter := newIntegrationStoreWithQueryCounter(t, ctx)
	defer pool.Close()

	now := time.Now().UTC()
	singleSession, singleInput := prepareCashOrderForCart(
		t,
		ctx,
		st,
		clientTelegramID,
		"+38160111441",
		"Novi Sad create one item",
		seededMenuItemInputs[:1],
		now,
	)
	counter.Reset()
	if _, err := st.CreateCashOrder(ctx, singleSession, singleInput, "idem-create-query-one", "request-hash-create-query-one", now); err != nil {
		t.Fatalf("create one-item cash order: %v", err)
	}
	singleItemQueries := counter.Count()

	multiSession, multiInput := prepareCashOrderForCart(
		t,
		ctx,
		st,
		clientTelegramID+1,
		"+38160111442",
		"Novi Sad create eight items",
		seededMenuItemInputs,
		now.Add(time.Minute),
	)
	counter.Reset()
	multiOrder, err := st.CreateCashOrder(ctx, multiSession, multiInput, "idem-create-query-eight", "request-hash-create-query-eight", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("create eight-item cash order: %v", err)
	}
	eightItemQueries := counter.Count()
	if len(multiOrder.Items) != len(seededMenuItemInputs) {
		t.Fatalf("eight-item order item count = %d, want %d", len(multiOrder.Items), len(seededMenuItemInputs))
	}

	assertQueryBudget(t, "create cash order one item", singleItemQueries, 20)
	assertQueryBudget(t, "create cash order eight items", eightItemQueries, singleItemQueries)
}

func TestCreateCashOrderPersistsTermsVersion(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()

	now := time.Now().UTC()
	session, input := prepareCashOrderForCart(
		t,
		ctx,
		st,
		clientTelegramID,
		"+38160111455",
		"Novi Sad terms version",
		seededMenuItemInputs[:1],
		now,
	)
	input.TermsVersion = "2026-08-19"

	order, err := st.CreateCashOrder(ctx, session, input, "idem-create-terms-version", "request-hash-create-terms-version", now)
	if err != nil {
		t.Fatalf("create cash order: %v", err)
	}
	var termsVersion string
	var acceptedAt time.Time
	if err := pool.QueryRow(ctx, `
		SELECT terms_version, terms_accepted_at
		FROM orders
		WHERE id=$1
	`, order.ID).Scan(&termsVersion, &acceptedAt); err != nil {
		t.Fatalf("read terms acceptance: %v", err)
	}
	if termsVersion != input.TermsVersion {
		t.Fatalf("terms_version = %q, want %q", termsVersion, input.TermsVersion)
	}
	if acceptedAt.IsZero() {
		t.Fatal("terms_accepted_at was not persisted")
	}
}

func TestOrderListQueryCountIsBoundedByOrderCount(t *testing.T) {
	ctx := context.Background()
	st, pool, counter := newIntegrationStoreWithQueryCounter(t, ctx)
	defer pool.Close()

	adminSession := bootstrapOwnerSession(t, ctx, st)
	kitchenSession := adminSession
	kitchenSession.ActiveRole = core.RoleKitchen
	courierSession := adminSession
	courierSession.ActiveRole = core.RoleCourier

	now := time.Now().UTC()
	orderIDs := make([]uuid.UUID, 0, 20)
	for i := 0; i < 20; i++ {
		order := createVerifiedCashOrder(
			t,
			ctx,
			st,
			clientTelegramID+int64(i),
			"+38160112"+strconv.Itoa(100+i),
			"Novi Sad bounded list "+strconv.Itoa(i),
			"idem-query-count-"+strconv.Itoa(i),
			now.Add(time.Duration(i)*time.Second),
		)
		orderIDs = append(orderIDs, order.ID)
	}

	counter.Reset()
	kitchenOrders, err := st.KitchenOrders(ctx, kitchenSession)
	if err != nil {
		t.Fatalf("kitchen orders: %v", err)
	}
	kitchenQueries := counter.Count()
	if len(kitchenOrders) != 20 {
		t.Fatalf("expected 20 kitchen orders, got %d", len(kitchenOrders))
	}
	assertQueryBudget(t, "kitchen orders 20", kitchenQueries, 6)

	for i, orderID := range orderIDs {
		if _, err := st.MarkReady(ctx, kitchenSession, orderID, "idem-ready-query-count-"+strconv.Itoa(i), "ready-hash-"+strconv.Itoa(i)); err != nil {
			t.Fatalf("mark ready %d: %v", i, err)
		}
	}

	counter.Reset()
	courierOrders, err := st.CourierOrders(ctx, courierSession)
	if err != nil {
		t.Fatalf("courier orders: %v", err)
	}
	courierQueries := counter.Count()
	if len(courierOrders) != 20 {
		t.Fatalf("expected 20 courier orders, got %d", len(courierOrders))
	}
	assertQueryBudget(t, "courier orders 20", courierQueries, 6)

	counter.Reset()
	page, err := st.AdminOrders(ctx, adminSession, store.AdminOrderFilter{Limit: 20, Offset: 0})
	if err != nil {
		t.Fatalf("admin orders: %v", err)
	}
	adminQueries := counter.Count()
	if len(page.Orders) != 20 {
		t.Fatalf("expected 20 admin orders, got %d", len(page.Orders))
	}
	if page.Counts.Active != 20 || page.Counts.Ready != 20 {
		t.Fatalf("unexpected admin order counts: %+v", page.Counts)
	}
	assertQueryBudget(t, "admin order summaries 20", adminQueries, 2)
	detail, err := st.AdminOrderByID(ctx, adminSession, page.Orders[0].ID)
	if err != nil {
		t.Fatalf("admin order detail: %v", err)
	}
	if detail.Phone == "" || detail.Address == "" || len(detail.Items) == 0 {
		t.Fatalf("admin order detail did not include PII/items")
	}

	clientListSession := clientSession(t, ctx, st, clientTelegramID)
	if _, err := st.MarkDelivered(ctx, courierSession, orderIDs[0], "idem-delivered-client-page", "delivered-hash-client-page"); err != nil {
		t.Fatalf("mark delivered before client pagination: %v", err)
	}
	createVerifiedCashOrder(
		t,
		ctx,
		st,
		clientTelegramID,
		"+38160112999",
		"Novi Sad client pagination",
		"idem-client-page-extra",
		now.Add(2*time.Hour),
	)
	counter.Reset()
	clientPage, err := st.ClientOrders(ctx, clientListSession, store.ClientOrderFilter{Limit: 1, Offset: 0})
	if err != nil {
		t.Fatalf("client order summaries: %v", err)
	}
	clientQueries := counter.Count()
	if len(clientPage.Orders) != 1 || clientPage.Limit != 1 || clientPage.Offset != 0 || !clientPage.HasMore {
		t.Fatalf("unexpected client first page: limit=%d offset=%d len=%d has_more=%t", clientPage.Limit, clientPage.Offset, len(clientPage.Orders), clientPage.HasMore)
	}
	assertQueryBudget(t, "client order summaries", clientQueries, 1)
	clientSecondPage, err := st.ClientOrders(ctx, clientListSession, store.ClientOrderFilter{Limit: 1, Offset: 1})
	if err != nil {
		t.Fatalf("client order summaries second page: %v", err)
	}
	if len(clientSecondPage.Orders) != 1 {
		t.Fatalf("expected client second page summary")
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
	clientSession, input := prepareCashOrderForCart(
		t,
		ctx,
		st,
		telegramID,
		phone,
		address,
		[]core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}},
		now,
	)
	order, err := st.CreateCashOrder(ctx, clientSession, input, idempotencyKey, "request-hash-"+idempotencyKey, now)
	if err != nil {
		t.Fatalf("create cash order: %v", err)
	}
	return order
}

func prepareCashOrderForCart(
	t *testing.T,
	ctx context.Context,
	st *store.Store,
	telegramID int64,
	phone string,
	address string,
	cart []core.CartItemInput,
	now time.Time,
) (core.Session, store.CreateOrderInput) {
	t.Helper()
	clientSession := clientSession(t, ctx, st, telegramID)
	if err := st.VerifyTelegramContact(ctx, telegramID, telegramID, phone); err != nil {
		t.Fatalf("verify contact: %v", err)
	}
	calc, err := st.Calculate(ctx, clientSession, cart, now)
	if err != nil {
		t.Fatalf("calculate: %v", err)
	}
	challenge, err := st.CreateCashLocationChallenge(ctx, clientSession, store.CreateCashLocationChallengeInput{
		CalculationToken: calc.Token,
	}, now, true)
	if err != nil {
		t.Fatalf("create location challenge: %v", err)
	}
	return clientSession, store.CreateOrderInput{
		CalculationToken:        calc.Token,
		CashLocationChallengeID: challenge.ID.String(),
		Phone:                   phone,
		Address:                 address,
		PaymentMethod:           core.PaymentCash,
		TermsAccepted:           true,
		Locale:                  "ru",
	}
}

func newIntegrationStore(t *testing.T, ctx context.Context) (*store.Store, *pgxpool.Pool) {
	t.Helper()
	st, pool, _ := newIntegrationStoreWithQueryCounter(t, ctx)
	return st, pool
}

func newIntegrationStoreWithQueryCounter(t *testing.T, ctx context.Context) (*store.Store, *pgxpool.Pool, *queryCounter) {
	t.Helper()
	dsn := os.Getenv("TK_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set TK_TEST_POSTGRES_DSN to run store integration tests")
	}
	counter := &queryCounter{}
	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse postgres config: %v", err)
	}
	poolConfig.ConnConfig.Tracer = counter
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
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
	counter.Reset()
	return store.New(pool, box, bytes.Repeat([]byte{9}, 32)), pool, counter
}

func lockIntegrationDatabase(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx, `SELECT pg_advisory_lock($1)`, integrationDBLockKey); err != nil {
		pool.Close()
		t.Fatalf("lock integration database: %v", err)
	}
}

func assertQueryBudget(t *testing.T, name string, got, max int64) {
	t.Helper()
	if got > max {
		t.Fatalf("%s query count = %d, want <= %d", name, got, max)
	}
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

func menuRevision(t *testing.T, ctx context.Context, st *store.Store) int64 {
	t.Helper()
	revision, _, err := st.MenuWithRevision(ctx, "ru")
	if err != nil {
		t.Fatalf("menu revision: %v", err)
	}
	return revision
}

func requireRevisionIncrease(t *testing.T, ctx context.Context, st *store.Store, previous int64, action string) int64 {
	t.Helper()
	next := menuRevision(t, ctx, st)
	if next <= previous {
		t.Fatalf("%s did not increase menu revision: before=%d after=%d", action, previous, next)
	}
	return next
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

func roleListContains(roles []core.Role, role core.Role) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}
	return false
}

func assertNotificationJobs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID, expected map[string]int) {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT recipient_kind, COUNT(*)::int
		FROM notification_jobs
		WHERE order_id=$1 AND status='pending'
		GROUP BY recipient_kind
	`, orderID)
	if err != nil {
		t.Fatalf("count notification jobs: %v", err)
	}
	defer rows.Close()
	got := map[string]int{}
	for rows.Next() {
		var recipient string
		var count int
		if err := rows.Scan(&recipient, &count); err != nil {
			t.Fatalf("scan notification jobs: %v", err)
		}
		got[recipient] = count
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate notification jobs: %v", err)
	}
	for recipient, want := range expected {
		if got[recipient] != want {
			t.Fatalf("notification jobs for %s = %d, want %d; all=%v", recipient, got[recipient], want, got)
		}
		delete(got, recipient)
	}
	if len(got) != 0 {
		t.Fatalf("unexpected notification job recipients: %v", got)
	}
}

func assertReservationOwnerJobs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, reservationID uuid.UUID, template, eventKey string) {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT event_key
		FROM notification_jobs
		WHERE reservation_id=$1 AND recipient_kind='admin' AND template=$2 AND status='pending'
		ORDER BY event_key
	`, reservationID, template)
	if err != nil {
		t.Fatalf("query reservation owner jobs: %v", err)
	}
	defer rows.Close()
	got := []string{}
	for rows.Next() {
		var current string
		if err := rows.Scan(&current); err != nil {
			t.Fatalf("scan reservation owner job: %v", err)
		}
		got = append(got, current)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate reservation owner jobs: %v", err)
	}
	want := []string{
		eventKey + ":owner:1048084234",
		eventKey + ":owner:8241921060",
	}
	if !slices.Equal(got, want) {
		t.Fatalf("reservation owner jobs = %v, want %v", got, want)
	}
}

func setOrderCreatedAt(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID, createdAt time.Time) {
	t.Helper()
	tag, err := pool.Exec(ctx, `UPDATE orders SET created_at=$2, updated_at=$2 WHERE id=$1`, orderID, createdAt)
	if err != nil {
		t.Fatalf("set order created_at: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("set order created_at rows affected = %d, want 1", tag.RowsAffected())
	}
}

func belgradeDayUTCRange(t *testing.T, date string) (time.Time, time.Time) {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Belgrade")
	if err != nil {
		t.Fatalf("load Belgrade location: %v", err)
	}
	from, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		t.Fatalf("parse Belgrade date: %v", err)
	}
	return from.UTC(), from.AddDate(0, 0, 1).UTC()
}

func explainPlanJSON(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, args ...any) any {
	t.Helper()
	var raw []byte
	if err := pool.QueryRow(ctx, "EXPLAIN (FORMAT JSON) "+query, args...).Scan(&raw); err != nil {
		t.Fatalf("explain query: %v", err)
	}
	var plan any
	if err := json.Unmarshal(raw, &plan); err != nil {
		t.Fatalf("parse explain plan JSON: %v", err)
	}
	return plan
}

func planHasRelationNodeType(plan any, relation, nodeType string) bool {
	found := false
	walkPlanJSON(plan, func(node map[string]any) {
		if found {
			return
		}
		if node["Relation Name"] == relation && node["Node Type"] == nodeType {
			found = true
		}
	})
	return found
}

func planHasIndexName(plan any, indexName string) bool {
	found := false
	walkPlanJSON(plan, func(node map[string]any) {
		if found {
			return
		}
		if node["Index Name"] == indexName {
			found = true
		}
	})
	return found
}

func walkPlanJSON(value any, visit func(map[string]any)) {
	switch typed := value.(type) {
	case []any:
		for _, child := range typed {
			walkPlanJSON(child, visit)
		}
	case map[string]any:
		visit(typed)
		for _, child := range typed {
			walkPlanJSON(child, visit)
		}
	}
}

func mustMarshalJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal JSON: %v", err)
	}
	return string(raw)
}

func uuidSlicesEqual(left, right []uuid.UUID) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func corruptOrderPII(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID) {
	t.Helper()
	tag, err := pool.Exec(ctx, `
		UPDATE orders
		SET phone_ciphertext='not-base64-phone',
		    address_ciphertext='not-base64-address',
		    updated_at=now()
		WHERE id=$1
	`, orderID)
	if err != nil {
		t.Fatalf("corrupt order PII: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("corrupt order PII rows affected = %d, want 1", tag.RowsAffected())
	}
}

func adminMenuItemForTest(t *testing.T, ctx context.Context, st *store.Store, sess core.Session, itemID uuid.UUID) core.AdminMenuItem {
	t.Helper()
	_, items, err := st.AdminMenu(ctx, sess)
	if err != nil {
		t.Fatalf("admin menu: %v", err)
	}
	for _, item := range items {
		if item.ID == itemID {
			return item
		}
	}
	t.Fatalf("admin menu item %s not found", itemID)
	return core.AdminMenuItem{}
}

func assertOrderItemsEqual(t *testing.T, label string, got, want []core.OrderItem) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s item count = %d, want %d; got=%+v want=%+v", label, len(got), len(want), got, want)
	}
	for index := range got {
		if got[index] != want[index] {
			t.Fatalf("%s item %d = %+v, want %+v", label, index, got[index], want[index])
		}
	}
}

func orderSummaryPageContains(orders []core.OrderSummary, orderID uuid.UUID) bool {
	for _, order := range orders {
		if order.ID == orderID {
			return true
		}
	}
	return false
}
