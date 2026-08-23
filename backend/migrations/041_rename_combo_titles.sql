UPDATE menu_items
SET title_ru = combo_titles.title,
    title_sr = combo_titles.title,
    title_en = combo_titles.title,
    version = menu_items.version + 1,
    updated_at = now()
FROM (VALUES
  ('77777777-7777-7777-7777-777777777002'::uuid, 'SOLO MODE'),
  ('77777777-7777-7777-7777-777777777003'::uuid, 'DOUBLE DATE'),
  ('77777777-7777-7777-7777-777777777004'::uuid, 'SWEET MIX'),
  ('77777777-7777-7777-7777-777777777005'::uuid, 'GREEN MIX')
) AS combo_titles(id, title)
WHERE menu_items.id = combo_titles.id;

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
