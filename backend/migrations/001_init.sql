CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL UNIQUE,
  username text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  language_code text NOT NULL DEFAULT 'ru',
  phone_ciphertext text NOT NULL DEFAULT '',
  phone_hash text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  telegram_user_id bigint NOT NULL,
  role text NOT NULL CHECK (role IN ('KITCHEN', 'COURIER', 'ADMIN')),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telegram_user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_staff_user_active ON staff(user_id, active);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  telegram_user_id bigint NOT NULL,
  audience text NOT NULL CHECK (audience IN ('client', 'staff')),
  active_role text NOT NULL CHECK (active_role IN ('CLIENT', 'KITCHEN', 'COURIER', 'ADMIN')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_expires ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ru text NOT NULL,
  title_sr text NOT NULL,
  title_en text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id),
  title_ru text NOT NULL,
  title_sr text NOT NULL,
  title_en text NOT NULL,
  description_ru text NOT NULL DEFAULT '',
  description_sr text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  currency text NOT NULL DEFAULT 'RSD',
  photo_path text NOT NULL DEFAULT '',
  weight_text text NOT NULL DEFAULT '',
  allergen_text_ru text NOT NULL DEFAULT '',
  allergen_text_sr text NOT NULL DEFAULT '',
  allergen_text_en text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_visible ON menu_items(category_id, visible, archived, sort_order);

CREATE TABLE IF NOT EXISTS app_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  timezone text NOT NULL DEFAULT 'Europe/Belgrade',
  currency text NOT NULL DEFAULT 'RSD',
  manual_day_off boolean NOT NULL DEFAULT false,
  day_off_banner text NOT NULL DEFAULT 'ВЫХОДНОЙ',
  flat_delivery_fee_minor integer NOT NULL DEFAULT 0 CHECK (flat_delivery_fee_minor >= 0),
  support_text text NOT NULL DEFAULT '@Tako_Lako',
  max_item_quantity integer NOT NULL DEFAULT 10 CHECK (max_item_quantity > 0),
  max_comment_length integer NOT NULL DEFAULT 300 CHECK (max_comment_length > 0),
  cash_enabled boolean NOT NULL DEFAULT true,
  card_enabled boolean NOT NULL DEFAULT false,
  crypto_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS order_public_number_seq START WITH 100;

CREATE TABLE IF NOT EXISTS calculation_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  items_json jsonb NOT NULL,
  subtotal_minor integer NOT NULL CHECK (subtotal_minor >= 0),
  delivery_fee_minor integer NOT NULL CHECK (delivery_fee_minor >= 0),
  total_minor integer NOT NULL CHECK (total_minor >= 0),
  currency text NOT NULL DEFAULT 'RSD',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_number integer NOT NULL UNIQUE DEFAULT nextval('order_public_number_seq'),
  client_user_id uuid NOT NULL REFERENCES users(id),
  fulfillment_status text NOT NULL CHECK (fulfillment_status IN ('NEW', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card', 'crypto')),
  payment_status text NOT NULL CHECK (payment_status IN ('CASH_PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  subtotal_minor integer NOT NULL CHECK (subtotal_minor >= 0),
  delivery_fee_minor integer NOT NULL CHECK (delivery_fee_minor >= 0),
  total_minor integer NOT NULL CHECK (total_minor >= 0),
  currency text NOT NULL DEFAULT 'RSD',
  phone_ciphertext text NOT NULL,
  phone_hash text NOT NULL DEFAULT '',
  address_ciphertext text NOT NULL,
  customer_comment text NOT NULL DEFAULT '',
  locale text NOT NULL DEFAULT 'ru',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_client_created ON orders(client_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment ON orders(fulfillment_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id),
  snapshot_title text NOT NULL,
  unit_price_minor integer NOT NULL CHECK (unit_price_minor >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  line_total_minor integer NOT NULL CHECK (line_total_minor >= 0),
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  action text NOT NULL,
  actor_user_id uuid REFERENCES users(id),
  actor_role text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  request_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  operation text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  result_json jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, operation, key)
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('client', 'kitchen', 'courier', 'admin')),
  template text NOT NULL,
  event_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key, recipient_kind)
);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_due ON notification_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id),
  actor_role text NOT NULL DEFAULT '',
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  provider text NOT NULL DEFAULT '',
  provider_reference text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'created',
  amount_minor integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'RSD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  payload_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  payment_attempt_id uuid REFERENCES payment_attempts(id),
  amount_minor integer NOT NULL,
  status text NOT NULL DEFAULT 'created',
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
