-- Fixed combo products for the test menu. The complete preparation contents
-- stay in the title because Kitchen order cards intentionally display only the
-- immutable order-item title snapshot.

INSERT INTO categories (id, title_ru, title_sr, title_en, sort_order, visible, archived, updated_at)
VALUES (
  '66666666-6666-6666-6666-666666666001',
  'Комбо-наборы', 'Kombo obroci', 'Combo meals', 1, true, false, now()
)
ON CONFLICT (id) DO UPDATE
SET title_ru = EXCLUDED.title_ru,
    title_sr = EXCLUDED.title_sr,
    title_en = EXCLUDED.title_en,
    sort_order = EXCLUDED.sort_order,
    visible = true,
    archived = false,
    updated_at = now();

INSERT INTO menu_items (
  id, category_id, title_ru, title_sr, title_en,
  description_ru, description_sr, description_en,
  price_minor, currency, photo_path, weight_text, min_quantity,
  allergen_text_ru, allergen_text_sr, allergen_text_en,
  sort_order, visible, archived, updated_at
)
VALUES
  (
    '77777777-7777-7777-7777-777777777001',
    '66666666-6666-6666-6666-666666666001',
    'FAMILY SUPRA 24 — 12 хинкали с мясом + 12 с сыром + мегрельский хачапури + Натахтари 1 л',
    'FAMILY SUPRA 24 — 12 hinkalija sa mesom + 12 sa sirom + megrelijski hačapuri + Natakhtari 1 l',
    'FAMILY SUPRA 24 — 12 beef khinkali + 12 cheese khinkali + Megrelian khachapuri + Natakhtari 1 L',
    'Семейное грузинское застолье. Отдельно 7620 RSD, в комбо экономия 830 RSD.',
    'Porodična gruzijska trpeza. Odvojeno 7620 RSD, ušteda u kombu 830 RSD.',
    'A Georgian family feast. 7620 RSD separately; save 830 RSD with the combo.',
    6790, 'RSD', '', 'на 4–5 человек', 1,
    '', '', '',
    10, true, false, now()
  ),
  (
    '77777777-7777-7777-7777-777777777002',
    '66666666-6666-6666-6666-666666666001',
    'SOLO XL — 5 хинкали с мясом + аджарский хачапури + Натахтари 0,5 л',
    'SOLO XL — 5 hinkalija sa mesom + adžarski hačapuri + Natakhtari 0,5 l',
    'SOLO XL — 5 beef khinkali + Adjarian khachapuri + Natakhtari 0.5 L',
    'Для одного очень голодного гостя. Отдельно 2758 RSD, в комбо экономия 368 RSD.',
    'Za jednu veoma gladnu osobu. Odvojeno 2758 RSD, ušteda u kombu 368 RSD.',
    'For one very hungry guest. 2758 RSD separately; save 368 RSD with the combo.',
    2390, 'RSD', '', 'на 1 человека', 1,
    '', '', '',
    20, true, false, now()
  ),
  (
    '77777777-7777-7777-7777-777777777003',
    '66666666-6666-6666-6666-666666666001',
    'DUO MAX — 5 хинкали с мясом + 5 с сыром + 2 оджахури + грузинский салат + 2 Coca-Cola 0,5 л',
    'DUO MAX — 5 hinkalija sa mesom + 5 sa sirom + 2 odžahurija + gruzijska salata + 2 Coca-Cole 0,5 l',
    'DUO MAX — 5 beef khinkali + 5 cheese khinkali + 2 ojakhuri + Georgian salad + 2 Coca-Cola 0.5 L',
    'Большой грузинский вечер для очень голодной пары или троих. Отдельно 6290 RSD, экономия 700 RSD.',
    'Veliko gruzijsko veče za veoma gladan par ili troje. Odvojeno 6290 RSD, ušteda 700 RSD.',
    'A large Georgian dinner for a very hungry couple or three guests. 6290 RSD separately; save 700 RSD.',
    5590, 'RSD', '', 'на 2–3 человек', 1,
    'грецкий орех', 'orah', 'walnut',
    30, true, false, now()
  ),
  (
    '77777777-7777-7777-7777-777777777004',
    '66666666-6666-6666-6666-666666666001',
    'SWEET BOX ×4 — 2 медовика + 2 десерта «Шоколад-вишня»',
    'SWEET BOX ×4 — 2 medovika + 2 deserta „čokolada-višnja”',
    'SWEET BOX ×4 — 2 honey cakes + 2 chocolate-cherry desserts',
    'Четыре десерта для двоих или компании. Отдельно 2520 RSD, экономия 270 RSD.',
    'Četiri deserta za dvoje ili društvo. Odvojeno 2520 RSD, ušteda 270 RSD.',
    'Four desserts for two or a group. 2520 RSD separately; save 270 RSD.',
    2250, 'RSD', '', '4 десерта', 1,
    '', '', '',
    40, true, false, now()
  ),
  (
    '77777777-7777-7777-7777-777777777005',
    '66666666-6666-6666-6666-666666666001',
    'VEGGIE BOX — лобио + рулетики из баклажана + грузинский салат + Borjomi 0,5 л',
    'VEGGIE BOX — lobio + rolnice od patlidžana + gruzijska salata + Borjomi 0,5 l',
    'VEGGIE BOX — lobio + eggplant rolls + Georgian salad + Borjomi 0.5 L',
    'Полный набор без мяса с минеральной водой Borjomi.',
    'Kompletan obrok bez mesa sa mineralnom vodom Borjomi.',
    'A complete meat-free meal with Borjomi mineral water.',
    1890, 'RSD', '', 'без мяса', 1,
    'грецкий орех', 'orah', 'walnut',
    50, true, false, now()
  )
ON CONFLICT (id) DO UPDATE
SET category_id = EXCLUDED.category_id,
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
