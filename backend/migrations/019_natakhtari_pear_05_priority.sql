-- Put the real Natakhtari pear 0.5 l recommendation first in the menu and
-- keep the 1 l bottle as a separate drink.

INSERT INTO menu_media (
  display_path, thumbnail_path, display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES
  ('/media/menu/natakhtari-pear-05l.jpg', '/media/menu/natakhtari-pear-05l_thumb.jpg', 960, 540, 39621, 'image/jpeg', 480, 270, 11378, 'image/jpeg')
ON CONFLICT (display_path) DO UPDATE
SET thumbnail_path = EXCLUDED.thumbnail_path,
    display_width = EXCLUDED.display_width,
    display_height = EXCLUDED.display_height,
    display_bytes = EXCLUDED.display_bytes,
    display_mime = EXCLUDED.display_mime,
    thumbnail_width = EXCLUDED.thumbnail_width,
    thumbnail_height = EXCLUDED.thumbnail_height,
    thumbnail_bytes = EXCLUDED.thumbnail_bytes,
    thumbnail_mime = EXCLUDED.thumbnail_mime;

UPDATE categories
SET sort_order = CASE id
    WHEN '33333333-3333-3333-3333-333333333006' THEN 1
    WHEN '33333333-3333-3333-3333-333333333001' THEN 10
    WHEN '33333333-3333-3333-3333-333333333002' THEN 20
    WHEN '33333333-3333-3333-3333-333333333003' THEN 30
    WHEN '33333333-3333-3333-3333-333333333004' THEN 40
    WHEN '33333333-3333-3333-3333-333333333005' THEN 50
    ELSE sort_order
  END,
  visible = true,
  archived = false,
  updated_at = now()
WHERE id IN (
  '33333333-3333-3333-3333-333333333001',
  '33333333-3333-3333-3333-333333333002',
  '33333333-3333-3333-3333-333333333003',
  '33333333-3333-3333-3333-333333333004',
  '33333333-3333-3333-3333-333333333005',
  '33333333-3333-3333-3333-333333333006'
);

UPDATE menu_items
SET title_ru = 'Натакхари с грушей 0.5 л',
    title_sr = 'Natakhtari sa kruskom 0.5 l',
    title_en = 'Natakhtari pear 0.5 l',
    description_ru = 'Рекомендация от разработчика: Грузинский газированный лимонад со вкусом груши.',
    description_sr = 'Preporuka developera: Gruzijsko gazirano pice sa ukusom kruske.',
    description_en = 'Chef''s recommendation: Georgian sparkling lemonade with pear flavor.',
    price_minor = 588,
    photo_path = '/media/menu/natakhtari-pear-05l.jpg',
    weight_text = '0.5 л',
    min_quantity = 1,
    allergen_text_ru = '',
    allergen_text_sr = '',
    allergen_text_en = '',
    sort_order = 1,
    visible = true,
    archived = false,
    version = version + 1,
    updated_at = now()
WHERE id = '44444444-4444-4444-4444-444444444013';

INSERT INTO menu_items (
  id, category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
  price_minor, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en,
  sort_order, visible, archived, updated_at
)
VALUES
  ('44444444-4444-4444-4444-444444444021', '33333333-3333-3333-3333-333333333006', 'Натакхари с грушей 1 л', 'Natakhtari sa kruskom 1 l', 'Natakhtari pear 1 l', 'Грузинский газированный лимонад со вкусом груши.', 'Gruzijsko gazirano pice sa ukusom kruske.', 'Georgian sparkling lemonade with pear flavor.', 910, '/media/menu/natakhtari-pear-1l.jpg', '1 л', 1, '', '', '', 20, true, false, now())
ON CONFLICT (id) DO UPDATE
SET category_id = EXCLUDED.category_id,
    title_ru = EXCLUDED.title_ru,
    title_sr = EXCLUDED.title_sr,
    title_en = EXCLUDED.title_en,
    description_ru = EXCLUDED.description_ru,
    description_sr = EXCLUDED.description_sr,
    description_en = EXCLUDED.description_en,
    price_minor = EXCLUDED.price_minor,
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

UPDATE menu_items
SET sort_order = CASE id
    WHEN '44444444-4444-4444-4444-444444444013' THEN 1
    WHEN '44444444-4444-4444-4444-444444444021' THEN 20
    WHEN '44444444-4444-4444-4444-444444444014' THEN 30
    WHEN '44444444-4444-4444-4444-444444444015' THEN 40
    WHEN '44444444-4444-4444-4444-444444444016' THEN 50
    WHEN '44444444-4444-4444-4444-444444444017' THEN 60
    WHEN '44444444-4444-4444-4444-444444444018' THEN 70
    WHEN '44444444-4444-4444-4444-444444444019' THEN 80
    WHEN '44444444-4444-4444-4444-444444444020' THEN 90
    ELSE sort_order
  END,
  updated_at = now()
WHERE id IN (
  '44444444-4444-4444-4444-444444444013',
  '44444444-4444-4444-4444-444444444014',
  '44444444-4444-4444-4444-444444444015',
  '44444444-4444-4444-4444-444444444016',
  '44444444-4444-4444-4444-444444444017',
  '44444444-4444-4444-4444-444444444018',
  '44444444-4444-4444-4444-444444444019',
  '44444444-4444-4444-4444-444444444020',
  '44444444-4444-4444-4444-444444444021'
);

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
