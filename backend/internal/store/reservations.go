package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/eqwertyry121/TL/backend/internal/core"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	reservationTimezone = "Europe/Belgrade"
	reservationDays     = 7 // Legacy admin bootstrap and notification window.
)

type CreateReservationInput struct {
	LocationCode string `json:"location_code"`
	Date         string `json:"date"`
	StartHour    int    `json:"start_hour"`
	StartMinute  *int   `json:"start_minute,omitempty"`
	Guests       int    `json:"guests"`
	Locale       string `json:"locale"`
}

const reservationLocationColumns = `code, name, address, max_guests, booking_mode, is_open,
	seat_capacity, slot_step_minutes, duration_minutes, advance_days, version`

func scanReservationLocation(row reservationScanner) (core.ReservationLocation, error) {
	var location core.ReservationLocation
	err := row.Scan(&location.Code, &location.Name, &location.Address, &location.MaxGuests, &location.Mode, &location.IsOpen,
		&location.SeatCapacity, &location.StepMinutes, &location.Duration, &location.AdvanceDays, &location.Version)
	return location, err
}

type reservationOccupied struct {
	date   string
	start  int
	end    int
	table  *uuid.UUID
	guests int
}

func (s *Store) ReservationLocations(ctx context.Context, sess core.Session) ([]core.ReservationLocation, error) {
	if sess.ActiveRole != core.RoleClient && sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `SELECT `+reservationLocationColumns+`
		FROM reservation_locations ORDER BY CASE code WHEN 'telep' THEN 0 ELSE 1 END, code`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	locations := []core.ReservationLocation{}
	for rows.Next() {
		location, err := scanReservationLocation(rows)
		if err != nil {
			return nil, err
		}
		locations = append(locations, location)
	}
	return locations, rows.Err()
}

func (s *Store) SetReservationLocationOpen(ctx context.Context, sess core.Session, code string, isOpen bool) (core.ReservationLocation, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.ReservationLocation{}, core.ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.ReservationLocation{}, err
	}
	defer rollback(ctx, tx)
	location, err := scanReservationLocation(tx.QueryRow(ctx, `SELECT `+reservationLocationColumns+` FROM reservation_locations WHERE code=$1 FOR UPDATE`, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return core.ReservationLocation{}, core.ErrInvalidInput
	}
	if err != nil {
		return core.ReservationLocation{}, err
	}
	if location.IsOpen != isOpen {
		if _, err := tx.Exec(ctx, `UPDATE reservation_locations SET is_open=$2, version=version+1, updated_at=now() WHERE code=$1`, code, isOpen); err != nil {
			return core.ReservationLocation{}, err
		}
		before := map[string]any{"code": code, "is_open": location.IsOpen}
		after := map[string]any{"code": code, "is_open": isOpen}
		if err := s.insertAuditTx(ctx, tx, sess, "reservation_location.update", "reservation_location", nil, "", before, after); err != nil {
			return core.ReservationLocation{}, err
		}
		location.IsOpen = isOpen
		location.Version++
	}
	if err := tx.Commit(ctx); err != nil {
		return core.ReservationLocation{}, err
	}
	return location, nil
}

