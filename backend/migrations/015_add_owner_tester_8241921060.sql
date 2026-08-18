DROP INDEX IF EXISTS uniq_staff_one_active_courier;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_one_active_courier
ON staff ((role))
WHERE role = 'COURIER'
  AND active = true
  AND telegram_user_id NOT IN (1048084234, 8241921060);

WITH owner_user AS (
  INSERT INTO users (telegram_user_id, username, first_name, language_code)
  VALUES (8241921060, 'owner_8241921060', 'Owner', 'ru')
  ON CONFLICT (telegram_user_id)
  DO UPDATE SET
    username = CASE WHEN users.username = '' THEN EXCLUDED.username ELSE users.username END,
    first_name = CASE WHEN users.first_name = '' THEN EXCLUDED.first_name ELSE users.first_name END,
    updated_at = now()
  RETURNING id, telegram_user_id
)
INSERT INTO staff (user_id, telegram_user_id, role, display_label, active, created_by)
SELECT owner_user.id, owner_user.telegram_user_id, roles.role, 'Owner 8241921060 ' || roles.role, true, owner_user.id
FROM owner_user
CROSS JOIN (VALUES ('ADMIN'), ('KITCHEN'), ('COURIER')) AS roles(role)
ON CONFLICT (telegram_user_id, role)
DO UPDATE SET
  user_id = EXCLUDED.user_id,
  display_label = EXCLUDED.display_label,
  active = true,
  updated_at = now();
