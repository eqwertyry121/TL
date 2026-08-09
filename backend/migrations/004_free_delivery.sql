ALTER TABLE app_settings
  ALTER COLUMN flat_delivery_fee_minor SET DEFAULT 0,
  ALTER COLUMN support_text SET DEFAULT '@Tako_Lako';

UPDATE app_settings
SET flat_delivery_fee_minor = 0,
    support_text = '@Tako_Lako',
    max_item_quantity = GREATEST(max_item_quantity, 99),
    updated_at = now()
WHERE id = true;

UPDATE menu_items
SET allergen_text_ru = '',
    allergen_text_sr = '',
    allergen_text_en = '',
    updated_at = now()
WHERE allergen_text_ru <> ''
   OR allergen_text_sr <> ''
   OR allergen_text_en <> '';
