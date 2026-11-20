CREATE TABLE reservation_locations (
  code text PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL,
  max_guests integer NOT NULL CHECK (max_guests BETWEEN 1 AND 21),
  booking_mode text NOT NULL CHECK (booking_mode IN ('tables', 'seats')),
  is_open boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reservation_locations (code, name, address, max_guests, booking_mode)
VALUES
  ('telep', 'Telep', 'Koste Abraševića 49', 5, 'tables'),
  ('podbara', 'Podbara', 'Temerinska 44', 21, 'seats');

ALTER TABLE reservations
  ADD COLUMN location_code text NOT NULL DEFAULT 'telep' REFERENCES reservation_locations(code),
  ALTER COLUMN table_id DROP NOT NULL,
  DROP CONSTRAINT reservations_guests_check,
  ADD CONSTRAINT reservations_guests_check CHECK (guests BETWEEN 1 AND 21),
  ADD CONSTRAINT reservations_location_table_check CHECK (
    (location_code = 'telep' AND table_id IS NOT NULL)
    OR (location_code = 'podbara' AND table_id IS NULL)
  );

CREATE INDEX idx_reservations_location_date_time
  ON reservations(location_code, reservation_date, start_hour, end_hour)
  WHERE status = 'CONFIRMED';
