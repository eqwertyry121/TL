package core

import (
	"testing"
	"time"
)

func TestCanAcceptOrderSchedule(t *testing.T) {
	settings := Settings{Timezone: "Europe/Belgrade"}
	loc, err := time.LoadLocation(settings.Timezone)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name string
		at   time.Time
		ok   bool
	}{
		{"monday closed", time.Date(2026, 8, 10, 14, 0, 0, 0, loc), false},
		{"before opening", time.Date(2026, 8, 11, 12, 59, 0, 0, loc), false},
		{"opening accepted", time.Date(2026, 8, 11, 13, 0, 0, 0, loc), true},
		{"cutoff accepted", time.Date(2026, 8, 11, 20, 59, 0, 0, loc), true},
		{"after cutoff rejected", time.Date(2026, 8, 11, 21, 0, 0, 0, loc), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CanAcceptOrder(tt.at, settings)
			if got.OK != tt.ok {
				t.Fatalf("OK=%v, want %v, reason=%s", got.OK, tt.ok, got.Reason)
			}
		})
	}
}

func TestCanAcceptOrderManualDayOff(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Belgrade")
	if err != nil {
		t.Fatal(err)
	}
	settings := Settings{Timezone: "Europe/Belgrade", ManualDayOff: true}
	got := CanAcceptOrder(time.Date(2026, 8, 11, 14, 0, 0, 0, loc), settings)
	if got.OK {
		t.Fatal("manual day off must reject orders")
	}
	if got.Reason != "manual_day_off" {
		t.Fatalf("reason=%s", got.Reason)
	}
}

func TestValidateScheduleRejectsInvalidClosedDayTimes(t *testing.T) {
	schedule := DefaultSchedule()
	schedule[1].OpenTime = "22:00"
	schedule[1].OrderCutoffTime = "21:00"

	if _, err := ValidateSchedule(schedule); err == nil {
		t.Fatal("closed days must still have DB-compatible time ordering")
	}
}
