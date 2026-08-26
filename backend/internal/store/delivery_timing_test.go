package store

import (
	"errors"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
)

func TestDeliverySlotBoundsRoundsLeadTimeAndClampsToClosing(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Belgrade")
	if err != nil {
		t.Fatal(err)
	}
	settings := core.Settings{
		DeliveryMinLeadMinutes: 40,
		DeliverySlotMinutes:    30,
		DeliveryLastTargetTime: "22:30",
		Schedule:               []core.ScheduleDay{{DayOfWeek: 3, CloseTime: "22:00"}},
	}
	now := time.Date(2026, 8, 26, 17, 10, 0, 0, loc)
	first, last, err := deliverySlotBounds(now, settings)
	if err != nil {
		t.Fatal(err)
	}
	if got := first.Format("15:04"); got != "18:00" {
		t.Fatalf("first slot = %s, want 18:00", got)
	}
	if got := last.Format("15:04"); got != "22:00" {
		t.Fatalf("last slot = %s, want 22:00", got)
	}
}

func TestNormalizeDeliveryTimingRejectsInvalidCombinations(t *testing.T) {
	now := time.Now().UTC()
	if _, _, err := normalizeDeliveryTiming(DeliveryTimingInput{Mode: "ASAP", RequestedAt: &now}); !errors.Is(err, core.ErrDeliveryTimeInvalid) {
		t.Fatalf("ASAP with requested time error = %v", err)
	}
	if _, _, err := normalizeDeliveryTiming(DeliveryTimingInput{Mode: "SCHEDULED"}); !errors.Is(err, core.ErrDeliveryTimeInvalid) {
		t.Fatalf("scheduled without requested time error = %v", err)
	}
	mode, requested, err := normalizeDeliveryTiming(DeliveryTimingInput{})
	if err != nil || mode != "ASAP" || requested != nil {
		t.Fatalf("default timing = %q, %v, %v", mode, requested, err)
	}
}

func TestDeliveryTimingBetaAccessUsesExplicitTelegramIDs(t *testing.T) {
	publicStore := &Store{deliveryTimingBetaIDs: map[int64]struct{}{}}
	if !publicStore.deliveryTimingAccess(999) {
		t.Fatal("empty beta list must allow the globally enabled feature")
	}
	betaStore := &Store{deliveryTimingBetaIDs: map[int64]struct{}{1048084234: {}}}
	if !betaStore.deliveryTimingAccess(1048084234) || betaStore.deliveryTimingAccess(8241921060) {
		t.Fatal("beta access did not stay scoped to the explicit Telegram ID")
	}
}
