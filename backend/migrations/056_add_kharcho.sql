INSERT INTO menu_media (
  display_path, thumbnail_path,
  display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES (
  '/media/menu/kharcho.jpg', '/media/menu/kharcho_thumb.jpg',
  960, 540, 101956, 'image/jpeg',
  480, 270, 27307, 'image/jpeg'
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

INSERT INTO menu_items (
  id, category_id,
  title_ru, title_sr, title_en,
  description_ru, description_sr, description_en,
  price_minor, currency, photo_path, weight_text, min_quantity,
  allergen_text_ru, allergen_text_sr, allergen_text_en,
  sort_order, visible, archived
)
VALUES (
  '1011934b-be41-412d-b17c-27fe400945a9',
  '33333333-3333-3333-3333-333333333003',
  'Харчо', 'Harčo', 'Kharcho',
  'Густой бульон, мягкая говядина, специи и много зелени. Вкус насыщенный, порция сытная.',
  'Gust bujon, mekana govedina, začini i mnogo zelenila. Bogat ukus i zasitna porcija.',
  'Rich broth, tender beef, spices and plenty of herbs. Full-flavored and filling.',
  700, 'RSD', '/media/menu/kharcho.jpg', '', 1,
  '', '', '',
  20, true, false
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
