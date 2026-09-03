package store_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/store"
)

func TestPersistentCityVerificationIsSandboxOnly(t *testing.T) {
	for _, sandbox := range []bool{false, true} {
		t.Run(map[bool]string{false: "production", true: "sandbox"}[sandbox], func(t *testing.T) {
			ctx := context.Background()
			st, pool := newIntegrationStore(t, ctx)
			defer pool.Close()
			if sandbox {
				st.EnablePersistentCityVerification()
			}
			sess := clientSession(t, ctx, st, clientTelegramID)
			if err := st.VerifyTelegramContact(ctx, clientTelegramID, clientTelegramID, "+38160111222"); err != nil {
				t.Fatal(err)
			}
			now := time.Now().UTC()
			calc, err := st.Calculate(ctx, sess, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}, now)
			if err != nil {
				t.Fatal(err)
			}
			challenge, err := st.CreateCashLocationChallenge(ctx, sess, store.CreateCashLocationChallengeInput{CalculationToken: calc.Token}, now, false)
			if err != nil {
				t.Fatal(err)
			}
			settings, err := st.Settings(ctx)
			if err != nil {
				t.Fatal(err)
			}
			accuracy := 10.0
			verified, err := st.VerifyCashLocationForSession(ctx, sess, challenge.ID, settings.RestaurantLatitude, settings.RestaurantLongitude, &accuracy, now)
			if err != nil || verified.Status != core.CashLocationVerified {
				t.Fatalf("verify: %v %+v", err, verified)
			}
			// The old challenge is consumed/expired. Only sandbox may trust the account fact.
			if _, err := pool.Exec(ctx, `UPDATE cash_location_challenges SET status='USED', used_at=now(), expires_at=now()-interval '1 day' WHERE id=$1`, challenge.ID); err != nil {
				t.Fatal(err)
			}
			contact, err := st.VerifiedContact(ctx, sess)
			if err != nil {
				t.Fatal(err)
			}
			if contact.CityVerificationEnabled != sandbox || (contact.CityVerifiedAt != nil) != sandbox {
				t.Fatalf("unexpected city state: %+v", contact)
			}
			calc, err = st.Calculate(ctx, sess, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 6}}, now)
			if err != nil {
				t.Fatal(err)
			}
			input := store.CreateOrderInput{CalculationToken: calc.Token, Phone: "+38160111222", Address: "Novi Sad test", PaymentMethod: core.PaymentCash, TermsAccepted: true, Locale: "ru"}
			order, err := st.CreateCashOrder(ctx, sess, input, "city-persist-order", "city-persist-hash", now)
			if !sandbox {
				if !errors.Is(err, core.ErrCashLocationRequired) {
					t.Fatalf("production must require challenge, got %v", err)
				}
			} else if err != nil || order.FulfillmentStatus != core.StatusNew {
				t.Fatalf("sandbox order: %v %+v", err, order)
			}
			if sandbox {
				calc2, err := st.Calculate(ctx, sess, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}, now)
				if err != nil {
					t.Fatal(err)
				}
				input.CalculationToken = calc2.Token
				input.AllowConcurrentActiveOrders = true // Existing DEV-only order testing option.
				if _, err := st.CreateCashOrder(ctx, sess, input, "city-second-order", "city-second-hash", now); err != nil {
					t.Fatalf("second DEV order required location again: %v", err)
				}
			}
			other := clientSession(t, ctx, st, clientTelegramID+10)
			otherContact, err := st.VerifiedContact(ctx, other)
			if err != nil || otherContact.CityVerifiedAt != nil {
				t.Fatalf("verification leaked to another user: %v %+v", err, otherContact)
			}
			if _, err := st.VerifyCashLocationForSession(ctx, other, challenge.ID, settings.RestaurantLatitude, settings.RestaurantLongitude, &accuracy, now); err == nil {
				t.Fatal("another user verified a foreign challenge")
			}
		})
	}
}

func TestPersistentCityDoesNotTrustBypassOrRejectedLocation(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	sess := clientSession(t, ctx, st, ownerTelegramID)
	now := time.Now().UTC()
	calc, err := st.Calculate(ctx, sess, []core.CartItemInput{{ItemID: classicKhinkaliID, Quantity: 5}}, now)
	if err != nil {
		t.Fatal(err)
	}
	old, err := st.CreateCashLocationChallenge(ctx, sess, store.CreateCashLocationChallengeInput{CalculationToken: calc.Token}, now, true)
	if err != nil {
		t.Fatal(err)
	}
	st.EnablePersistentCityVerification()
	challenge, err := st.CreateCashLocationChallenge(ctx, sess, store.CreateCashLocationChallengeInput{CalculationToken: calc.Token}, now, true)
	if err != nil || challenge.Status != core.CashLocationPending || challenge.ID == old.ID || challenge.DevBypass {
		t.Fatalf("DEV reused fake proof: %v %+v", err, challenge)
	}
	accuracy := 10.0
	result, err := st.VerifyCashLocationForSession(ctx, sess, challenge.ID, 0, 0, &accuracy, now)
	if err != nil || result.Status != core.CashLocationRejected {
		t.Fatalf("outside location: %v %+v", err, result)
	}
	contact, err := st.VerifiedContact(ctx, sess)
	if err != nil || contact.CityVerifiedAt != nil {
		t.Fatalf("rejected/bypass location persisted: %v %+v", err, contact)
	}
}
