package store_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/store"
)

func TestReservationSettingsChangeRealAvailabilityAndPreserveBookings(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	admin := bootstrapOwnerSession(t, ctx, st)
	client := clientSession(t, ctx, st, clientTelegramID+3000)
	other := clientSession(t, ctx, st, clientTelegramID+3001)
	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	old, err := st.CreateReservation(ctx, client, store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartHour: 18, Guests: 11}, "settings-old", now)
	if err != nil {
		t.Fatal(err)
	}
	current, err := st.ReservationSettings(ctx, admin, "podbara")
	if err != nil {
		t.Fatal(err)
	}
	input := store.UpdateReservationSettingsInput{
		Name: "New name", Address: "New address", MaxGuests: 10, SeatCapacity: 10,
		StepMinutes: 15, Duration: 90, AdvanceDays: 3, Version: current.Location.Version, Schedule: current.Schedule,
	}
	if _, err := st.UpdateReservationSettings(ctx, other, "podbara", input, now); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("client edited settings: %v", err)
	}
	if _, err := st.UpdateReservationSettings(ctx, admin, "podbara", input, now); !errors.Is(err, core.ErrReservationCapacityConflict) {
		t.Fatalf("reduced capacity below existing booking: %v", err)
	}
	input.SeatCapacity = 21
	input.Schedule[2].IsOpen = false         // Tuesday.
	input.Schedule[2].LastStart = 23*60 + 45 // Closed days need not fit the new duration.
	input.Schedule[3].FirstStart = 795
	input.Schedule[3].LastStart = 915
	updated, err := st.UpdateReservationSettings(ctx, admin, "podbara", input, now)
	if err != nil || updated.Location.Duration != 90 || updated.Location.AdvanceDays != 3 {
		t.Fatalf("save settings = %+v, err=%v", updated.Location, err)
	}
	if _, err := st.UpdateReservationSettings(ctx, admin, "podbara", input, now); !errors.Is(err, core.ErrReservationSettingsConflict) {
		t.Fatalf("stale settings overwrote newer change: %v", err)
	}
	invalid := input
	invalid.Version = updated.Location.Version
	invalid.Schedule = slices.Clone(input.Schedule)
	invalid.Schedule[2].LastStart = 1440
	if _, err := st.UpdateReservationSettings(ctx, admin, "podbara", invalid, now); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("invalid closed-day time accepted: %v", err)
	}
	retained, err := st.ActiveReservation(ctx, client, now)
	if err != nil || retained == nil || retained.ID != old.ID || retained.StartMinute != 1080 || retained.EndMinute != 1200 || retained.LocationAddress != "Temerinska 44" {
		t.Fatalf("existing booking was changed: %+v, err=%v", retained, err)
	}
	availability, err := st.ReservationAvailability(ctx, other, "podbara", 2, now)
	if err != nil || len(availability.Days) != 3 || len(availability.Days[0].Minutes) != 0 ||
		!slices.Contains(availability.Days[1].Minutes, 795) || !slices.Contains(availability.Days[1].Minutes, 810) || len(availability.Days[1].Hours) != 0 {
		t.Fatalf("configured quarter-hour availability = %+v, err=%v", availability, err)
	}
	minute := 795
	created, err := st.CreateReservation(ctx, other, store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartMinute: &minute, Guests: 2}, "settings-new", now)
	if err != nil || created.StartMinute != 795 || created.EndMinute != 885 || created.LocationAddress != "New address" {
		t.Fatalf("new booking did not use settings: %+v, err=%v", created, err)
	}
	moved, err := st.AdminUpdateReservation(ctx, admin, old.ID, store.AdminReservationInput{
		LocationCode: "podbara", Date: old.Date, StartMinute: 18*60 + 15,
		Duration: 120, Guests: old.Guests, ExpectedVersion: old.Version,
	}, now)
	if err != nil || moved.LocationAddress != "Temerinska 44" || moved.LocationName != old.LocationName {
		t.Fatalf("moving within the same location changed the original address: %+v, err=%v", moved, err)
	}
}

