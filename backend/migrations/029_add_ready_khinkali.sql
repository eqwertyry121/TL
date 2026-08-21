-- Add three clearly distinguished ready-to-eat khinkali products.

INSERT INTO menu_media (
  display_path, thumbnail_path,
  display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES (
  '/media/menu/ready-khinkali.jpg', '/media/menu/ready-khinkali_thumb.jpg',
  960, 540, 83163, 'image/jpeg',
  480, 270, 24002, 'image/jpeg'
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

INSERT INTO categories (
  id, title_ru, title_sr, title_en, sort_order, visible, archived
)
VALUES (
  '11111111-1111-1111-1111-111111111001',
  'Хинкали', 'Hinkali', 'Khinkali', 5, true, false
)
ON CONFLICT (id) DO UPDATE SET
  title_ru = EXCLUDED.title_ru,
  title_sr = EXCLUDED.title_sr,
  title_en = EXCLUDED.title_en,
  sort_order = EXCLUDED.sort_order,
  visible = true,
  archived = false,
  updated_at = now();

INSERT INTO menu_items (
  id, category_id,
  title_ru, title_sr, title_en,
  description_ru, description_sr, description_en,
  price_minor, currency, photo_path, weight_text, min_quantity,
  allergen_text_ru, allergen_text_sr, allergen_text_en,
  sort_order, visible, archived
)
VALUES
  (
    '55555555-5555-5555-5555-555555555001',
    '11111111-1111-1111-1111-111111111001',
    'Хинкали с мясом и кинзой — готовые',
    'Hinkali sa mesom i korijanderom — gotovi',
    'Khinkali with meat and cilantro — ready',
    'ГОТОВЫЕ. Начинка: мясо и кинза. Цена за 1 шт., минимум 5 шт.',
    'GOTOVI. Nadev: meso i korijander. Cena je za 1 kom., minimum 5 kom.',
    'READY. Filling: meat and cilantro. Price per piece, minimum 5 pieces.',
    150, 'RSD', '/media/menu/ready-khinkali.jpg', '1 шт.', 5,
    '', '', '',
    10, true, false
  ),
  (
    '55555555-5555-5555-5555-555555555002',
    '11111111-1111-1111-1111-111111111001',
    'Хинкали с мясом без кинзы — готовые',
    'Hinkali sa mesom bez korijandera — gotovi',
    'Khinkali with meat, no cilantro — ready',
    'ГОТОВЫЕ. Начинка: мясо, без кинзы. Цена за 1 шт., минимум 5 шт.',
    'GOTOVI. Nadev: meso, bez korijandera. Cena je za 1 kom., minimum 5 kom.',
    'READY. Filling: meat, no cilantro. Price per piece, minimum 5 pieces.',
    150, 'RSD', '/media/menu/ready-khinkali.jpg', '1 шт.', 5,
    '', '', '',
    20, true, false
  ),
  (
    '55555555-5555-5555-5555-555555555003',
    '11111111-1111-1111-1111-111111111001',
    'Хинкали с сыром — готовые',
    'Hinkali sa sirom — gotovi',
    'Khinkali with cheese — ready',
    'ГОТОВЫЕ. Начинка: сыр. Цена за 1 шт., минимум 5 шт.',
    'GOTOVI. Nadev: sir. Cena je za 1 kom., minimum 5 kom.',
    'READY. Filling: cheese. Price per piece, minimum 5 pieces.',
    150, 'RSD', '/media/menu/ready-khinkali.jpg', '1 шт.', 5,
    'молоко', 'mleko', 'milk',
    30, true, false
  )
ON CONFLICT (id) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  title_ru = EXCLUDED.title_ru,
  title_sr = EXCLUDED.title_sr,
  title_en = EXCLUDED.title_en,
  description_ru = EXCLUDED.description_ru,
  description_sr = EXCLUDED.description_sr,
  description_en = EXCLUDED.description_en,
  price_minor = EXCLUDED.price_minor,
  currency = EXCLUDED.currency,
  photo_path = EXCLUDED.photo_path,
  weight_text = EXCLUDED.weight_text,
  min_quantity = EXCLUDED.min_quantity,
  allergen_text_ru = EXCLUDED.allergen_text_ru,
  allergen_text_sr = EXCLUDED.allergen_text_sr,
  allergen_text_en = EXCLUDED.allergen_text_en,
  sort_order = EXCLUDED.sort_order,
  visible = true,
  archived = false,
  version = menu_items.version + 1,
  updated_at = now();

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
