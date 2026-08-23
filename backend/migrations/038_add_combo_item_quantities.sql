UPDATE menu_items
SET description_ru = combo_values.description_ru,
    description_sr = combo_values.description_sr,
    description_en = combo_values.description_en,
    version = menu_items.version + 1,
    updated_at = now()
FROM (VALUES
  (
    '77777777-7777-7777-7777-777777777001'::uuid,
    '12 × хинкали с мясом • 12 × хинкали с сыром • 1 × хачапури по-мегрельски • 1 × Натахтари 1 л',
    '12 × hinkalija sa mesom • 12 × hinkalija sa sirom • 1 × megrelijski hačapuri • 1 × Natakhtari 1 l',
    '12 × beef khinkali • 12 × cheese khinkali • 1 × Megrelian khachapuri • 1 × Natakhtari 1 L'
  ),
  (
    '77777777-7777-7777-7777-777777777002'::uuid,
    '5 × хинкали с мясом • 1 × хачапури по-аджарски • 1 × Натахтари 0,5 л',
    '5 × hinkalija sa mesom • 1 × adžarski hačapuri • 1 × Natakhtari 0,5 l',
    '5 × beef khinkali • 1 × Adjarian khachapuri • 1 × Natakhtari 0.5 L'
  ),
  (
    '77777777-7777-7777-7777-777777777003'::uuid,
    '5 × хинкали с мясом • 5 × хинкали с сыром • 2 × оджахури • 1 × грузинский салат • 2 × Coca-Cola 0,5 л',
    '5 × hinkalija sa mesom • 5 × hinkalija sa sirom • 2 × odžahuri • 1 × gruzijska salata • 2 × Coca-Cola 0,5 l',
    '5 × beef khinkali • 5 × cheese khinkali • 2 × ojakhuri • 1 × Georgian salad • 2 × Coca-Cola 0.5 L'
  ),
  (
    '77777777-7777-7777-7777-777777777004'::uuid,
    '2 × медовик • 2 × десерт «Шоколад-вишня»',
    '2 × medovik • 2 × desert čokolada-višnja',
    '2 × honey cake • 2 × chocolate-cherry dessert'
  ),
  (
    '77777777-7777-7777-7777-777777777005'::uuid,
    '1 × лобио • 1 × рулетики из баклажана • 1 × грузинский салат • 1 × Borjomi 0,5 л',
    '1 × lobio • 1 × rolnice od patlidžana • 1 × gruzijska salata • 1 × Borjomi 0,5 l',
    '1 × lobio • 1 × eggplant rolls • 1 × Georgian salad • 1 × Borjomi 0.5 L'
  )
) AS combo_values(id, description_ru, description_sr, description_en)
WHERE menu_items.id = combo_values.id;

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
