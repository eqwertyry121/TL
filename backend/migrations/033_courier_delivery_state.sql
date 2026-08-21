ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS courier_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_courier_delivery
    ON orders (courier_started_at, ready_at)
    WHERE fulfillment_status = 'OUT_FOR_DELIVERY';
