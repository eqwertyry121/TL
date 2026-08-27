ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS discount_percent smallint NOT NULL DEFAULT 0;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS discounted_price_minor integer GENERATED ALWAYS AS (
    ((price_minor::bigint * (100 - discount_percent) + 50) / 100)::integer
  ) STORED;

ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_discount_percent_check;
ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_discount_percent_check
  CHECK (discount_percent BETWEEN 0 AND 99);
