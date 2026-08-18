ALTER TABLE calculation_tokens
  ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'delivery';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'calculation_tokens_fulfillment_type_check'
  ) THEN
    ALTER TABLE calculation_tokens
      ADD CONSTRAINT calculation_tokens_fulfillment_type_check CHECK (fulfillment_type IN ('delivery', 'pickup'));
  END IF;
END $$;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fulfillment_type text NOT NULL DEFAULT 'delivery';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_type_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_fulfillment_type_check CHECK (fulfillment_type IN ('delivery', 'pickup'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_pickup_zero_delivery_fee_check'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_pickup_zero_delivery_fee_check CHECK (fulfillment_type <> 'pickup' OR delivery_fee_minor = 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_type_status
ON orders(fulfillment_type, fulfillment_status, updated_at DESC);