func TestAdminManualBookingAndMove(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	admin := bootstrapOwnerSession(t, ctx, st)
	client := clientSession(t, ctx, st, clientTelegramID+3100)
	other := clientSession(t, ctx, st, clientTelegramID+3101)
	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	input := store.AdminReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartMinute: 795, Duration: 90, Guests: 12, GuestName: "Тестовый гость"}
	if _, err := st.AdminCreateReservation(ctx, client, input, "manual-one", now); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("client created manual booking: %v", err)
	}
	manual, err := st.AdminCreateReservation(ctx, admin, input, "manual-one", now)
	if err != nil || !manual.Manual || manual.ClientUserID != nil || manual.StartMinute != 795 || manual.EndMinute != 885 || manual.ClientFirstName != input.GuestName {
		t.Fatalf("manual reservation = %+v, err=%v", manual, err)
	}
	retry, err := st.AdminCreateReservation(ctx, admin, input, "manual-one", now)
	if err != nil || retry.ID != manual.ID {
		t.Fatalf("manual retry = %+v, err=%v", retry, err)
	}
	var clientJobs int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notification_jobs WHERE reservation_id=$1 AND recipient_kind='client'`, manual.ID).Scan(&clientJobs); err != nil || clientJobs != 0 {
		t.Fatalf("manual booking has Telegram client jobs: %d, %v", clientJobs, err)
	}
	minute := 810
	if _, err := st.CreateReservation(ctx, client, store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartMinute: &minute, Guests: 10}, "manual-collision", now); !errors.Is(err, core.ErrReservationUnavailable) {
		t.Fatalf("overlap with manual booking not detected: %v", err)
	}
	input.ExpectedVersion = manual.Version
	input.StartMinute = 960
	moved, err := st.AdminUpdateReservation(ctx, admin, manual.ID, input, now)
	if err != nil || moved.StartMinute != 960 || moved.EndMinute != 1050 || moved.ID != manual.ID {
		t.Fatalf("move manual booking = %+v, err=%v", moved, err)
	}
	if _, err := st.AdminUpdateReservation(ctx, admin, manual.ID, input, now); !errors.Is(err, core.ErrReservationSettingsConflict) {
		t.Fatalf("stale booking edit was accepted: %v", err)
	}
	if _, err := st.CreateReservation(ctx, client, store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartMinute: &minute, Guests: 10}, "after-manual-move", now); err != nil {
		t.Fatalf("original interval not released: %v", err)
	}
	linked, err := st.CreateReservation(ctx, other, store.CreateReservationInput{LocationCode: "telep", Date: "2026-08-19", StartHour: 18, Guests: 2}, "linked-move", now)
	if err != nil {
		t.Fatal(err)
	}
	edit := store.AdminReservationInput{LocationCode: "telep", Date: linked.Date, StartMinute: 18*60 + 15, Duration: 120, Guests: 2, ExpectedVersion: linked.Version}
	updated, err := st.AdminUpdateReservation(ctx, admin, linked.ID, edit, now)
	if err != nil || updated.StartMinute != 1095 || updated.ClientUserID == nil || *updated.ClientUserID != *linked.ClientUserID {
		t.Fatalf("move Telegram booking = %+v, err=%v", updated, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notification_jobs WHERE reservation_id=$1 AND template='reservation_rescheduled_by_admin' AND recipient_kind='client'`, linked.ID).Scan(&clientJobs); err != nil || clientJobs != 1 {
		t.Fatalf("linked client move notification count = %d, err=%v", clientJobs, err)
	}
	if _, err := st.CancelReservation(ctx, admin, manual.ID, true); err != nil {
		t.Fatalf("admin cancel manual booking: %v", err)
	}
}

func TestAdminTableChangesPreserveExistingReservations(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	admin := bootstrapOwnerSession(t, ctx, st)
	client := clientSession(t, ctx, st, clientTelegramID+3200)
	other := clientSession(t, ctx, st, clientTelegramID+3201)
	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	booking, err := st.CreateReservation(ctx, client, store.CreateReservationInput{LocationCode: "telep", Date: "2026-08-19", StartHour: 18, Guests: 4}, "table-old", now)
	if err != nil || booking.TableID == nil {
		t.Fatalf("initial table booking = %+v, err=%v", booking, err)
	}
	if _, err := st.SaveReservationTable(ctx, admin, booking.TableID, store.ReservationTableInput{Label: "Новый номер", Capacity: 3, Active: true}, now); !errors.Is(err, core.ErrReservationCapacityConflict) {
		t.Fatalf("table reduced below existing booking: %v", err)
	}
	if _, err := st.SaveReservationTable(ctx, other, booking.TableID, store.ReservationTableInput{Label: "Новый номер", Capacity: 5, Active: false}, now); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("client changed table: %v", err)
	}
	if _, err := st.SaveReservationTable(ctx, admin, booking.TableID, store.ReservationTableInput{Label: "Новый номер", Capacity: 5, Active: false}, now); err != nil {
		t.Fatal(err)
	}
	retained, err := st.ActiveReservation(ctx, client, now)
	if err != nil || retained == nil || retained.TableLabel != booking.TableLabel || *retained.TableID != *booking.TableID {
		t.Fatalf("existing table snapshot changed: %+v, err=%v", retained, err)
	}
	second, err := st.CreateReservation(ctx, other, store.CreateReservationInput{LocationCode: "telep", Date: booking.Date, StartHour: 18, Guests: 4}, "table-other", now)
	if err != nil || second.TableID == nil || *second.TableID == *booking.TableID {
		t.Fatalf("disabled table offered again: %+v, err=%v", second, err)
	}
	added, err := st.SaveReservationTable(ctx, admin, nil, store.ReservationTableInput{Label: "Большой стол", Capacity: 8, Active: true}, now)
	if err != nil {
		t.Fatal(err)
	}
	manual, err := st.AdminCreateReservation(ctx, admin, store.AdminReservationInput{LocationCode: "telep", Date: booking.Date, StartMinute: 18*60 + 15, Duration: 60, Guests: 7, GuestName: "Гость"}, "large-table", now)
	if err != nil || manual.TableID == nil || *manual.TableID != added.ID {
		t.Fatalf("new table unavailable for manual booking: %+v, err=%v", manual, err)
	}
}

func TestOwnerSnapshotIncludesNewReservationsBeyondSevenDays(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	admin := bootstrapOwnerSession(t, ctx, st)
	now := time.Now().UTC()
	date := now.AddDate(0, 0, 20).Format("2006-01-02")
	created, err := st.AdminCreateReservation(ctx, admin, store.AdminReservationInput{
		LocationCode: "podbara", Date: date, StartMinute: 13 * 60, Duration: 120, Guests: 1, GuestName: "Гость",
	}, "future-owner-alert", now)
	if err != nil {
		t.Fatal(err)
	}
	current, err := st.AdminReservations(ctx, admin, now.Add(time.Minute))
	if err != nil || !slices.ContainsFunc(current, func(item core.Reservation) bool { return item.ID == created.ID }) {
		t.Fatalf("new future booking missing from owner snapshot: %+v, err=%v", current, err)
	}
	older, err := st.AdminReservations(ctx, admin, now.Add(48*time.Hour))
	if err != nil || slices.ContainsFunc(older, func(item core.Reservation) bool { return item.ID == created.ID }) {
		t.Fatalf("old future booking stayed in recent owner snapshot: %+v, err=%v", older, err)
	}
}
