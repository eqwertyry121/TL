ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS delivery_timing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_min_lead_minutes integer NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS delivery_slot_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS delivery_max_orders_per_slot integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS delivery_last_target_time time NOT NULL DEFAULT '21:30';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_time_mode text NOT NULL DEFAULT 'ASAP',
  ADD COLUMN IF NOT EXISTS delivery_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_target_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_queue_delay_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_ready_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_ready_by uuid REFERENCES users(id);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_time_mode_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_delivery_time_mode_check
  CHECK (delivery_time_mode IN ('ASAP', 'SCHEDULED'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_timing_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_delivery_timing_check CHECK (
    (fulfillment_type='pickup' AND delivery_requested_at IS NULL AND delivery_target_at IS NULL)
    OR
    (fulfillment_type='delivery' AND (
      (delivery_time_mode='ASAP' AND delivery_requested_at IS NULL)
      OR
      (delivery_time_mode='SCHEDULED' AND delivery_requested_at IS NOT NULL)
    ))
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_orders_active_delivery_target
ON orders(delivery_target_at)
WHERE fulfillment_type='delivery'
  AND fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY')
  AND delivery_target_at IS NOT NULL;
