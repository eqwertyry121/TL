ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS min_quantity integer NOT NULL DEFAULT 1 CHECK (min_quantity > 0);

UPDATE menu_items
SET title_ru = 'Классические хинкали',
    title_sr = 'Klasicni hinkali',
    title_en = 'Classic khinkali',
    description_ru = 'Замороженные хинкали с говядиной и зеленью. Минимум 5 шт',
    description_sr = 'Zamrznuti hinkali sa govedinom i zacinima. Minimum 5 kom',
    description_en = 'Frozen khinkali with beef and herbs. Minimum 5 pcs',
    weight_text = 'от 5 шт',
    min_quantity = 5,
    updated_at = now()
WHERE id = '22222222-2222-2222-2222-222222222001';

UPDATE menu_items
SET title_ru = 'Хинкали без кинзы',
    title_sr = 'Hinkali bez korijandera',
    title_en = 'Khinkali without cilantro',
    description_ru = 'Замороженные хинкали с говядиной без кинзы. Минимум 5 шт',
    description_sr = 'Zamrznuti hinkali sa govedinom bez korijandera. Minimum 5 kom',
    description_en = 'Frozen beef khinkali without cilantro. Minimum 5 pcs',
    weight_text = 'от 5 шт',
    min_quantity = 5,
    updated_at = now()
WHERE id = '22222222-2222-2222-2222-222222222002';

UPDATE menu_items
SET min_quantity = 1
WHERE id NOT IN (
  '22222222-2222-2222-2222-222222222001',
  '22222222-2222-2222-2222-222222222002'
)
AND min_quantity < 1;
