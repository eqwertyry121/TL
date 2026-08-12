CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_one_active_courier
ON staff ((role))
WHERE role='COURIER' AND active=true;
