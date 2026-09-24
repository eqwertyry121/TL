ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS delivery_enabled boolean NOT NULL DEFAULT true;
