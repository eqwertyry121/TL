-- Restore the owner-requested badge without moving the drink out of menu order.

WITH changed AS (
  UPDATE menu_items
  SET description_ru = 'Рекомендация от разработчика: Грузинский газированный лимонад со вкусом груши.',
      description_sr = 'Preporuka developera: Gruzijsko gazirano pice sa ukusom kruske.',
      description_en = 'Chef''s recommendation: Georgian sparkling lemonade with pear flavor.',
      version = version + 1,
      updated_at = now()
  WHERE id = '44444444-4444-4444-4444-444444444013'
    AND (
      description_ru IS DISTINCT FROM 'Рекомендация от разработчика: Грузинский газированный лимонад со вкусом груши.'
      OR description_sr IS DISTINCT FROM 'Preporuka developera: Gruzijsko gazirano pice sa ukusom kruske.'
      OR description_en IS DISTINCT FROM 'Chef''s recommendation: Georgian sparkling lemonade with pear flavor.'
    )
  RETURNING 1
)
UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now()
WHERE EXISTS (SELECT 1 FROM changed);
