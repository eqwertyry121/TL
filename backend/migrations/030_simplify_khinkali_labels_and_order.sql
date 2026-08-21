-- Keep khinkali labels concise and place the category after khachapuri/hot dishes.

UPDATE categories
SET sort_order = 15,
    updated_at = now()
WHERE id = '11111111-1111-1111-1111-111111111001';

UPDATE menu_items
SET title_ru = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Хинкали с мясом и кинзой'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Хинкали с мясом без кинзы'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Хинкали с сыром'
      ELSE title_ru
    END,
    title_sr = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Hinkali sa mesom i korijanderom'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Hinkali sa mesom bez korijandera'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Hinkali sa sirom'
      ELSE title_sr
    END,
    title_en = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Khinkali with meat and cilantro'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Khinkali with meat, no cilantro'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Khinkali with cheese'
      ELSE title_en
    END,
    description_ru = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Начинка: мясо и кинза. Цена за 1 шт., минимум 5 шт.'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Начинка: мясо, без кинзы. Цена за 1 шт., минимум 5 шт.'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Начинка: сыр. Цена за 1 шт., минимум 5 шт.'
      ELSE description_ru
    END,
    description_sr = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Nadev: meso i korijander. Cena je za 1 kom., minimum 5 kom.'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Nadev: meso, bez korijandera. Cena je za 1 kom., minimum 5 kom.'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Nadev: sir. Cena je za 1 kom., minimum 5 kom.'
      ELSE description_sr
    END,
    description_en = CASE id
      WHEN '55555555-5555-5555-5555-555555555001' THEN 'Filling: meat and cilantro. Price per piece, minimum 5 pieces.'
      WHEN '55555555-5555-5555-5555-555555555002' THEN 'Filling: meat, no cilantro. Price per piece, minimum 5 pieces.'
      WHEN '55555555-5555-5555-5555-555555555003' THEN 'Filling: cheese. Price per piece, minimum 5 pieces.'
      ELSE description_en
    END,
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
