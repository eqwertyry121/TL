-- Replace the old development seed menu with the production menu recovered
-- from the Telegram export screenshots.

UPDATE menu_items
SET visible = false,
    archived = true,
    version = version + 1,
    updated_at = now()
WHERE id IN (
  '22222222-2222-2222-2222-222222222001',
  '22222222-2222-2222-2222-222222222002',
  '22222222-2222-2222-2222-222222222003',
  '22222222-2222-2222-2222-222222222004',
  '22222222-2222-2222-2222-222222222005',
  '22222222-2222-2222-2222-222222222006',
  '22222222-2222-2222-2222-222222222007',
  '22222222-2222-2222-2222-222222222008'
)
AND (visible = true OR archived = false);

UPDATE categories
SET visible = false,
    archived = true,
    updated_at = now()
WHERE id IN (
  '11111111-1111-1111-1111-111111111001',
  '11111111-1111-1111-1111-111111111002',
  '11111111-1111-1111-1111-111111111003',
  '11111111-1111-1111-1111-111111111004'
)
AND (visible = true OR archived = false);

INSERT INTO categories (id, title_ru, title_sr, title_en, sort_order, visible, archived, updated_at)
VALUES
  ('33333333-3333-3333-3333-333333333001', 'Хачапури и горячие блюда', 'Hacapuri i topla jela', 'Khachapuri and hot dishes', 10, true, false, now()),
  ('33333333-3333-3333-3333-333333333002', 'Соусы', 'Sosevi', 'Sauces', 20, true, false, now()),
  ('33333333-3333-3333-3333-333333333003', 'Супы', 'Supe', 'Soups', 30, true, false, now()),
  ('33333333-3333-3333-3333-333333333004', 'Салаты и закуски', 'Salate i predjela', 'Salads and appetizers', 40, true, false, now()),
  ('33333333-3333-3333-3333-333333333005', 'Десерты', 'Deserti', 'Desserts', 50, true, false, now()),
  ('33333333-3333-3333-3333-333333333006', 'Напитки', 'Pica', 'Drinks', 60, true, false, now())
ON CONFLICT (id) DO UPDATE
SET title_ru = EXCLUDED.title_ru,
    title_sr = EXCLUDED.title_sr,
    title_en = EXCLUDED.title_en,
    sort_order = EXCLUDED.sort_order,
    visible = true,
    archived = false,
    updated_at = now();

INSERT INTO menu_media (
  display_path, thumbnail_path, display_width, display_height, display_bytes, display_mime,
  thumbnail_width, thumbnail_height, thumbnail_bytes, thumbnail_mime
)
VALUES
  ('/media/menu/adzarski-hacapuri.jpg', '/media/menu/adzarski-hacapuri_thumb.jpg', 960, 540, 54577, 'image/jpeg', 480, 270, 15714, 'image/jpeg'),
  ('/media/menu/megrelski-hacapuri.jpg', '/media/menu/megrelski-hacapuri_thumb.jpg', 960, 540, 91718, 'image/jpeg', 480, 270, 25114, 'image/jpeg'),
  ('/media/menu/adzahuri-sa-mesom.jpg', '/media/menu/adzahuri-sa-mesom_thumb.jpg', 960, 540, 71535, 'image/jpeg', 480, 270, 21085, 'image/jpeg'),
  ('/media/menu/ckmeruli.jpg', '/media/menu/ckmeruli_thumb.jpg', 960, 540, 47954, 'image/jpeg', 480, 270, 15127, 'image/jpeg'),
  ('/media/menu/sacebeli.jpg', '/media/menu/sacebeli_thumb.jpg', 960, 539, 42953, 'image/jpeg', 480, 270, 13341, 'image/jpeg'),
  ('/media/menu/kremasti-sos-sa-belim-lukom.jpg', '/media/menu/kremasti-sos-sa-belim-lukom_thumb.jpg', 960, 540, 30994, 'image/jpeg', 480, 270, 9063, 'image/jpeg'),
  ('/media/menu/lobio-bez-mesa.jpg', '/media/menu/lobio-bez-mesa_thumb.jpg', 960, 540, 60381, 'image/jpeg', 480, 270, 17858, 'image/jpeg'),
  ('/media/menu/salata-tbilisi.jpg', '/media/menu/salata-tbilisi_thumb.jpg', 960, 540, 64152, 'image/jpeg', 480, 270, 19080, 'image/jpeg'),
  ('/media/menu/gruzijska-salata.jpg', '/media/menu/gruzijska-salata_thumb.jpg', 960, 540, 62417, 'image/jpeg', 480, 270, 18818, 'image/jpeg'),
  ('/media/menu/rolnice-od-patlidzana.jpg', '/media/menu/rolnice-od-patlidzana_thumb.jpg', 960, 540, 56827, 'image/jpeg', 480, 270, 17317, 'image/jpeg'),
  ('/media/menu/medovik.jpg', '/media/menu/medovik_thumb.jpg', 960, 539, 63123, 'image/jpeg', 480, 270, 18284, 'image/jpeg'),
  ('/media/menu/kolac-krompir.jpg', '/media/menu/kolac-krompir_thumb.jpg', 960, 540, 40674, 'image/jpeg', 480, 270, 11257, 'image/jpeg'),
  ('/media/menu/natakhtari-pear-1l.jpg', '/media/menu/natakhtari-pear-1l_thumb.jpg', 960, 540, 40294, 'image/jpeg', 480, 270, 11595, 'image/jpeg'),
  ('/media/menu/natakhtari-grape-05l.jpg', '/media/menu/natakhtari-grape-05l_thumb.jpg', 960, 539, 40444, 'image/jpeg', 480, 270, 11558, 'image/jpeg'),
  ('/media/menu/kombucha.jpg', '/media/menu/kombucha_thumb.jpg', 960, 540, 40623, 'image/jpeg', 480, 270, 11773, 'image/jpeg')
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

