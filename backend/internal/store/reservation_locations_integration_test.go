package store_test

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/eqwertyry121/TL/backend/internal/db"
	"github.com/eqwertyry121/TL/backend/internal/store"
)

func TestReservationLocationMigrationPreservesExistingBookings(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	client := clientSession(t, ctx, st, clientTelegramID+1999)
	booking, err := st.CreateReservation(ctx, client, store.CreateReservationInput{Date: "2026-08-19", StartHour: 18, Guests: 2}, "legacy-booking", now)
	if err != nil {
		t.Fatal(err)
	}
	// Restore the pre-063 schema while retaining a real legacy reservation.
	_, err = pool.Exec(ctx, `
		DROP TABLE reservation_location_schedule;
		ALTER TABLE reservations DROP CONSTRAINT reservations_owner_check,
			DROP CONSTRAINT reservations_minute_check,
			DROP COLUMN created_by_admin_user_id, DROP COLUMN start_minute, DROP COLUMN end_minute,
			DROP COLUMN location_name_snapshot, DROP COLUMN location_address_snapshot, DROP COLUMN table_label_snapshot,
			ALTER COLUMN client_user_id SET NOT NULL;
		ALTER TABLE reservations DROP CONSTRAINT reservations_location_table_check,
			DROP COLUMN location_code, ALTER COLUMN table_id SET NOT NULL,
			DROP CONSTRAINT reservations_guests_check,
			ADD CONSTRAINT reservations_guests_check CHECK (guests BETWEEN 1 AND 20);
		DROP TABLE reservation_locations;
		DELETE FROM schema_migrations WHERE version IN ('063_reservation_locations.sql', '064_reservation_management.sql');
	`)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatalf("migrate existing booking: %v", err)
	}
	after, err := st.ActiveReservation(ctx, client, now)
	if err != nil || after == nil || after.ID != booking.ID || after.LocationCode != "telep" || after.TableID == nil || *after.TableID != *booking.TableID {
		t.Fatalf("legacy booking changed during migration: before=%+v after=%+v err=%v", booking, after, err)
	}
}

