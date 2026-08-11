CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_one_active_per_client
ON orders(client_user_id)
WHERE fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY');
