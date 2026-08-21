ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS kitchen_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_kitchen_preparation
  ON orders (fulfillment_type, kitchen_started_at, created_at)
  WHERE fulfillment_status = 'NEW';
