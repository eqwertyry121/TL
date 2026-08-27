CREATE TABLE IF NOT EXISTS client_app_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_app_visits_visited_user
  ON client_app_visits(visited_at, user_id);

-- Retained client sessions give us a best-effort baseline. Exact visit history
-- starts with this migration because old expired sessions are regularly removed.
INSERT INTO client_app_visits (user_id, visited_at)
SELECT user_id, created_at
FROM sessions
WHERE audience = 'client' AND active_role = 'CLIENT';
