INSERT INTO menu_media (
  display_path, thumbnail_path,
  display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES (
  '/media/menu/supra-24-card.jpg', '/media/menu/supra-24-card_thumb.jpg',
  960, 640, 153112, 'image/jpeg',
  480, 320, 37509, 'image/jpeg'
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
SET title_ru = 'SUPRA 24',
    title_sr = 'SUPRA 24',
    title_en = 'SUPRA 24',
    description_ru = '12 × хинкали с мясом • 12 × хинкали с сыром • 1 × хачапури по-мегрельски • 1 × Натахтари виноград 1 л',
    description_sr = '12 × hinkalija sa mesom • 12 × hinkalija sa sirom • 1 × megrelijski hačapuri • 1 × Natakhtari grožđe 1 l',
    description_en = '12 × beef khinkali • 12 × cheese khinkali • 1 × Megrelian khachapuri • 1 × grape Natakhtari 1 L',
    photo_path = '/media/menu/supra-24-card.jpg',
    version = version + 1,
    updated_at = now()
WHERE id = '77777777-7777-7777-7777-777777777001';

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
