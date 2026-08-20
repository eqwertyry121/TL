-- Keep Natakhtari pear inside the Drinks category instead of pinning it above the menu.

WITH changed AS (
  UPDATE menu_items
  SET description_ru = 'Грузинский газированный лимонад со вкусом груши.',
      description_sr = 'Gruzijsko gazirano pice sa ukusom kruske.',
      description_en = 'Georgian sparkling lemonade with pear flavor.',
      category_id = '33333333-3333-3333-3333-333333333006',
      sort_order = 10,
      version = version + 1,
      updated_at = now()
  WHERE id = '44444444-4444-4444-4444-444444444013'
    AND (
      description_ru IS DISTINCT FROM 'Грузинский газированный лимонад со вкусом груши.'
      OR description_sr IS DISTINCT FROM 'Gruzijsko gazirano pice sa ukusom kruske.'
      OR description_en IS DISTINCT FROM 'Georgian sparkling lemonade with pear flavor.'
      OR category_id IS DISTINCT FROM '33333333-3333-3333-3333-333333333006'::uuid
      OR sort_order IS DISTINCT FROM 10
    )
  RETURNING 1
)
UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now()
WHERE EXISTS (SELECT 1 FROM changed);
