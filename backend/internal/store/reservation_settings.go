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

type reservationRowsQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func loadReservationSchedule(ctx context.Context, q reservationRowsQueryer, code string) ([7]core.ReservationScheduleDay, error) {
	var result [7]core.ReservationScheduleDay
	rows, err := q.Query(ctx, `SELECT day_of_week, is_open, first_start_minute, last_start_minute
		FROM reservation_location_schedule WHERE location_code=$1 ORDER BY day_of_week`, code)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var day core.ReservationScheduleDay
		if err := rows.Scan(&day.DayOfWeek, &day.IsOpen, &day.FirstStart, &day.LastStart); err != nil {
			return result, err
		}
		if day.DayOfWeek < 0 || day.DayOfWeek > 6 {
			return result, fmt.Errorf("invalid reservation schedule day")
		}
		result[day.DayOfWeek] = day
		count++
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	if count != 7 {
		return result, fmt.Errorf("incomplete reservation schedule")
	}
	return result, nil
}

type UpdateReservationSettingsInput struct {
	Name         string                        `json:"name"`
	Address      string                        `json:"address"`
	MaxGuests    int                           `json:"max_guests"`
	SeatCapacity int                           `json:"seat_capacity"`
	StepMinutes  int                           `json:"slot_step_minutes"`
	Duration     int                           `json:"duration_minutes"`
	AdvanceDays  int                           `json:"advance_days"`
	Version      int                           `json:"version"`
	Schedule     []core.ReservationScheduleDay `json:"schedule"`
}

