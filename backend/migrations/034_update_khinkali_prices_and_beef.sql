-- Update the current khinkali prices and make the meat filling unambiguous.

UPDATE menu_items
SET price_minor = 210,
    description_ru = 'Начинка: только говядина и кинза.',
    description_sr = 'Nadev: samo govedina i korijander.',
    description_en = 'Filling: beef only and cilantro.',
    version = version + 1,
    updated_at = now()
WHERE id = '55555555-5555-5555-5555-555555555001';

UPDATE menu_items
SET price_minor = 250,
    version = version + 1,
    updated_at = now()
WHERE id = '55555555-5555-5555-5555-555555555003';

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now();
