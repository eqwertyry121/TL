-- Replace the khinkali photo with a cache-safe URL and remove duplicated price/minimum copy.

INSERT INTO menu_media (
  display_path, thumbnail_path,
  display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES (
  '/media/menu/khinkali-terracotta.jpg', '/media/menu/khinkali-terracotta_thumb.jpg',
  960, 540, 86355, 'image/jpeg',
  480, 270, 22786, 'image/jpeg'
)
ON CONFLICT (display_path) DO UPDATE SET
  thumbnail_path = EXCLUDED.thumbnail_path,
  display_width = EXCLUDED.display_width,
  display_height = EXCLUDED.display_height,
  display_bytes = EXCLUDED.display_bytes,
  display_mime = EXCLUDED.display_mime,
  thumbnail_width = EXCLUDED.thumbnail_width,
  thumbnail_height = EXCLUDED.thumbnail_height,
  thumbnail_bytes = EXCLUDED.thumbnail_bytes,
  thumbnail_mime = EXCLUDED.thumbnail_mime;

UPDATE menu_items
SET description_ru = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Начинка: мясо и кинза.'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Начинка: мясо, без кинзы.'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Начинка: сыр.'
      ELSE description_ru
    END,
    description_sr = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Nadev: meso i korijander.'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Nadev: meso, bez korijandera.'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Nadev: sir.'
      ELSE description_sr
    END,
    description_en = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Filling: meat and cilantro.'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Filling: meat, no cilantro.'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Filling: cheese.'
      ELSE description_en
    END,
    photo_path = '/media/menu/khinkali-terracotta.jpg',
    version = version + 1,
    updated_at = now()
WHERE id IN (
  '55555555-5555-5555-5555-555555555001',
  '55555555-5555-5555-5555-555555555002',
  '55555555-5555-5555-5555-555555555003'
);

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
