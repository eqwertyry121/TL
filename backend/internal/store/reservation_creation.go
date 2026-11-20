package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const reservationSelectColumns = `r.id, r.public_number, r.client_user_id, r.client_username, r.client_first_name,
	r.location_code, r.location_name_snapshot, r.location_address_snapshot, r.table_id, r.table_label_snapshot,
	to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_hour, r.end_hour, r.start_minute, r.end_minute,
	(r.client_user_id IS NULL), r.guests, r.status, r.locale, r.version, r.created_at, r.cancelled_at`

func reservationDateAndTime(dateText string, minute, duration int, now time.Time) (time.Time, time.Time, error) {
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	localNow := now.In(loc)
	date, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(dateText), loc)
	if err != nil || minute < 0 || minute > 1425 || minute%15 != 0 || duration < 15 || duration > 720 || duration%15 != 0 || minute+duration > 1440 {
		return time.Time{}, time.Time{}, core.ErrInvalidInput
	}
	today := localDate(localNow)
	if date.Before(today) || date.After(today.AddDate(0, 0, 364)) || (date.Equal(today) && minute+duration <= localNow.Hour()*60+localNow.Minute()) {
		return time.Time{}, time.Time{}, core.ErrReservationUnavailable
	}
	return date, localNow, nil
}

