UPDATE categories
SET title_ru = 'Комбо',
    title_sr = 'Kombo',
    title_en = 'Combos',
    updated_at = now()
WHERE id = '66666666-6666-6666-6666-666666666001';

UPDATE menu_items
SET title_ru = combo_values.title,
    title_sr = combo_values.title,
    title_en = combo_values.title,
    description_ru = combo_values.description_ru,
    description_sr = combo_values.description_sr,
    description_en = combo_values.description_en,
    version = menu_items.version + 1,
    updated_at = now()
FROM (VALUES
  (
    '77777777-7777-7777-7777-777777777001'::uuid,
    'FAMILY BOX',
    '12 мясных + 12 сырных хинкали • хачапури по-мегрельски • Натахтари 1 л',
    '12 mesnih + 12 sirnih hinkalija • megrelijski hačapuri • Natakhtari 1 l',
    '12 beef + 12 cheese khinkali • Megrelian khachapuri • Natakhtari 1 L'
  ),
  (
    '77777777-7777-7777-7777-777777777002'::uuid,
    'SOLO BOX',
    '5 мясных хинкали • хачапури по-аджарски • Натахтари 0,5 л',
    '5 mesnih hinkalija • adžarski hačapuri • Natakhtari 0,5 l',
    '5 beef khinkali • Adjarian khachapuri • Natakhtari 0.5 L'
  ),
  (
    '77777777-7777-7777-7777-777777777003'::uuid,
    'DUO BOX',
    '5 мясных + 5 сырных хинкали • 2 оджахури • грузинский салат • 2 Coca-Cola 0,5 л',
    '5 mesnih + 5 sirnih hinkalija • 2 odžahurija • gruzijska salata • 2 Coca-Cole 0,5 l',
    '5 beef + 5 cheese khinkali • 2 ojakhuri • Georgian salad • 2 Coca-Cola 0.5 L'
  ),
  (
    '77777777-7777-7777-7777-777777777004'::uuid,
    'SWEET BOX',
    '2 медовика • 2 десерта «Шоколад-вишня»',
    '2 medovika • 2 deserta čokolada-višnja',
    '2 honey cakes • 2 chocolate-cherry desserts'
  ),
  (
    '77777777-7777-7777-7777-777777777005'::uuid,
    'VEGGIE BOX',
    'Лобио • рулетики из баклажана • грузинский салат • Borjomi 0,5 л',
    'Lobio • rolnice od patlidžana • gruzijska salata • Borjomi 0,5 l',
    'Lobio • eggplant rolls • Georgian salad • Borjomi 0.5 L'
  )
) AS combo_values(id, title, description_ru, description_sr, description_en)
WHERE menu_items.id = combo_values.id;

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
