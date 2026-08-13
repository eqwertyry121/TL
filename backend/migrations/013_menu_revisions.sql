ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS menu_revision bigint NOT NULL DEFAULT 1;

UPDATE app_settings
SET menu_revision = GREATEST(menu_revision, 1),
    version = GREATEST(version, 1);
