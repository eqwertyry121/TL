UPDATE menu_items
SET price_minor = combo_prices.price_minor,
    version = menu_items.version + 1,
    updated_at = now()
FROM (VALUES
  ('77777777-7777-7777-7777-777777777001'::uuid, 6890),
  ('77777777-7777-7777-7777-777777777002'::uuid, 2490),
  ('77777777-7777-7777-7777-777777777003'::uuid, 5690),
  ('77777777-7777-7777-7777-777777777004'::uuid, 2290),
  ('77777777-7777-7777-7777-777777777005'::uuid, 2110)
) AS combo_prices(id, price_minor)
WHERE menu_items.id = combo_prices.id;

UPDATE menu_items
SET price_minor = 910,
    sort_order = 15,
    visible = true,
    archived = false,
    version = menu_items.version + 1,
    updated_at = now()
WHERE id = '44444444-4444-4444-4444-444444444021';

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
