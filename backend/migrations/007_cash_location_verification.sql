ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS cash_location_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS restaurant_latitude numeric(9,6) NOT NULL DEFAULT 45.241970,
  ADD COLUMN IF NOT EXISTS restaurant_longitude numeric(9,6) NOT NULL DEFAULT 19.808807,
  ADD COLUMN IF NOT EXISTS cash_location_radius_meters integer NOT NULL DEFAULT 12000 CHECK (cash_location_radius_meters > 0),
  ADD COLUMN IF NOT EXISTS cash_location_ttl_seconds integer NOT NULL DEFAULT 180 CHECK (cash_location_ttl_seconds BETWEEN 30 AND 900),
  ADD COLUMN IF NOT EXISTS cash_location_max_accuracy_meters integer NOT NULL DEFAULT 200 CHECK (cash_location_max_accuracy_meters BETWEEN 10 AND 1500);

CREATE TABLE IF NOT EXISTS cash_location_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  telegram_user_id bigint NOT NULL,
  calculation_token_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'USED')),
  rejection_reason text NOT NULL DEFAULT '',
  prompt_message_id bigint,
  distance_meters integer CHECK (distance_meters >= 0),
  accuracy_meters integer CHECK (accuracy_meters >= 0),
  dev_bypass boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_location_challenges_user
  ON cash_location_challenges(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cash_location_challenges_telegram_active
  ON cash_location_challenges(telegram_user_id, created_at DESC)
  WHERE status IN ('PENDING', 'VERIFIED') AND used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_location_challenges_token
  ON cash_location_challenges(calculation_token_hash);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cash_location_challenge_id uuid REFERENCES cash_location_challenges(id),
  ADD COLUMN IF NOT EXISTS cash_location_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS cash_location_distance_meters integer CHECK (cash_location_distance_meters >= 0);

UPDATE app_settings
SET restaurant_latitude = 45.241970,
    restaurant_longitude = 19.808807,
    updated_at = now()
WHERE id = true
  AND restaurant_latitude = 0
  AND restaurant_longitude = 0;
