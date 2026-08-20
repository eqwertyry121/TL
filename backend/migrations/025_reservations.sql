CREATE TABLE IF NOT EXISTS restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO restaurant_tables (id, label, capacity, sort_order, active)
VALUES
  ('70000000-0000-0000-0000-000000000001', 'Стол №1', 5, 10, true),
  ('70000000-0000-0000-0000-000000000002', 'Стол №2', 5, 20, true)
ON CONFLICT (id) DO NOTHING;

CREATE SEQUENCE IF NOT EXISTS reservation_public_number_seq START 1;

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_number integer NOT NULL DEFAULT nextval('reservation_public_number_seq'),
  client_user_id uuid NOT NULL REFERENCES users(id),
  table_id uuid NOT NULL REFERENCES restaurant_tables(id),
  reservation_date date NOT NULL,
  start_hour integer NOT NULL CHECK (start_hour BETWEEN 0 AND 23),
  end_hour integer NOT NULL CHECK (end_hour BETWEEN 1 AND 24 AND end_hour > start_hour),
  guests integer NOT NULL CHECK (guests BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  client_username text NOT NULL DEFAULT '',
  client_first_name text NOT NULL DEFAULT '',
  locale text NOT NULL DEFAULT 'ru',
  idempotency_key text NOT NULL,
  cancelled_by_role text NOT NULL DEFAULT '',
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_reservations_client_active
  ON reservations(client_user_id, reservation_date, start_hour)
  WHERE status = 'CONFIRMED';

CREATE INDEX IF NOT EXISTS idx_reservations_date_time
  ON reservations(reservation_date, start_hour, table_id)
  WHERE status = 'CONFIRMED';

ALTER TABLE notification_jobs
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE notification_jobs
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES reservations(id) ON DELETE CASCADE;

ALTER TABLE notification_jobs
  DROP CONSTRAINT IF EXISTS notification_jobs_entity_check;

ALTER TABLE notification_jobs
  ADD CONSTRAINT notification_jobs_entity_check CHECK (
    (order_id IS NOT NULL AND reservation_id IS NULL)
    OR (order_id IS NULL AND reservation_id IS NOT NULL)
  );
