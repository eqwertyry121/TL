ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS terms_version text NOT NULL DEFAULT '2026-08-17',
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

UPDATE orders
SET terms_accepted_at = created_at
WHERE terms_accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_terminal_retention
ON orders(fulfillment_status, updated_at)
WHERE fulfillment_status IN ('DELIVERED', 'CANCELLED');

CREATE INDEX IF NOT EXISTS idx_users_phone_retention
ON users(updated_at)
WHERE phone_ciphertext <> '' OR phone_hash <> '' OR phone_verified_at IS NOT NULL;