func TestReservationLocationsCapacityAndClose(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	admin := bootstrapOwnerSession(t, ctx, st)
	first := clientSession(t, ctx, st, clientTelegramID+2001)
	second := clientSession(t, ctx, st, clientTelegramID+2002)
	third := clientSession(t, ctx, st, clientTelegramID+2003)
	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	input := store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartHour: 18, Guests: 11, Locale: "ru"}

	booking, err := st.CreateReservation(ctx, first, input, "podbara-one", now)
	if err != nil || booking.TableID != nil || booking.TableLabel != "" || booking.LocationAddress != "Temerinska 44" {
		t.Fatalf("seat reservation = %+v, err=%v", booking, err)
	}
	input.Guests = 10
	secondBooking, err := st.CreateReservation(ctx, second, input, "podbara-two", now)
	if err != nil {
		t.Fatalf("fill remaining ten seats: %v", err)
	}
	availability, err := st.ReservationAvailability(ctx, third, "podbara", 1, now)
	if err != nil || slices.Contains(availability.Days[1].Hours, 18) || slices.Contains(availability.Days[1].Hours, 19) {
		t.Fatalf("full capacity availability = %+v, err=%v", availability, err)
	}
	input.Guests = 1
	if _, err := st.CreateReservation(ctx, third, input, "podbara-overflow", now); !errors.Is(err, core.ErrReservationUnavailable) {
		t.Fatalf("overflow error = %v", err)
	}
	if _, err := st.CancelReservation(ctx, third, booking.ID, false); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("foreign cancellation error = %v", err)
	}
	if other, err := st.ActiveReservation(ctx, third, now); err != nil || other != nil {
		t.Fatalf("another client's reservation was exposed: %+v, %v", other, err)
	}
	if _, err := st.SetReservationLocationOpen(ctx, third, "podbara", false); !errors.Is(err, core.ErrForbidden) {
		t.Fatalf("client closing location error = %v", err)
	}
	if _, err := st.SetReservationLocationOpen(ctx, admin, "podbara", false); err != nil {
		t.Fatalf("close location: %v", err)
	}
	availability, err = st.ReservationAvailability(ctx, third, "podbara", 1, now)
	if err != nil || len(availability.Days[1].Hours) != 0 {
		t.Fatalf("closed location availability = %+v, err=%v", availability, err)
	}
	if _, err := st.CreateReservation(ctx, third, input, "podbara-closed", now); !errors.Is(err, core.ErrReservationLocationClosed) {
		t.Fatalf("closed location accepted booking: %v", err)
	}
	active, err := st.ActiveReservation(ctx, first, now)
	if err != nil || active == nil || active.ID != booking.ID {
		t.Fatalf("closing altered existing reservation: %+v, %v", active, err)
	}
	telep, err := st.ReservationAvailability(ctx, third, "telep", 2, now)
	if err != nil || !slices.Contains(telep.Days[1].Hours, 18) {
		t.Fatalf("other location affected: %+v, %v", telep, err)
	}
	if _, err := st.SetReservationLocationOpen(ctx, admin, "podbara", true); err != nil {
		t.Fatalf("reopen location: %v", err)
	}
	if _, err := st.CancelReservation(ctx, second, secondBooking.ID, false); err != nil {
		t.Fatalf("cancel and release seats: %v", err)
	}
	input.Guests = 10
	if _, err := st.CreateReservation(ctx, third, input, "podbara-after-cancel", now); err != nil {
		t.Fatalf("reuse released seats: %v", err)
	}
	if _, err := st.ReservationAvailability(ctx, third, "podbara", 22, now); !errors.Is(err, core.ErrInvalidInput) {
		t.Fatalf("22 guests allowed: %v", err)
	}
	fourth := clientSession(t, ctx, st, clientTelegramID+2004)
	fullParty := store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-20", StartHour: 18, Guests: 21}
	if _, err := st.CreateReservation(ctx, fourth, fullParty, "podbara-all-seats", now); err != nil {
		t.Fatalf("single booking for 21 guests: %v", err)
	}
	locations, err := st.ReservationLocations(ctx, admin)
	if err != nil || len(locations) != 2 || !locations[1].IsOpen {
		t.Fatalf("reopened location did not persist: %+v, %v", locations, err)
	}
	var auditCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_log WHERE action='reservation_location.update'`).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("location audit count = %d, err=%v", auditCount, err)
	}
	input.LocationCode = "telep"
	input.Guests = 11
	if _, err := st.CreateReservation(ctx, first, input, "podbara-one", now); !errors.Is(err, core.ErrIdempotencyConflict) {
		t.Fatalf("idempotency key did not include location: %v", err)
	}
}

func TestReservationSeatsCheckEachOverlappingHour(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	for i, hour := range []int{13, 15} {
		client := clientSession(t, ctx, st, clientTelegramID+2100+int64(i))
		_, err := st.CreateReservation(ctx, client, store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartHour: hour, Guests: 11}, fmt.Sprintf("staggered-%d", hour), now)
		if err != nil {
			t.Fatal(err)
		}
	}
	client := clientSession(t, ctx, st, clientTelegramID+2102)
	availability, err := st.ReservationAvailability(ctx, client, "podbara", 10, now)
	if err != nil || !slices.Contains(availability.Days[1].Hours, 14) {
		t.Fatalf("disjoint parties incorrectly summed: %+v, %v", availability, err)
	}
	_, err = st.CreateReservation(ctx, client, store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartHour: 14, Guests: 10}, "staggered-middle", now)
	if err != nil {
		t.Fatalf("reserve ten remaining seats in both hours: %v", err)
	}
}

func TestReservationSeatsConcurrentRequestsDoNotOverbook(t *testing.T) {
	ctx := context.Background()
	st, pool := newIntegrationStore(t, ctx)
	defer pool.Close()
	now := time.Date(2026, 8, 18, 8, 0, 0, 0, time.UTC)
	clients := []core.Session{
		clientSession(t, ctx, st, clientTelegramID+2200),
		clientSession(t, ctx, st, clientTelegramID+2201),
	}
	start := make(chan struct{})
	errs := make(chan error, len(clients))
	var wg sync.WaitGroup
	for i, client := range clients {
		wg.Add(1)
		go func(i int, client core.Session) {
			defer wg.Done()
			<-start
			_, err := st.CreateReservation(ctx, client, store.CreateReservationInput{LocationCode: "podbara", Date: "2026-08-19", StartHour: 18, Guests: 12}, fmt.Sprintf("concurrent-%d", i), now)
			errs <- err
		}(i, client)
	}
	close(start)
	wg.Wait()
	close(errs)
	successes, unavailable := 0, 0
	for err := range errs {
		if err == nil {
			successes++
		} else if errors.Is(err, core.ErrReservationUnavailable) {
			unavailable++
		} else {
			t.Fatalf("concurrent request: %v", err)
		}
	}
	if successes != 1 || unavailable != 1 {
		t.Fatalf("concurrent outcomes: successes=%d unavailable=%d", successes, unavailable)
	}
}
