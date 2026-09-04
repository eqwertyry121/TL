ALTER TABLE app_settings
  ALTER COLUMN support_text SET DEFAULT '@Tako_Lako_N';

UPDATE app_settings
SET support_text = '@Tako_Lako_N', version = version + 1, updated_at = now()
WHERE id = true AND support_text = '@Tako_Lako';
