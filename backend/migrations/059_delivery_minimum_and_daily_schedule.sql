ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS delivery_minimum_order_minor integer NOT NULL DEFAULT 2000
  CHECK (delivery_minimum_order_minor >= 0);

UPDATE app_settings
SET delivery_minimum_order_minor = 2000,
    manual_day_off = false,
    version = version + 1,
    updated_at = now()
WHERE id = true
  AND (delivery_minimum_order_minor <> 2000 OR manual_day_off);

UPDATE restaurant_schedule
SET closed = false,
    open_time = '13:00',
    order_cutoff_time = '21:00',
    close_time = '22:00',
    version = version + 1,
    updated_at = now()
WHERE closed
   OR open_time <> '13:00'
   OR order_cutoff_time <> '21:00'
   OR close_time <> '22:00';
