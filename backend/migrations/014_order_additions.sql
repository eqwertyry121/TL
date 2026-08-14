CREATE TABLE IF NOT EXISTS order_additions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  client_user_id uuid NOT NULL REFERENCES users(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  subtotal_minor integer NOT NULL CHECK (subtotal_minor >= 0),
  currency text NOT NULL DEFAULT 'RSD',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS addition_id uuid REFERENCES order_additions(id);

ALTER TABLE calculation_tokens
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'order',
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'calculation_tokens_purpose_check'
  ) THEN
    ALTER TABLE calculation_tokens
      ADD CONSTRAINT calculation_tokens_purpose_check CHECK (purpose IN ('order', 'addition'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_additions_order_created
ON order_additions(order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_order_items_addition
ON order_items(addition_id)
WHERE addition_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calculation_tokens_order_purpose
ON calculation_tokens(order_id, purpose, expires_at);
