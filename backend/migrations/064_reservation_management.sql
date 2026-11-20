ALTER TABLE reservation_locations
  DROP CONSTRAINT reservation_locations_max_guests_check,
  ADD CONSTRAINT reservation_locations_max_guests_check CHECK (max_guests BETWEEN 1 AND 100),
  ADD COLUMN seat_capacity integer NOT NULL DEFAULT 0 CHECK (seat_capacity BETWEEN 0 AND 100),
  ADD COLUMN slot_step_minutes integer NOT NULL DEFAULT 15 CHECK (slot_step_minutes IN (15, 30, 60)),
  ADD COLUMN duration_minutes integer NOT NULL DEFAULT 120 CHECK (duration_minutes BETWEEN 15 AND 720 AND duration_minutes % 15 = 0),
  ADD COLUMN advance_days integer NOT NULL DEFAULT 7 CHECK (advance_days BETWEEN 1 AND 365),
  ADD COLUMN version integer NOT NULL DEFAULT 1;

UPDATE reservation_locations SET seat_capacity=21 WHERE code='podbara';

CREATE TABLE reservation_location_schedule (
  location_code text NOT NULL REFERENCES reservation_locations(code),
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open boolean NOT NULL DEFAULT true,
  first_start_minute integer NOT NULL DEFAULT 780 CHECK (first_start_minute BETWEEN 0 AND 1425 AND first_start_minute % 15 = 0),
  last_start_minute integer NOT NULL DEFAULT 1260 CHECK (last_start_minute BETWEEN 0 AND 1425 AND last_start_minute % 15 = 0),
  PRIMARY KEY (location_code, day_of_week),
  CHECK (last_start_minute >= first_start_minute)
);

INSERT INTO reservation_location_schedule (location_code, day_of_week)
SELECT location.code, day.day_of_week
FROM reservation_locations location CROSS JOIN generate_series(0, 6) AS day(day_of_week);

ALTER TABLE restaurant_tables DROP CONSTRAINT restaurant_tables_capacity_check,
  ADD CONSTRAINT restaurant_tables_capacity_check CHECK (capacity BETWEEN 1 AND 100);

ALTER TABLE reservations
  ALTER COLUMN client_user_id DROP NOT NULL,
  ADD COLUMN created_by_admin_user_id uuid REFERENCES users(id),
  ADD COLUMN start_minute integer,
  ADD COLUMN end_minute integer,
  ADD COLUMN location_name_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN location_address_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN table_label_snapshot text NOT NULL DEFAULT '';

UPDATE reservations r
SET start_minute=r.start_hour * 60, end_minute=r.end_hour * 60,
    location_name_snapshot=l.name, location_address_snapshot=l.address,
    table_label_snapshot=COALESCE((SELECT t.label FROM restaurant_tables t WHERE t.id=r.table_id), '')
FROM reservation_locations l WHERE l.code=r.location_code;

ALTER TABLE reservations
  ALTER COLUMN start_minute SET NOT NULL,
  ALTER COLUMN end_minute SET NOT NULL,
  DROP CONSTRAINT reservations_guests_check,
  ADD CONSTRAINT reservations_guests_check CHECK (guests BETWEEN 1 AND 100),
  ADD CONSTRAINT reservations_minute_check CHECK (
    start_minute BETWEEN 0 AND 1425 AND end_minute BETWEEN 15 AND 1440
    AND start_minute % 15 = 0 AND end_minute % 15 = 0 AND end_minute > start_minute
  ),
  ADD CONSTRAINT reservations_owner_check CHECK (
    (client_user_id IS NOT NULL AND created_by_admin_user_id IS NULL)
    OR (client_user_id IS NULL AND created_by_admin_user_id IS NOT NULL)
  );

CREATE UNIQUE INDEX idx_manual_reservation_idempotency
  ON reservations(created_by_admin_user_id, idempotency_key)
  WHERE client_user_id IS NULL;

CREATE INDEX idx_reservations_location_minutes
  ON reservations(location_code, reservation_date, start_minute, end_minute)
  WHERE status='CONFIRMED';
