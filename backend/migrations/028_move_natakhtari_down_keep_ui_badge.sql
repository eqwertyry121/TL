-- The recommendation is a UI badge, not a sorting command stored in description.

WITH changed AS (
  UPDATE menu_items
  SET description_ru = 'Грузинский газированный лимонад со вкусом груши.',
      description_sr = 'Gruzijsko gazirano pice sa ukusom kruske.',
      description_en = 'Georgian sparkling lemonade with pear flavor.',
      sort_order = 45,
      version = version + 1,
      updated_at = now()
  WHERE id = '44444444-4444-4444-4444-444444444013'
    AND (
      description_ru IS DISTINCT FROM 'Грузинский газированный лимонад со вкусом груши.'
      OR description_sr IS DISTINCT FROM 'Gruzijsko gazirano pice sa ukusom kruske.'
      OR description_en IS DISTINCT FROM 'Georgian sparkling lemonade with pear flavor.'
      OR sort_order IS DISTINCT FROM 45
    )
  RETURNING 1
)
UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now()
WHERE EXISTS (SELECT 1 FROM changed);
