CREATE TABLE IF NOT EXISTS client_product_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN ('screen_view', 'click')),
  screen text NOT NULL,
  target text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_product_events_occurred
  ON client_product_events(occurred_at, event_name);

CREATE INDEX IF NOT EXISTS idx_client_product_events_user_occurred
  ON client_product_events(user_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_client_product_events_click_target
  ON client_product_events(target, occurred_at)
  WHERE event_name = 'click';
