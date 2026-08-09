ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS support_phone text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS terms_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS display_label text NOT NULL DEFAULT '';

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS after_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS restaurant_schedule (
  day_of_week smallint PRIMARY KEY CHECK (day_of_week BETWEEN 0 AND 6),
  closed boolean NOT NULL DEFAULT false,
  open_time time NOT NULL DEFAULT '13:00',
  order_cutoff_time time NOT NULL DEFAULT '21:00',
  close_time time NOT NULL DEFAULT '22:00',
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (open_time < order_cutoff_time AND order_cutoff_time <= close_time)
);

INSERT INTO restaurant_schedule (day_of_week, closed, open_time, order_cutoff_time, close_time)
VALUES
  (0, false, '13:00', '21:00', '22:00'),
  (1, true, '13:00', '21:00', '22:00'),
  (2, false, '13:00', '21:00', '22:00'),
  (3, false, '13:00', '21:00', '22:00'),
  (4, false, '13:00', '21:00', '22:00'),
  (5, false, '13:00', '21:00', '22:00'),
  (6, false, '13:00', '21:00', '22:00')
ON CONFLICT (day_of_week) DO NOTHING;

UPDATE staff
SET display_label = CASE
  WHEN display_label <> '' THEN display_label
  WHEN role = 'ADMIN' THEN 'Owner/Admin'
  ELSE role
END;