func (s *Store) ReservationAvailability(ctx context.Context, sess core.Session, locationCode string, guests int, now time.Time) (core.ReservationAvailability, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.ReservationAvailability{}, core.ErrForbidden
	}
	locationCode = reservationLocationCode(locationCode)
	location, err := scanReservationLocation(s.pool.QueryRow(ctx, `SELECT `+reservationLocationColumns+` FROM reservation_locations WHERE code=$1`, locationCode))
	if errors.Is(err, pgx.ErrNoRows) {
		return core.ReservationAvailability{}, core.ErrInvalidInput
	}
	if err != nil {
		return core.ReservationAvailability{}, err
	}
	if guests < 1 || guests > location.MaxGuests {
		return core.ReservationAvailability{}, core.ErrInvalidInput
	}
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return core.ReservationAvailability{}, err
	}
	localNow := now.In(loc)
	startDate := localDate(localNow)
	endDate := startDate.AddDate(0, 0, location.AdvanceDays-1)
	schedule, err := loadReservationSchedule(ctx, s.pool, locationCode)
	if err != nil {
		return core.ReservationAvailability{}, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_minute, r.end_minute, r.table_id, r.guests
		FROM reservations r
		WHERE r.status='CONFIRMED' AND r.location_code=$1 AND r.reservation_date BETWEEN $2 AND $3
	`, locationCode, startDate.Format("2006-01-02"), endDate.Format("2006-01-02"))
	if err != nil {
		return core.ReservationAvailability{}, err
	}
	defer rows.Close()
	occupiedRows := []reservationOccupied{}
	for rows.Next() {
		var current reservationOccupied
		if err := rows.Scan(&current.date, &current.start, &current.end, &current.table, &current.guests); err != nil {
			return core.ReservationAvailability{}, err
		}
		occupiedRows = append(occupiedRows, current)
	}
	if err := rows.Err(); err != nil {
		return core.ReservationAvailability{}, err
	}

	tableRows, err := s.pool.Query(ctx, `
		SELECT id FROM restaurant_tables
		WHERE active=true AND capacity >= $1
		ORDER BY capacity, sort_order, id
	`, guests)
	if err != nil {
		return core.ReservationAvailability{}, err
	}
	defer tableRows.Close()
	tables := []uuid.UUID{}
	for tableRows.Next() {
		var id uuid.UUID
		if err := tableRows.Scan(&id); err != nil {
			return core.ReservationAvailability{}, err
		}
		tables = append(tables, id)
	}
	if err := tableRows.Err(); err != nil {
		return core.ReservationAvailability{}, err
	}

	result := core.ReservationAvailability{Timezone: reservationTimezone, Guests: guests, Days: []core.ReservationAvailabilityDay{}}
	for offset := 0; offset < location.AdvanceDays; offset++ {
		date := startDate.AddDate(0, 0, offset)
		day := core.ReservationAvailabilityDay{Date: date.Format("2006-01-02"), Hours: []int{}, Minutes: []int{}}
		daySchedule := schedule[int(date.Weekday())]
		if !location.IsOpen || !daySchedule.IsOpen {
			result.Days = append(result.Days, day)
			continue
		}
		for minute := daySchedule.FirstStart; minute <= daySchedule.LastStart && minute+location.Duration <= 1440; minute += location.StepMinutes {
			if offset == 0 && minute <= localNow.Hour()*60+localNow.Minute() {
				continue
			}
			available := reservationTableAvailable(day.Date, minute, minute+location.Duration, tables, occupiedRows)
			if location.Mode == "seats" {
				available = reservationSeatsAvailable(day.Date, minute, minute+location.Duration, location.SeatCapacity, guests, occupiedRows)
			}
			if available {
				day.Minutes = append(day.Minutes, minute)
				if minute%60 == 0 && location.Duration%60 == 0 {
					day.Hours = append(day.Hours, minute/60)
				}
			}
		}
		result.Days = append(result.Days, day)
	}
	return result, nil
}

func reservationTableAvailable(date string, start, end int, tables []uuid.UUID, occupiedRows []reservationOccupied) bool {
	for _, table := range tables {
		free := true
		for _, booking := range occupiedRows {
			if booking.date == date && booking.table != nil && *booking.table == table && start < booking.end && end > booking.start {
				free = false
				break
			}
		}
		if free {
			return true
		}
	}
	return false
}

// reservationSeatsAvailable checks every quarter-hour of the requested stay.
// Summing all overlaps would combine parties present at different times.
func reservationSeatsAvailable(date string, start, end, capacity, guests int, occupied []reservationOccupied) bool {
	for minute := start; minute < end; minute += 15 {
		used := 0
		for _, booking := range occupied {
			if booking.date == date && booking.start <= minute && booking.end > minute {
				used += booking.guests
			}
		}
		if used+guests > capacity {
			return false
		}
	}
	return true
}

func reservationLocationCode(code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return "telep" // Compatibility with clients released before location selection.
	}
	return code
}

func (s *Store) ActiveReservation(ctx context.Context, sess core.Session, now time.Time) (*core.Reservation, error) {
	if sess.ActiveRole != core.RoleClient {
		return nil, core.ErrForbidden
	}
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return nil, err
	}
	localNow := now.In(loc)
	reservation, err := scanReservation(s.pool.QueryRow(ctx, `SELECT `+reservationSelectColumns+` FROM reservations r
		WHERE r.client_user_id=$1 AND r.status='CONFIRMED'
			AND (r.reservation_date > $2 OR (r.reservation_date=$2 AND r.end_minute > $3))
		ORDER BY r.reservation_date, r.start_minute
		LIMIT 1
	`, sess.UserID, localNow.Format("2006-01-02"), localNow.Hour()*60+localNow.Minute()))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return reservation, err
}

func (s *Store) CancelReservation(ctx context.Context, sess core.Session, id uuid.UUID, admin bool) (core.Reservation, error) {
	if (!admin && sess.ActiveRole != core.RoleClient) || (admin && sess.ActiveRole != core.RoleAdmin) {
		return core.Reservation{}, core.ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.Reservation{}, err
	}
	defer rollback(ctx, tx)
	query := `SELECT ` + reservationSelectColumns + ` FROM reservations r WHERE r.id=$1`
	args := []any{id}
	if !admin {
		query += " AND r.client_user_id=$2"
		args = append(args, sess.UserID)
	}
	query += " FOR UPDATE OF r"
	before, err := scanReservation(tx.QueryRow(ctx, query, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return core.Reservation{}, core.ErrForbidden
	}
	if err != nil {
		return core.Reservation{}, err
	}
	if before.Status == core.ReservationCancelled {
		return *before, nil
	}
	role := "CLIENT"
	if admin {
		role = "ADMIN"
	}
	after, err := scanReservation(tx.QueryRow(ctx, `
		UPDATE reservations r
		SET status='CANCELLED', cancelled_by_role=$2, cancelled_at=now(), version=version+1, updated_at=now()
		WHERE r.id=$1
		RETURNING `+reservationSelectColumns, id, role))
	if err != nil {
		return core.Reservation{}, err
	}
	template := "reservation_cancelled_by_client"
	if admin {
		template = "reservation_cancelled_by_admin"
	}
	eventKey := fmt.Sprintf("reservation:%s:cancelled:%s", id, role)
	if admin && before.ClientUserID != nil {
		_, err = tx.Exec(ctx, `
			INSERT INTO notification_jobs (reservation_id, recipient_kind, template, event_key)
			VALUES ($1,'client',$2,$3)
			ON CONFLICT (event_key, recipient_kind) DO NOTHING
		`, id, template, eventKey)
	} else if !admin {
		err = insertReservationOwnerNotifications(ctx, tx, id, template, eventKey)
	}
	if err != nil {
		return core.Reservation{}, err
	}
	if admin {
		if err := s.insertAuditTx(ctx, tx, sess, "reservation.cancel", "reservation", &id, "", reservationAudit(*before), reservationAudit(*after)); err != nil {
			return core.Reservation{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Reservation{}, err
	}
	return *after, nil
}

func insertReservationOwnerNotifications(ctx context.Context, tx pgx.Tx, reservationID uuid.UUID, template, eventKey string) error {
	ownerIDs := make([]int64, 0, len(ownerTesterTelegramIDs))
	for telegramID := range ownerTesterTelegramIDs {
		ownerIDs = append(ownerIDs, telegramID)
	}
	sort.Slice(ownerIDs, func(i, j int) bool { return ownerIDs[i] < ownerIDs[j] })
	for _, telegramID := range ownerIDs {
		ownerEventKey := eventKey + ":owner:" + strconv.FormatInt(telegramID, 10)
		if _, err := tx.Exec(ctx, `
			INSERT INTO notification_jobs (reservation_id, recipient_kind, template, event_key)
			VALUES ($1,'admin',$2,$3)
			ON CONFLICT (event_key, recipient_kind) DO NOTHING
		`, reservationID, template, ownerEventKey); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) AdminReservations(ctx context.Context, sess core.Session, now time.Time) ([]core.Reservation, error) {
	return s.adminReservationsBetween(ctx, sess, now, "")
}

func (s *Store) AdminReservationsOnDate(ctx context.Context, sess core.Session, now time.Time, date string) ([]core.Reservation, error) {
	return s.adminReservationsBetween(ctx, sess, now, date)
}

func (s *Store) adminReservationsBetween(ctx context.Context, sess core.Session, now time.Time, requestedDate string) ([]core.Reservation, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return nil, err
	}
	today := localDate(now.In(loc))
	from, to := today, today.AddDate(0, 0, reservationDays-1)
	if requestedDate != "" {
		date, err := time.ParseInLocation("2006-01-02", requestedDate, loc)
		if err != nil || date.Before(today.AddDate(-1, 0, 0)) || date.After(today.AddDate(1, 0, 0)) {
			return nil, core.ErrInvalidInput
		}
		from, to = date, date
	}
	query := `SELECT ` + reservationSelectColumns + ` FROM reservations r
		WHERE r.reservation_date BETWEEN $1 AND $2`
	args := []any{from.Format("2006-01-02"), to.Format("2006-01-02")}
	if requestedDate == "" {
		// Keep owner alerts working for bookings beyond the seven-day quick selector.
		query += ` OR (r.status='CONFIRMED' AND r.reservation_date > $2
			AND r.created_at >= $3::timestamptz - interval '24 hours' AND r.created_at <= $3::timestamptz)`
		args = append(args, now)
	}
	query += ` ORDER BY r.reservation_date, r.start_minute, r.public_number`
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []core.Reservation{}
	for rows.Next() {
		reservation, err := scanReservation(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *reservation)
	}
	return result, rows.Err()
}

type reservationScanner interface{ Scan(...any) error }

func scanReservation(row reservationScanner) (*core.Reservation, error) {
	var reservation core.Reservation
	if err := row.Scan(
		&reservation.ID, &reservation.PublicNumber, &reservation.ClientUserID, &reservation.ClientUsername,
		&reservation.ClientFirstName, &reservation.LocationCode, &reservation.LocationName, &reservation.LocationAddress,
		&reservation.TableID, &reservation.TableLabel, &reservation.Date,
		&reservation.StartHour, &reservation.EndHour, &reservation.StartMinute, &reservation.EndMinute, &reservation.Manual, &reservation.Guests, &reservation.Status,
		&reservation.Locale, &reservation.Version, &reservation.CreatedAt, &reservation.CancelledAt,
	); err != nil {
		return nil, err
	}
	return &reservation, nil
}

func localDate(value time.Time) time.Time {
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, value.Location())
}

func reservationLocale(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "sr", "sr-latn", "sr-rs", "sr_rs":
		return "sr"
	case "en", "en-us", "en-gb":
		return "en"
	default:
		return "ru"
	}
}

func reservationAudit(value core.Reservation) map[string]any {
	return map[string]any{
		"public_number": value.PublicNumber,
		"location_code": value.LocationCode,
		"date":          value.Date,
		"start_minute":  value.StartMinute,
		"end_minute":    value.EndMinute,
		"guests":        value.Guests,
		"status":        value.Status,
		"table":         value.TableLabel,
		"version":       value.Version,
	}
}
