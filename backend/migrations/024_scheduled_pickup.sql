ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS pickup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pickup_address text NOT NULL DEFAULT 'Tako Lako, Novi Sad',
  ADD COLUMN IF NOT EXISTS pickup_map_url text NOT NULL DEFAULT 'https://maps.google.com/?q=45.241970,19.808807',
  ADD COLUMN IF NOT EXISTS pickup_instructions_ru text NOT NULL DEFAULT 'Приходите к выбранному времени и назовите номер заказа.',
  ADD COLUMN IF NOT EXISTS pickup_instructions_sr text NOT NULL DEFAULT 'Dođite u izabrano vreme i recite broj porudžbine.',
  ADD COLUMN IF NOT EXISTS pickup_instructions_en text NOT NULL DEFAULT 'Come at the selected time and tell us your order number.',
  ADD COLUMN IF NOT EXISTS pickup_min_lead_minutes integer NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS pickup_slot_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS pickup_max_orders_per_slot integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS pickup_last_time time NOT NULL DEFAULT '22:00';

ALTER TABLE calculation_tokens
  ADD COLUMN IF NOT EXISTS pickup_at timestamptz;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS pickup_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_original_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_cook_at timestamptz,
  ADD COLUMN IF NOT EXISTS pickup_address_snapshot text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pickup_instructions_snapshot text NOT NULL DEFAULT '';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_fulfillment_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_fulfillment_status_check
  CHECK (fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED'));

-- Pickup used OUT_FOR_DELIVERY before it received a dedicated state.
UPDATE orders
SET fulfillment_status='READY_FOR_PICKUP', updated_at=now()
WHERE fulfillment_type='pickup' AND fulfillment_status='OUT_FOR_DELIVERY';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_schedule_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_pickup_schedule_check CHECK (
    (fulfillment_type = 'delivery' AND pickup_at IS NULL)
    OR
    (fulfillment_type = 'pickup' AND pickup_at IS NOT NULL)
  ) NOT VALID;

DROP INDEX IF EXISTS idx_orders_one_active_per_client;
CREATE UNIQUE INDEX idx_orders_one_active_per_client
ON orders(client_user_id)
WHERE fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP');

CREATE INDEX IF NOT EXISTS idx_orders_pickup_schedule
ON orders(pickup_at, fulfillment_status)
WHERE fulfillment_type='pickup' AND fulfillment_status IN ('NEW', 'READY_FOR_PICKUP');
