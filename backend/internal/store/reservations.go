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

const (
	reservationTimezone  = "Europe/Belgrade"
	reservationDays      = 7
	reservationFirstHour = 13
	reservationLastHour  = 20
	reservationDuration  = 2
)

type CreateReservationInput struct {
	Date      string `json:"date"`
	StartHour int    `json:"start_hour"`
	Guests    int    `json:"guests"`
	Locale    string `json:"locale"`
}

type reservationOccupied struct {
	date  string
	start int
	end   int
	table uuid.UUID
}

func (s *Store) ReservationAvailability(ctx context.Context, sess core.Session, guests int, now time.Time) (core.ReservationAvailability, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.ReservationAvailability{}, core.ErrForbidden
	}
	if guests < 1 || guests > 5 {
		return core.ReservationAvailability{}, core.ErrInvalidInput
	}
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return core.ReservationAvailability{}, err
	}
	localNow := now.In(loc)
	startDate := localDate(localNow)
	endDate := startDate.AddDate(0, 0, reservationDays-1)

	rows, err := s.pool.Query(ctx, `
		SELECT to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_hour, r.end_hour, r.table_id
		FROM reservations r
		WHERE r.status='CONFIRMED' AND r.reservation_date BETWEEN $1 AND $2
	`, startDate.Format("2006-01-02"), endDate.Format("2006-01-02"))
	if err != nil {
		return core.ReservationAvailability{}, err
	}
	defer rows.Close()
	occupiedRows := []reservationOccupied{}
	for rows.Next() {
		var current reservationOccupied
		if err := rows.Scan(&current.date, &current.start, &current.end, &current.table); err != nil {
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
	for offset := 0; offset < reservationDays; offset++ {
		date := startDate.AddDate(0, 0, offset)
		day := core.ReservationAvailabilityDay{Date: date.Format("2006-01-02"), Hours: []int{}}
		if date.Weekday() == time.Monday {
			result.Days = append(result.Days, day)
			continue
		}
		for hour := reservationFirstHour; hour <= reservationLastHour; hour++ {
			if offset == 0 && hour <= localNow.Hour() {
				continue
			}
			if reservationHourAvailable(day.Date, hour, tables, occupiedRows) {
				day.Hours = append(day.Hours, hour)
			}
		}
		result.Days = append(result.Days, day)
	}
	return result, nil
}

func reservationHourAvailable(date string, hour int, tables []uuid.UUID, occupiedRows []reservationOccupied) bool {
	for _, table := range tables {
		free := true
		for _, booking := range occupiedRows {
			if booking.date == date && booking.table == table && hour < booking.end && hour+reservationDuration > booking.start {
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

func (s *Store) ActiveReservation(ctx context.Context, sess core.Session, now time.Time) (*core.Reservation, error) {
	if sess.ActiveRole != core.RoleClient {
		return nil, core.ErrForbidden
	}
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return nil, err
	}
	localNow := now.In(loc)
	reservation, err := scanReservation(s.pool.QueryRow(ctx, `
		SELECT r.id, r.public_number, r.client_user_id, r.client_username, r.client_first_name,
			r.table_id, t.label, to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_hour, r.end_hour,
			r.guests, r.status, r.locale, r.version, r.created_at, r.cancelled_at
		FROM reservations r
		JOIN restaurant_tables t ON t.id=r.table_id
		WHERE r.client_user_id=$1 AND r.status='CONFIRMED'
			AND (r.reservation_date > $2 OR (r.reservation_date=$2 AND r.end_hour > $3))
		ORDER BY r.reservation_date, r.start_hour
		LIMIT 1
	`, sess.UserID, localNow.Format("2006-01-02"), localNow.Hour()))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return reservation, err
}

func (s *Store) CreateReservation(ctx context.Context, sess core.Session, input CreateReservationInput, idempotencyKey string, now time.Time) (core.Reservation, error) {
	if sess.ActiveRole != core.RoleClient {
		return core.Reservation{}, core.ErrForbidden
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" || len(idempotencyKey) > 128 || input.Guests < 1 || input.Guests > 5 {
		return core.Reservation{}, core.ErrInvalidInput
	}
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return core.Reservation{}, err
	}
	localNow := now.In(loc)
	date, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(input.Date), loc)
	if err != nil || date.Weekday() == time.Monday || input.StartHour < reservationFirstHour || input.StartHour > reservationLastHour {
		return core.Reservation{}, core.ErrInvalidInput
	}
	today := localDate(localNow)
	if date.Before(today) || date.After(today.AddDate(0, 0, reservationDays-1)) || (date.Equal(today) && input.StartHour <= localNow.Hour()) {
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

	existing, err := scanReservation(tx.QueryRow(ctx, `
		SELECT r.id, r.public_number, r.client_user_id, r.client_username, r.client_first_name,
			r.table_id, t.label, to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_hour, r.end_hour,
			r.guests, r.status, r.locale, r.version, r.created_at, r.cancelled_at
		FROM reservations r JOIN restaurant_tables t ON t.id=r.table_id
		WHERE r.client_user_id=$1 AND r.idempotency_key=$2
	`, sess.UserID, idempotencyKey))
	if err == nil {
		if existing.Date != input.Date || existing.StartHour != input.StartHour || existing.Guests != input.Guests {
			return core.Reservation{}, core.ErrIdempotencyConflict
		}
		return *existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return core.Reservation{}, err
	}

	var activeExists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM reservations
			WHERE client_user_id=$1 AND status='CONFIRMED'
				AND (reservation_date > $2 OR (reservation_date=$2 AND end_hour > $3))
		)
	`, sess.UserID, today.Format("2006-01-02"), localNow.Hour()).Scan(&activeExists); err != nil {
		return core.Reservation{}, err
	}
	if activeExists {
		return core.Reservation{}, core.ErrActiveReservationExists
	}

	rows, err := tx.Query(ctx, `
		SELECT id, label
		FROM restaurant_tables
		WHERE active=true AND capacity >= $1
		ORDER BY capacity, sort_order, id
		FOR UPDATE
	`, input.Guests)
	if err != nil {
		return core.Reservation{}, err
	}
	type tableCandidate struct {
		id    uuid.UUID
		label string
	}
	tables := []tableCandidate{}
	for rows.Next() {
		var table tableCandidate
		if err := rows.Scan(&table.id, &table.label); err != nil {
			rows.Close()
			return core.Reservation{}, err
		}
		tables = append(tables, table)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return core.Reservation{}, err
	}

	var selected tableCandidate
	for _, table := range tables {
		var occupied bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM reservations
				WHERE table_id=$1 AND reservation_date=$2 AND status='CONFIRMED'
					AND $3 < end_hour AND $4 > start_hour
			)
		`, table.id, input.Date, input.StartHour, input.StartHour+reservationDuration).Scan(&occupied); err != nil {
			return core.Reservation{}, err
		}
		if !occupied {
			selected = table
			break
		}
	}
	if selected.id == uuid.Nil {
		return core.Reservation{}, core.ErrReservationUnavailable
	}

	locale := reservationLocale(input.Locale)
	reservation, err := scanReservation(tx.QueryRow(ctx, `
		INSERT INTO reservations (
			client_user_id, table_id, reservation_date, start_hour, end_hour, guests,
			client_username, client_first_name, locale, idempotency_key
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id, public_number, client_user_id, client_username, client_first_name,
			table_id, $11::text, to_char(reservation_date, 'YYYY-MM-DD'), start_hour, end_hour,
			guests, status, locale, version, created_at, cancelled_at
	`, sess.UserID, selected.id, input.Date, input.StartHour, input.StartHour+reservationDuration, input.Guests,
		safe(sess.Username), safe(sess.FirstName), locale, idempotencyKey, selected.label))
	if err != nil {
		return core.Reservation{}, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO notification_jobs (reservation_id, recipient_kind, template, event_key)
		VALUES
			($1, 'client', 'reservation_confirmed', $2),
			($1, 'admin', 'reservation_created', $2)
		ON CONFLICT (event_key, recipient_kind) DO NOTHING
	`, reservation.ID, fmt.Sprintf("reservation:%s:created", reservation.ID))
	if err != nil {
		return core.Reservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return core.Reservation{}, err
	}
	return *reservation, nil
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
	query := `
		SELECT r.id, r.public_number, r.client_user_id, r.client_username, r.client_first_name,
			r.table_id, t.label, to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_hour, r.end_hour,
			r.guests, r.status, r.locale, r.version, r.created_at, r.cancelled_at
		FROM reservations r JOIN restaurant_tables t ON t.id=r.table_id
		WHERE r.id=$1`
	args := []any{id}
	if !admin {
		query += " AND r.client_user_id=$2"
		args = append(args, sess.UserID)
	}
	query += " FOR UPDATE"
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
		FROM restaurant_tables t
		WHERE r.id=$1 AND t.id=r.table_id
		RETURNING r.id, r.public_number, r.client_user_id, r.client_username, r.client_first_name,
			r.table_id, t.label, to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_hour, r.end_hour,
			r.guests, r.status, r.locale, r.version, r.created_at, r.cancelled_at
	`, id, role))
	if err != nil {
		return core.Reservation{}, err
	}
	recipient := "admin"
	template := "reservation_cancelled_by_client"
	if admin {
		recipient = "client"
		template = "reservation_cancelled_by_admin"
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO notification_jobs (reservation_id, recipient_kind, template, event_key)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (event_key, recipient_kind) DO NOTHING
	`, id, recipient, template, fmt.Sprintf("reservation:%s:cancelled:%s", id, role))
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

func (s *Store) AdminReservations(ctx context.Context, sess core.Session, now time.Time) ([]core.Reservation, error) {
	if sess.ActiveRole != core.RoleAdmin {
		return nil, core.ErrForbidden
	}
	loc, err := time.LoadLocation(reservationTimezone)
	if err != nil {
		return nil, err
	}
	today := localDate(now.In(loc))
	rows, err := s.pool.Query(ctx, `
		SELECT r.id, r.public_number, r.client_user_id, r.client_username, r.client_first_name,
			r.table_id, t.label, to_char(r.reservation_date, 'YYYY-MM-DD'), r.start_hour, r.end_hour,
			r.guests, r.status, r.locale, r.version, r.created_at, r.cancelled_at
		FROM reservations r JOIN restaurant_tables t ON t.id=r.table_id
		WHERE r.reservation_date BETWEEN $1 AND $2
		ORDER BY r.reservation_date, r.start_hour, t.sort_order
	`, today.Format("2006-01-02"), today.AddDate(0, 0, reservationDays-1).Format("2006-01-02"))
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
		&reservation.ClientFirstName, &reservation.TableID, &reservation.TableLabel, &reservation.Date,
		&reservation.StartHour, &reservation.EndHour, &reservation.Guests, &reservation.Status,
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
		"date":          value.Date,
		"start_hour":    value.StartHour,
		"guests":        value.Guests,
		"status":        value.Status,
		"table":         value.TableLabel,
		"version":       value.Version,
	}
}
