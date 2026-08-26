CREATE TABLE IF NOT EXISTS telegram_environment_preferences (
  telegram_user_id bigint PRIMARY KEY,
  sandbox_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