INSERT INTO menu_items (
  id, category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
  price_minor, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en,
  sort_order, visible, archived, updated_at
)
VALUES
  ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333001', 'Аджарский хачапури', 'Adzarski hacapuri', 'Adjarian khachapuri', 'Лодочка с сыром и яйцом.', 'Oblik camca sa jajetom.', 'Boat-shaped cheese bread with egg.', 1120, '/media/menu/adzarski-hacapuri.jpg', '', 1, '', '', '', 10, true, false, now()),
  ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333001', 'Мегрельский хачапури', 'Megrelski hacapuri', 'Megrelian khachapuri', 'Круглый хачапури с сыром внутри и сверху.', 'Okrugli, sir unutra i odozgo.', 'Round cheese bread with cheese inside and on top.', 1190, '/media/menu/megrelski-hacapuri.jpg', '', 1, '', '', '', 20, true, false, now()),
  ('44444444-4444-4444-4444-444444444003', '33333333-3333-3333-3333-333333333001', 'Оджахури с мясом', 'Adzahuri sa mesom', 'Ojakhuri with meat', 'Говядина, картофель, красная паприка, зелень.', 'Govedina, krompir, crvena paprika, zelenilo.', 'Beef, potatoes, red pepper and herbs.', 1330, '/media/menu/adzahuri-sa-mesom.jpg', '', 1, '', '', '', 30, true, false, now()),
  ('44444444-4444-4444-4444-444444444004', '33333333-3333-3333-3333-333333333001', 'Чкмерули', 'Ckmeruli', 'Chkmeruli', 'Куриное мясо без кости в сливочно-чесночном соусе.', 'Pilece meso bez kosti u kremasto-belom sosu sa belim lukom.', 'Boneless chicken in creamy garlic sauce.', 1120, '/media/menu/ckmeruli.jpg', '', 1, '', '', '', 40, true, false, now()),
  ('44444444-4444-4444-4444-444444444005', '33333333-3333-3333-3333-333333333002', 'Сацебели', 'Sacebeli', 'Satsebeli', 'Томатная основа, специи, зелень.', 'Paradajz osnova, zacini, zelenilo.', 'Tomato base, spices and herbs.', 210, '/media/menu/sacebeli.jpg', '', 1, '', '', '', 10, true, false, now()),
  ('44444444-4444-4444-4444-444444444006', '33333333-3333-3333-3333-333333333002', 'Сливочно-чесночный соус', 'Kremasti sos sa belim lukom', 'Creamy garlic sauce', 'Сливочный соус с чесноком.', 'Kremasti sos sa belim lukom.', 'Creamy sauce with garlic.', 140, '/media/menu/kremasti-sos-sa-belim-lukom.jpg', '', 1, '', '', '', 20, true, false, now()),
  ('44444444-4444-4444-4444-444444444007', '33333333-3333-3333-3333-333333333003', 'Лобио без мяса', 'Lobio bez mesa', 'Meatless lobio', 'Фасолевый суп без мяса.', 'Lobio bez mesa.', 'Meatless bean soup.', 350, '/media/menu/lobio-bez-mesa.jpg', '', 1, '', '', '', 10, true, false, now()),
  ('44444444-4444-4444-4444-444444444008', '33333333-3333-3333-3333-333333333004', 'Салат «Тбилиси»', 'Salata „tbilisi”', 'Tbilisi salad', 'Говядина, фасоль, красная паприка, лук, грецкий орех, чеснок, зелень.', 'Govedina, pasulj, crvena paprika, luk, orah, beli luk, zelenilo.', 'Beef, beans, red pepper, onion, walnut, garlic and herbs.', 1050, '/media/menu/salata-tbilisi.jpg', '', 1, 'грецкий орех', 'orah', 'walnut', 10, true, false, now()),
  ('44444444-4444-4444-4444-444444444009', '33333333-3333-3333-3333-333333333004', 'Грузинский салат', 'Gruzijska salata', 'Georgian salad', 'Помидор, огурец, лук, грецкий орех, масло.', 'Paradajz, krastavac, luk, orah, ulje.', 'Tomato, cucumber, onion, walnut and oil.', 630, '/media/menu/gruzijska-salata.jpg', '', 1, 'грецкий орех', 'orah', 'walnut', 20, true, false, now()),
  ('44444444-4444-4444-4444-444444444010', '33333333-3333-3333-3333-333333333004', 'Рулетики из баклажана', 'Rolnice od patlidzana', 'Eggplant rolls', 'Ореховая начинка, зелень.', 'Orahov nadev, zelenilo.', 'Walnut filling and herbs.', 770, '/media/menu/rolnice-od-patlidzana.jpg', '', 1, 'грецкий орех', 'orah', 'walnut', 30, true, false, now()),
  ('44444444-4444-4444-4444-444444444011', '33333333-3333-3333-3333-333333333005', 'Медовик', 'Medovik', 'Honey cake', 'Медовые коржи и нежный крем.', 'Medene kore i nezan krem.', 'Honey layers and delicate cream.', 630, '/media/menu/medovik.jpg', '', 1, '', '', '', 10, true, false, now()),
  ('44444444-4444-4444-4444-444444444012', '33333333-3333-3333-3333-333333333005', 'Пирожное «Картошка»', 'Kolac „krompir”', 'Potato cake', 'Шоколадный десерт из бисквитной крошки и какао.', 'Cokoladni desert od biskvitnih mrvica i kakaa.', 'Chocolate dessert made with biscuit crumbs and cocoa.', 532, '/media/menu/kolac-krompir.jpg', '', 1, '', '', '', 20, true, false, now()),
  ('44444444-4444-4444-4444-444444444013', '33333333-3333-3333-3333-333333333006', 'Натакхари с грушей 1 л', 'Natakhtari sa kruskom 1 l', 'Natakhtari pear 1 l', 'Рекомендация от разработчика: Грузинский газированный лимонад со вкусом груши.', 'Preporuka developera: Gruzijsko gazirano pice sa ukusom kruske.', 'Chef''s recommendation: Georgian sparkling lemonade with pear flavor.', 910, '/media/menu/natakhtari-pear-1l.jpg', '1 л', 1, '', '', '', 10, true, false, now()),
  ('44444444-4444-4444-4444-444444444014', '33333333-3333-3333-3333-333333333006', 'Вода Rosa негазированная', 'Voda Rosa negazirana', 'Rosa still water', '', '', '', 140, '', '', 1, '', '', '', 20, true, false, now()),
  ('44444444-4444-4444-4444-444444444015', '33333333-3333-3333-3333-333333333006', 'Вода Knjaz Milos газированная', 'Voda Knjaz Milos gazirana', 'Knjaz Milos sparkling water', '', '', '', 280, '', '', 1, '', '', '', 30, true, false, now()),
  ('44444444-4444-4444-4444-444444444016', '33333333-3333-3333-3333-333333333006', 'Натакхари виноград 0.5 л', 'Natakhtari grozdje 0.5 l', 'Natakhtari grape 0.5 l', 'Грузинский газированный лимонад со вкусом винограда.', 'Gruzijsko gazirano pice sa ukusom grozdja.', 'Georgian sparkling lemonade with grape flavor.', 588, '/media/menu/natakhtari-grape-05l.jpg', '0.5 л', 1, '', '', '', 40, true, false, now()),
  ('44444444-4444-4444-4444-444444444017', '33333333-3333-3333-3333-333333333006', 'Комбуча', 'Kombuca', 'Kombucha', 'Холодный ферментированный чай.', 'Hladni fermentisani caj.', 'Cold fermented tea.', 868, '/media/menu/kombucha.jpg', '', 1, '', '', '', 50, true, false, now()),
  ('44444444-4444-4444-4444-444444444018', '33333333-3333-3333-3333-333333333006', 'Coca-Cola 0.33 л', 'Coca-Cola 0.33 l', 'Coca-Cola 0.33 l', '', '', '', 280, '', '0.33 л', 1, '', '', '', 60, true, false, now()),
  ('44444444-4444-4444-4444-444444444019', '33333333-3333-3333-3333-333333333006', 'Coca-Cola 0.5 л', 'Coca-Cola 0.5 l', 'Coca-Cola 0.5 l', '', '', '', 350, '', '0.5 л', 1, '', '', '', 70, true, false, now()),
  ('44444444-4444-4444-4444-444444444020', '33333333-3333-3333-3333-333333333006', 'Coca-Cola 1 л', 'Sok Gazirani Coca Cola 1 l', 'Coca-Cola 1 l', '', '', '', 460, '', '1 л', 1, '', '', '', 80, true, false, now())
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

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
