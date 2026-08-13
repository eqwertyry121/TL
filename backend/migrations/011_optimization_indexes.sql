CREATE INDEX IF NOT EXISTS idx_orders_created_desc
ON orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_phone_hash
ON orders(phone_hash)
WHERE phone_hash <> '';

CREATE INDEX IF NOT EXISTS idx_order_items_order_sort
ON order_items(order_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_order_events_order_created
ON order_events(order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
ON audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_calculation_tokens_expires
ON calculation_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
ON idempotency_keys(expires_at);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_done_updated
ON notification_jobs(status, updated_at)
WHERE status IN ('sent', 'failed');

CREATE INDEX IF NOT EXISTS idx_cash_location_challenges_expires
ON cash_location_challenges(expires_at);

UPDATE menu_items
SET photo_path='', updated_at=now(), version=version+1
WHERE photo_path LIKE 'fixtures/%';
