-- Use the stable Telegram identity so a new session or recreated user record
-- cannot accidentally clear an order restriction.
CREATE TABLE order_blocked_telegram_users (
  telegram_user_id bigint PRIMARY KEY CHECK (telegram_user_id > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  reason text NOT NULL DEFAULT ''
);

CREATE FUNCTION reject_blocked_order_client() RETURNS trigger AS $$
DECLARE
  client_telegram_id bigint;
BEGIN
  -- Serialize an in-flight order with an administrative block that locks the
  -- same user row before inserting the restriction.
  SELECT telegram_user_id INTO client_telegram_id
  FROM users WHERE id = NEW.client_user_id FOR SHARE;

  IF EXISTS (SELECT 1 FROM order_blocked_telegram_users WHERE telegram_user_id = client_telegram_id) THEN
    RAISE EXCEPTION 'Unable to process order' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reject_blocked_order_client_before_order
BEFORE INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION reject_blocked_order_client();

CREATE TRIGGER reject_blocked_order_client_before_addition
BEFORE INSERT ON order_additions
FOR EACH ROW EXECUTE FUNCTION reject_blocked_order_client();
