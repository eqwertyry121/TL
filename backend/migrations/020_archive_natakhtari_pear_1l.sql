-- Drinks belong at the end of the normal menu order, while the client app pins
-- the single developer recommendation above the flat item list.

UPDATE categories
SET sort_order = CASE id
    WHEN '33333333-3333-3333-3333-333333333001' THEN 10
    WHEN '33333333-3333-3333-3333-333333333002' THEN 20
    WHEN '33333333-3333-3333-3333-333333333003' THEN 30
    WHEN '33333333-3333-3333-3333-333333333004' THEN 40
    WHEN '33333333-3333-3333-3333-333333333005' THEN 50
    WHEN '33333333-3333-3333-3333-333333333006' THEN 60
    ELSE sort_order
  END,
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
    sort_order = 10,
    visible = true,
    archived = false,
    version = version + 1,
    updated_at = now()
WHERE id = '44444444-4444-4444-4444-444444444013';

UPDATE menu_items
SET sort_order = CASE id
    WHEN '44444444-4444-4444-4444-444444444014' THEN 20
    WHEN '44444444-4444-4444-4444-444444444015' THEN 30
    WHEN '44444444-4444-4444-4444-444444444016' THEN 40
    WHEN '44444444-4444-4444-4444-444444444017' THEN 50
    WHEN '44444444-4444-4444-4444-444444444018' THEN 60
    WHEN '44444444-4444-4444-4444-444444444019' THEN 70
    WHEN '44444444-4444-4444-4444-444444444020' THEN 80
    ELSE sort_order
  END,
  updated_at = now()
WHERE id IN (
  '44444444-4444-4444-4444-444444444014',
  '44444444-4444-4444-4444-444444444015',
  '44444444-4444-4444-4444-444444444016',
  '44444444-4444-4444-4444-444444444017',
  '44444444-4444-4444-4444-444444444018',
  '44444444-4444-4444-4444-444444444019',
  '44444444-4444-4444-4444-444444444020'
);

UPDATE menu_items
SET visible = false,
    archived = true,
    version = version + 1,
    updated_at = now()
WHERE id = '44444444-4444-4444-4444-444444444021'
  AND (visible = true OR archived = false);

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