func (s *Store) ReservationSettings(ctx context.Context, sess core.Session, code string) (core.ReservationLocationSettings, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.ReservationLocationSettings{}, core.ErrForbidden
	}
	location, err := scanReservationLocation(s.pool.QueryRow(ctx, `SELECT `+reservationLocationColumns+` FROM reservation_locations WHERE code=$1`, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return core.ReservationLocationSettings{}, core.ErrInvalidInput
	}
	if err != nil {
		return core.ReservationLocationSettings{}, err
	}
	schedule, err := loadReservationSchedule(ctx, s.pool, code)
	if err != nil {
		return core.ReservationLocationSettings{}, err
	}
	result := core.ReservationLocationSettings{Location: location, Schedule: schedule[:], Tables: []core.ReservationTable{}}
	if location.Mode != "tables" {
		return result, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT id, label, capacity, active FROM restaurant_tables ORDER BY sort_order, id`)
	if err != nil {
		return core.ReservationLocationSettings{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var table core.ReservationTable
		if err := rows.Scan(&table.ID, &table.Label, &table.Capacity, &table.Active); err != nil {
			return core.ReservationLocationSettings{}, err
		}
		result.Tables = append(result.Tables, table)
	}
	return result, rows.Err()
}

func (s *Store) UpdateReservationSettings(ctx context.Context, sess core.Session, code string, input UpdateReservationSettingsInput, now time.Time) (core.ReservationLocationSettings, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.ReservationLocationSettings{}, core.ErrForbidden
	}
	input.Name, input.Address = strings.TrimSpace(input.Name), strings.TrimSpace(input.Address)
	if input.Name == "" || len([]rune(input.Name)) > 80 || input.Address == "" || len([]rune(input.Address)) > 200 ||
		input.MaxGuests < 1 || input.MaxGuests > 100 || input.AdvanceDays < 1 || input.AdvanceDays > 365 ||
		(input.StepMinutes != 15 && input.StepMinutes != 30 && input.StepMinutes != 60) ||
		input.Duration < 15 || input.Duration > 720 || input.Duration%15 != 0 || input.Version < 1 || len(input.Schedule) != 7 {
		return core.ReservationLocationSettings{}, core.ErrInvalidInput
	}
	seen := [7]bool{}
	for _, day := range input.Schedule {
		if day.DayOfWeek < 0 || day.DayOfWeek > 6 || seen[day.DayOfWeek] || day.FirstStart < 0 || day.LastStart > 1425 || day.LastStart < day.FirstStart ||
			day.FirstStart%15 != 0 || day.LastStart%15 != 0 || (day.IsOpen && day.LastStart+input.Duration > 1440) {
			return core.ReservationLocationSettings{}, core.ErrInvalidInput
		}
		seen[day.DayOfWeek] = true
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.ReservationLocationSettings{}, err
	}
	defer rollback(ctx, tx)
	before, err := scanReservationLocation(tx.QueryRow(ctx, `SELECT `+reservationLocationColumns+` FROM reservation_locations WHERE code=$1 FOR UPDATE`, code))
	if errors.Is(err, pgx.ErrNoRows) {
		return core.ReservationLocationSettings{}, core.ErrInvalidInput
	}
	if err != nil {
		return core.ReservationLocationSettings{}, err
	}
	if before.Version != input.Version {
		return core.ReservationLocationSettings{}, core.ErrReservationSettingsConflict
	}
	if before.Mode == "seats" {
		if input.SeatCapacity < 1 || input.SeatCapacity > 100 || input.MaxGuests > input.SeatCapacity {
			return core.ReservationLocationSettings{}, core.ErrInvalidInput
		}
		if input.SeatCapacity < before.SeatCapacity {
			conflict, err := seatsExceedCapacity(ctx, tx, code, input.SeatCapacity, now)
			if err != nil {
				return core.ReservationLocationSettings{}, err
			}
			if conflict {
				return core.ReservationLocationSettings{}, core.ErrReservationCapacityConflict
			}
		}
	} else {
		input.SeatCapacity = 0
	}
	_, err = tx.Exec(ctx, `UPDATE reservation_locations SET name=$2, address=$3, max_guests=$4, seat_capacity=$5,
		slot_step_minutes=$6, duration_minutes=$7, advance_days=$8, version=version+1, updated_at=now() WHERE code=$1`,
		code, input.Name, input.Address, input.MaxGuests, input.SeatCapacity, input.StepMinutes, input.Duration, input.AdvanceDays)
	if err != nil {
		return core.ReservationLocationSettings{}, err
	}
	for _, day := range input.Schedule {
		if _, err := tx.Exec(ctx, `UPDATE reservation_location_schedule SET is_open=$3, first_start_minute=$4, last_start_minute=$5
			WHERE location_code=$1 AND day_of_week=$2`, code, day.DayOfWeek, day.IsOpen, day.FirstStart, day.LastStart); err != nil {
			return core.ReservationLocationSettings{}, err
		}
	}
	if err := s.insertAuditTx(ctx, tx, sess, "reservation_location.settings", "reservation_location", nil, "",
		map[string]any{"code": code, "version": before.Version},
		map[string]any{"code": code, "version": before.Version + 1, "max_guests": input.MaxGuests, "seat_capacity": input.SeatCapacity,
			"slot_step_minutes": input.StepMinutes, "duration_minutes": input.Duration, "advance_days": input.AdvanceDays, "schedule": input.Schedule}); err != nil {
		return core.ReservationLocationSettings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.ReservationLocationSettings{}, err
	}
	return s.ReservationSettings(ctx, sess, code)
}

func seatsExceedCapacity(ctx context.Context, tx pgx.Tx, code string, capacity int, now time.Time) (bool, error) {
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return false, err
	}
	localNow := now.In(loc)
	rows, err := tx.Query(ctx, `SELECT to_char(reservation_date, 'YYYY-MM-DD'), start_minute, end_minute, guests
		FROM reservations WHERE location_code=$1 AND status='CONFIRMED'
		AND (reservation_date > $2 OR (reservation_date=$2 AND end_minute > $3))`, code, localNow.Format("2006-01-02"), localNow.Hour()*60+localNow.Minute())
	if err != nil {
		return false, err
	}
	defer rows.Close()
	occupied := []reservationOccupied{}
	for rows.Next() {
		var booking reservationOccupied
		if err := rows.Scan(&booking.date, &booking.start, &booking.end, &booking.guests); err != nil {
			return false, err
		}
		occupied = append(occupied, booking)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	for _, booking := range occupied {
		if !reservationSeatsAvailable(booking.date, booking.start, booking.end, capacity, 0, occupied) {
			return true, nil
		}
	}
	return false, nil
}

type ReservationTableInput struct {
	Label    string `json:"label"`
	Capacity int    `json:"capacity"`
	Active   bool   `json:"active"`
}

func (s *Store) SaveReservationTable(ctx context.Context, sess core.Session, id *uuid.UUID, input ReservationTableInput, now time.Time) (core.ReservationTable, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return core.ReservationTable{}, core.ErrForbidden
	}
	input.Label = strings.TrimSpace(input.Label)
	if input.Label == "" || len([]rune(input.Label)) > 80 || input.Capacity < 1 || input.Capacity > 100 {
		return core.ReservationTable{}, core.ErrInvalidInput
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return core.ReservationTable{}, err
	}
	defer rollback(ctx, tx)
	// Telep is the only location with table-based bookings.
	if _, err := tx.Exec(ctx, `SELECT code FROM reservation_locations WHERE code='telep' FOR UPDATE`); err != nil {
		return core.ReservationTable{}, err
	}
	var table core.ReservationTable
	if id == nil {
		err = tx.QueryRow(ctx, `INSERT INTO restaurant_tables (label, capacity, active, sort_order)
			VALUES ($1,$2,$3,COALESCE((SELECT max(sort_order)+10 FROM restaurant_tables),10))
			RETURNING id,label,capacity,active`, input.Label, input.Capacity, input.Active).Scan(&table.ID, &table.Label, &table.Capacity, &table.Active)
	} else {
		var previous core.ReservationTable
		err = tx.QueryRow(ctx, `SELECT id,label,capacity,active FROM restaurant_tables WHERE id=$1 FOR UPDATE`, *id).
			Scan(&previous.ID, &previous.Label, &previous.Capacity, &previous.Active)
		if errors.Is(err, pgx.ErrNoRows) {
			return core.ReservationTable{}, core.ErrInvalidInput
		}
		if err != nil {
			return core.ReservationTable{}, err
		}
		if input.Capacity < previous.Capacity {
			loc, err := time.LoadLocation(reservationTimezone)
			if err != nil {
				return core.ReservationTable{}, err
			}
			localNow := now.In(loc)
			var conflict bool
			err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM reservations WHERE table_id=$1 AND status='CONFIRMED'
				AND guests>$2 AND (reservation_date>$3 OR (reservation_date=$3 AND end_minute>$4)))`,
				*id, input.Capacity, localNow.Format("2006-01-02"), localNow.Hour()*60+localNow.Minute()).Scan(&conflict)
			if err != nil {
				return core.ReservationTable{}, err
			}
			if conflict {
				return core.ReservationTable{}, core.ErrReservationCapacityConflict
			}
		}
		err = tx.QueryRow(ctx, `UPDATE restaurant_tables SET label=$2,capacity=$3,active=$4,updated_at=now()
			WHERE id=$1 RETURNING id,label,capacity,active`, *id, input.Label, input.Capacity, input.Active).
			Scan(&table.ID, &table.Label, &table.Capacity, &table.Active)
	}
	if err != nil {
		return core.ReservationTable{}, err
	}
	if err := s.insertAuditTx(ctx, tx, sess, "reservation_table.save", "restaurant_table", &table.ID, "", nil,
		map[string]any{"label": table.Label, "capacity": table.Capacity, "active": table.Active}); err != nil {
		return core.ReservationTable{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.ReservationTable{}, err
	}
	return table, nil
}
