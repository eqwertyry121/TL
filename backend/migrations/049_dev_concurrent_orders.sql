ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dev_concurrent_order boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS idx_orders_one_active_per_client;
CREATE UNIQUE INDEX idx_orders_one_active_per_client
ON orders(client_user_id)
WHERE fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP')
  AND dev_concurrent_order=false;
