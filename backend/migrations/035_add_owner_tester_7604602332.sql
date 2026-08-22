DROP INDEX IF EXISTS uniq_staff_one_active_courier;

CREATE UNIQUE INDEX uniq_staff_one_active_courier
ON staff ((role))
WHERE role = 'COURIER'
  AND active = true
  AND telegram_user_id NOT IN (1048084234, 8241921060, 8609105840, 7604602332);