func lockReservationLocation(ctx context.Context, tx pgx.Tx, code string) (core.ReservationLocation, error) {
	location, err := scanReservationLocation(tx.QueryRow(ctx, `SELECT `+reservationLocationColumns+` FROM reservation_locations WHERE code=$1 FOR UPDATE`, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return core.ReservationLocation{}, core.ErrInvalidInput
	}
	return location, err
}

// chooseReservationSpace is called while holding the location row lock.
func chooseReservationSpace(ctx context.Context, tx pgx.Tx, location core.ReservationLocation, date string, start, end, guests int, exclude *uuid.UUID) (*uuid.UUID, string, error) {
	if location.Mode == "tables" {
		var tableID uuid.UUID
		var label string
		err := tx.QueryRow(ctx, `SELECT t.id, t.label FROM restaurant_tables t
			WHERE t.active AND t.capacity >= $1 AND NOT EXISTS (
				SELECT 1 FROM reservations r WHERE r.table_id=t.id AND r.reservation_date=$2 AND r.status='CONFIRMED'
				AND $3 < r.end_minute AND $4 > r.start_minute AND r.id IS DISTINCT FROM $5::uuid
			) ORDER BY t.capacity, t.sort_order, t.id LIMIT 1`, guests, date, start, end, exclude).Scan(&tableID, &label)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", core.ErrReservationUnavailable
		}
		if err != nil {
			return nil, "", err
		}
		return &tableID, label, nil
	}
	rows, err := tx.Query(ctx, `SELECT to_char(reservation_date, 'YYYY-MM-DD'), start_minute, end_minute, guests
		FROM reservations WHERE location_code=$1 AND reservation_date=$2 AND status='CONFIRMED'
		AND $3 < end_minute AND $4 > start_minute AND id IS DISTINCT FROM $5::uuid`, location.Code, date, start, end, exclude)
	if err != nil {
		return nil, "", err
	}
	occupied := []reservationOccupied{}
	for rows.Next() {
		var booking reservationOccupied
		if err := rows.Scan(&booking.date, &booking.start, &booking.end, &booking.guests); err != nil {
			rows.Close()
			return nil, "", err
		}
		occupied = append(occupied, booking)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	if !reservationSeatsAvailable(date, start, end, location.SeatCapacity, guests, occupied) {
		return nil, "", core.ErrReservationUnavailable
	}
	return nil, "", nil
}

func (s *Store) CreateReservation(ctx context.Context, sess core.Session, input CreateReservationInput, idempotencyKey string, now time.Time) (core.Reservation, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Reservation{}, core.ErrForbidden
	}
	settings, err := s.Settings(ctx)
	if err != nil {
		return core.Reservation{}, err
	}
	if settings.ManualDayOff {
		return core.Reservation{}, core.ErrManualDayOff
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	input.Date = strings.TrimSpace(input.Date)
	input.LocationCode = reservationLocationCode(input.LocationCode)
	start := input.StartHour * 60
	if input.StartMinute != nil {
		start = *input.StartMinute
	}
	if idempotencyKey == "" || len(idempotencyKey) > 128 || input.Guests < 1 || input.Guests > 100 {
		return core.Reservation{}, core.ErrInvalidInput
	}
	date, localNow, err := reservationDateAndTime(input.Date, start, 15, now)
	if err != nil {
		return core.Reservation{}, err
	}
	today := localDate(localNow)
	if date.Equal(today) && start <= localNow.Hour()*60+localNow.Minute() {
		return core.Reservation{}, core.ErrReservationUnavailable
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Reservation{}, err
	}
	defer rollback(ctx, tx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, sess.TelegramUserID); err != nil {
		return core.Reservation{}, err
	}
	existing, err := scanReservation(tx.QueryRow(ctx, `SELECT `+reservationSelectColumns+` FROM reservations r
		WHERE r.client_user_id=$1 AND r.idempotency_key=$2`, sess.UserID, idempotencyKey))
	if err == nil {
		if existing.LocationCode != input.LocationCode || existing.Date != input.Date || existing.StartMinute != start || existing.Guests != input.Guests {
			return core.Reservation{}, core.ErrIdempotencyConflict
		}
		return *existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return core.Reservation{}, err
	}
	var active bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM reservations WHERE client_user_id=$1 AND status='CONFIRMED'
		AND (reservation_date > $2 OR (reservation_date=$2 AND end_minute > $3)))`,
		sess.UserID, today.Format("2006-01-02"), localNow.Hour()*60+localNow.Minute()).Scan(&active); err != nil {
		return core.Reservation{}, err
	}
	if active {
		return core.Reservation{}, core.ErrActiveReservationExists
	}
	location, err := lockReservationLocation(ctx, tx, input.LocationCode)
	if err != nil {
		return core.Reservation{}, err
	}
	if input.Guests > location.MaxGuests {
		return core.Reservation{}, core.ErrInvalidInput
	}
	if !location.IsOpen {
		return core.Reservation{}, core.ErrReservationLocationClosed
	}
	if input.StartMinute == nil && location.Duration%60 != 0 {
		return core.Reservation{}, core.ErrReservationClientOutdated
	}
	if date.After(today.AddDate(0, 0, location.AdvanceDays-1)) || start+location.Duration > 1440 {
		return core.Reservation{}, core.ErrReservationUnavailable
	}
	schedule, err := loadReservationSchedule(ctx, tx, location.Code)
	if err != nil {
		return core.Reservation{}, err
	}
	day := schedule[int(date.Weekday())]
	if !day.IsOpen || start < day.FirstStart || start > day.LastStart || (start-day.FirstStart)%location.StepMinutes != 0 {
		return core.Reservation{}, core.ErrReservationUnavailable
	}
	tableID, label, err := chooseReservationSpace(ctx, tx, location, input.Date, start, start+location.Duration, input.Guests, nil)
	if err != nil {
		return core.Reservation{}, err
	}
	var id uuid.UUID
	err = tx.QueryRow(ctx, `INSERT INTO reservations (
		client_user_id, location_code, table_id, reservation_date, start_hour, end_hour, start_minute, end_minute, guests,
		client_username, client_first_name, locale, idempotency_key, location_name_snapshot, location_address_snapshot, table_label_snapshot
	) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
		sess.UserID, location.Code, tableID, input.Date, start/60, (start+location.Duration+59)/60, start, start+location.Duration, input.Guests,
		safe(sess.Username), safe(sess.FirstName), reservationLocale(input.Locale), idempotencyKey, location.Name, location.Address, label).Scan(&id)
	if err != nil {
		return core.Reservation{}, err
	}
	reservation, err := scanReservation(tx.QueryRow(ctx, `SELECT `+reservationSelectColumns+` FROM reservations r WHERE r.id=$1`, id))
	if err != nil {
		return core.Reservation{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO notification_jobs (reservation_id,recipient_kind,template,event_key)
		VALUES ($1,'client','reservation_confirmed',$2) ON CONFLICT (event_key,recipient_kind) DO NOTHING`, id, fmt.Sprintf("reservation:%s:created", id))
	if err != nil {
		return core.Reservation{}, err
	}
	if err := insertReservationOwnerNotifications(ctx, tx, id, "reservation_created", fmt.Sprintf("reservation:%s:created", id)); err != nil {
		return core.Reservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Reservation{}, err
	}
	return *reservation, nil
}

type AdminReservationInput struct {
	LocationCode    string `json:"location_code"`
	Date            string `json:"date"`
	StartMinute     int    `json:"start_minute"`
	Duration        int    `json:"duration_minutes"`
	Guests          int    `json:"guests"`
	GuestName       string `json:"guest_name"`
	ExpectedVersion int    `json:"expected_version,omitempty"`
}

func (s *Store) AdminCreateReservation(ctx context.Context, sess core.Session, input AdminReservationInput, idempotencyKey string, now time.Time) (core.Reservation, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Reservation{}, core.ErrForbidden
	}
	input.LocationCode = reservationLocationCode(input.LocationCode)
	input.Date = strings.TrimSpace(input.Date)
	input.GuestName, idempotencyKey = strings.TrimSpace(input.GuestName), strings.TrimSpace(idempotencyKey)
	if input.GuestName == "" || len([]rune(input.GuestName)) > 80 || input.Guests < 1 || input.Guests > 100 || idempotencyKey == "" || len(idempotencyKey) > 128 {
		return core.Reservation{}, core.ErrInvalidInput
	}
	if _, _, err := reservationDateAndTime(input.Date, input.StartMinute, input.Duration, now); err != nil {
		return core.Reservation{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Reservation{}, err
	}
	defer rollback(ctx, tx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, sess.TelegramUserID); err != nil {
		return core.Reservation{}, err
	}
	existing, err := scanReservation(tx.QueryRow(ctx, `SELECT `+reservationSelectColumns+` FROM reservations r
		WHERE r.client_user_id IS NULL AND r.created_by_admin_user_id=$1 AND r.idempotency_key=$2`, sess.UserID, idempotencyKey))
	if err == nil {
		if existing.LocationCode != input.LocationCode || existing.Date != input.Date || existing.StartMinute != input.StartMinute ||
			existing.EndMinute != input.StartMinute+input.Duration || existing.Guests != input.Guests || existing.ClientFirstName != input.GuestName {
			return core.Reservation{}, core.ErrIdempotencyConflict
		}
		return *existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return core.Reservation{}, err
	}
	location, err := lockReservationLocation(ctx, tx, input.LocationCode)
	if err != nil {
		return core.Reservation{}, err
	}
	end := input.StartMinute + input.Duration
	tableID, label, err := chooseReservationSpace(ctx, tx, location, input.Date, input.StartMinute, end, input.Guests, nil)
	if err != nil {
		return core.Reservation{}, err
	}
	var id uuid.UUID
	err = tx.QueryRow(ctx, `INSERT INTO reservations (
		client_user_id,created_by_admin_user_id,location_code,table_id,reservation_date,start_hour,end_hour,start_minute,end_minute,guests,
		client_first_name,locale,idempotency_key,location_name_snapshot,location_address_snapshot,table_label_snapshot
	) VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ru',$11,$12,$13,$14) RETURNING id`,
		sess.UserID, location.Code, tableID, input.Date, input.StartMinute/60, (end+59)/60, input.StartMinute, end, input.Guests,
		input.GuestName, idempotencyKey, location.Name, location.Address, label).Scan(&id)
	if err != nil {
		return core.Reservation{}, err
	}
	reservation, err := scanReservation(tx.QueryRow(ctx, `SELECT `+reservationSelectColumns+` FROM reservations r WHERE r.id=$1`, id))
	if err != nil {
		return core.Reservation{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "reservation.manual_create", "reservation", &id, "", nil, reservationAudit(*reservation)); err != nil {
		return core.Reservation{}, err
	}
	if err := insertReservationOwnerNotifications(ctx, tx, id, "reservation_created", fmt.Sprintf("reservation:%s:created", id)); err != nil {
		return core.Reservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Reservation{}, err
	}
	return *reservation, nil
}

func (s *Store) AdminUpdateReservation(ctx context.Context, sess core.Session, id uuid.UUID, input AdminReservationInput, now time.Time) (core.Reservation, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.Reservation{}, core.ErrForbidden
	}
	input.LocationCode = reservationLocationCode(input.LocationCode)
	input.Date = strings.TrimSpace(input.Date)
	input.GuestName = strings.TrimSpace(input.GuestName)
	if input.Guests < 1 || input.Guests > 100 || input.ExpectedVersion < 1 || len([]rune(input.GuestName)) > 80 {
		return core.Reservation{}, core.ErrInvalidInput
	}
	if _, _, err := reservationDateAndTime(input.Date, input.StartMinute, input.Duration, now); err != nil {
		return core.Reservation{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Reservation{}, err
	}
	defer rollback(ctx, tx)
	before, err := scanReservation(tx.QueryRow(ctx, `SELECT `+reservationSelectColumns+` FROM reservations r WHERE r.id=$1 FOR UPDATE OF r`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Reservation{}, core.ErrInvalidInput
	}
	if err != nil {
		return core.Reservation{}, err
	}
	if before.Status != core.ReservationConfirmed || before.Version != input.ExpectedVersion {
		return core.Reservation{}, core.ErrReservationSettingsConflict
	}
	if before.Manual && input.GuestName == "" {
		return core.Reservation{}, core.ErrInvalidInput
	}
	location, err := lockReservationLocation(ctx, tx, input.LocationCode)
	if err != nil {
		return core.Reservation{}, err
	}
	end := input.StartMinute + input.Duration
	changedSpace := before.LocationCode != location.Code || before.Date != input.Date || before.StartMinute != input.StartMinute || before.EndMinute != end || before.Guests != input.Guests
	tableID, label := before.TableID, before.TableLabel
	locationName, locationAddress := before.LocationName, before.LocationAddress
	if changedSpace {
		tableID, label, err = chooseReservationSpace(ctx, tx, location, input.Date, input.StartMinute, end, input.Guests, &id)
		if err != nil {
			return core.Reservation{}, err
		}
		if before.LocationCode != location.Code {
			locationName, locationAddress = location.Name, location.Address
		}
	}
	guestName := before.ClientFirstName
	if before.Manual {
		guestName = input.GuestName
	}
	if !changedSpace && guestName == before.ClientFirstName {
		return *before, nil
	}
	_, err = tx.Exec(ctx, `UPDATE reservations SET location_code=$2,table_id=$3,reservation_date=$4,start_hour=$5,end_hour=$6,
		start_minute=$7,end_minute=$8,guests=$9,client_first_name=$10,location_name_snapshot=$11,location_address_snapshot=$12,
		table_label_snapshot=$13,version=version+1,updated_at=now() WHERE id=$1`,
		id, location.Code, tableID, input.Date, input.StartMinute/60, (end+59)/60, input.StartMinute, end, input.Guests,
		guestName, locationName, locationAddress, label)
	if err != nil {
		return core.Reservation{}, err
	}
	after, err := scanReservation(tx.QueryRow(ctx, `SELECT `+reservationSelectColumns+` FROM reservations r WHERE r.id=$1`, id))
	if err != nil {
		return core.Reservation{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "reservation.update", "reservation", &id, "", reservationAudit(*before), reservationAudit(*after)); err != nil {
		return core.Reservation{}, err
	}
	if changedSpace && before.ClientUserID != nil {
		_, err = tx.Exec(ctx, `INSERT INTO notification_jobs (reservation_id,recipient_kind,template,event_key)
			VALUES ($1,'client','reservation_rescheduled_by_admin',$2) ON CONFLICT (event_key,recipient_kind) DO NOTHING`,
			id, fmt.Sprintf("reservation:%s:rescheduled:%d", id, after.Version))
		if err != nil {
			return core.Reservation{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Reservation{}, err
	}
	return *after, nil
}
