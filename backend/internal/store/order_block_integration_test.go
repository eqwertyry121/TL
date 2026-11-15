package store_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/config"
	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/httpapi"
	"github.com/eqwertyry121/TL/backend/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestOrderBlockPreservesHistoryAndRejectsNewOrdersAndAdditions(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	st.EnablePersistentCityVerification()
	if _, err := pool.Exec(ctx, `UPDATE app_settings SET cash_location_required=false, delivery_enabled=true`); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	items := []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}
	blocked := clientSession(t, ctx, st, clientTelegramID+8000)
	blockedAddition := clientSession(t, ctx, st, clientTelegramID+8001)
	other := clientSession(t, ctx, st, clientTelegramID+8002)

	calculate := func(sess core.Session) store.CreateOrderInput {
		t.Helper()
		calc, err := st.Calculate(ctx, sess, items, now)
		if err != nil {
			t.Fatalf("calculate order: %v", err)
		}
		return store.CreateOrderInput{CalculationToken: calc.Token, Address: "Test address", PaymentMethod: core.PaymentCash, TermsAccepted: true, Locale: "ru"}
	}
	blockedInput := calculate(blocked)
	additionInput := calculate(blockedAddition)
	otherInput := calculate(other)
	previousOrder, err := st.CreateCashOrder(ctx, blockedAddition, additionInput, "block-existing-order", "hash-existing-order", now)
	if err != nil {
		t.Fatalf("create existing order: %v", err)
	}
	additionCalc, err := st.CalculateAddition(ctx, blockedAddition, previousOrder.ID, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 1}}, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("calculate addition: %v", err)
	}

	if _, err := pool.Exec(ctx, `INSERT INTO order_blocked_telegram_users (telegram_user_id) VALUES ($1), ($2)`, blocked.TelegramUserID, blockedAddition.TelegramUserID); err != nil {
		t.Fatalf("block accounts: %v", err)
	}
	assertBlocked := func(err error) {
		t.Helper()
		var dbErr *pgconn.PgError
		if !errors.As(err, &dbErr) || dbErr.Code != "P0001" || dbErr.Message != "Unable to process order" {
			t.Fatalf("expected generic database rejection, got %v", err)
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		_, err := st.CreateCashOrder(ctx, blocked, blockedInput, "block-order-retry", "hash-block-order", now)
		assertBlocked(err)
	}
	newSession := clientSession(t, ctx, st, blocked.TelegramUserID)
	_, err = st.CreateCashOrder(ctx, newSession, blockedInput, "block-new-session", "hash-block-new-session", now)
	assertBlocked(err)
	// Verify the real authenticated HTTP response does not disclose a block.
	body, err := json.Marshal(blockedInput)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/orders", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+newSession.Token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "block-api-order")
	response := httptest.NewRecorder()
	httpapi.New(config.Config{Env: "test"}, st).Routes().ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":"INTERNAL"`) || strings.Contains(strings.ToLower(response.Body.String()), "block") {
		t.Fatalf("unexpected customer response: status=%d body=%s", response.Code, response.Body.String())
	}
	// The database guard also covers pickup independently of checkout validation.
	_, err = pool.Exec(ctx, `INSERT INTO orders (client_user_id, fulfillment_type, fulfillment_status, payment_method, payment_status, subtotal_minor, delivery_fee_minor, total_minor, currency, phone_ciphertext, address_ciphertext)
		VALUES ($1, 'pickup', 'NEW', 'cash', 'CASH_PENDING', 0, 0, 0, 'RSD', '', '')`, blocked.UserID)
	assertBlocked(err)

	_, err = st.AddOrderItems(ctx, blockedAddition, previousOrder.ID, store.AddOrderItemsInput{
		CalculationToken: additionCalc.Token,
		ExpectedVersion:  previousOrder.Version,
	}, "block-addition", "hash-block-addition", now.Add(time.Minute))
	assertBlocked(err)
	unchanged, err := st.OrderByID(ctx, previousOrder.ID, true)
	if err != nil || unchanged.TotalMinor != previousOrder.TotalMinor || len(unchanged.Items) != len(previousOrder.Items) {
		t.Fatalf("existing order changed: order=%+v, error=%v", unchanged, err)
	}
	var blockedOrders, additions int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE client_user_id=$1`, blocked.UserID).Scan(&blockedOrders); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM order_additions WHERE order_id=$1`, previousOrder.ID).Scan(&additions); err != nil {
		t.Fatal(err)
	}
	if blockedOrders != 0 || additions != 0 {
		t.Fatalf("blocked user created %d orders or %d additions", blockedOrders, additions)
	}
	// The restriction follows Telegram ID even if the user row is recreated.
	const recreatedTelegramID = clientTelegramID + 8003
	oldUser, err := st.UpsertTelegramUser(ctx, core.User{TelegramUserID: recreatedTelegramID, FirstName: "Test"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO order_blocked_telegram_users (telegram_user_id) VALUES ($1)`, recreatedTelegramID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, oldUser.ID); err != nil {
		t.Fatal(err)
	}
	recreated := clientSession(t, ctx, st, recreatedTelegramID)
	if recreated.UserID == oldUser.ID {
		t.Fatal("expected a newly created user record")
	}
	_, err = st.CreateCashOrder(ctx, recreated, calculate(recreated), "block-recreated-user", "hash-block-recreated-user", now)
	assertBlocked(err)
	if _, err := st.CreateCashOrder(ctx, other, otherInput, "block-control", "hash-block-control", now); err != nil {
		t.Fatalf("unblocked user cannot order: %v", err)
	}
}
