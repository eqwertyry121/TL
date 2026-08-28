-- Complete the customer-facing Serbian and English menu translations.

UPDATE menu_items
SET title_sr = 'Mesna soljanka',
    title_en = 'Meat solyanka',
    description_sr = 'Gusta, bogata i pikantna supa koja spaja kiselkast, slan i ljut ukus. Posebna je po bogatom izboru mesa i dimljenih proizvoda, uz kisele krastavce, limun i masline.',
    description_en = 'A thick, rich and piquant soup combining sour, salty and spicy flavors. Its signature is a generous selection of meats and smoked products with pickles, lemon and olives.',
    version = version + 1,
    updated_at = now()
WHERE id = 'f8c229a9-53bb-4b37-b325-b45901d31392';

UPDATE app_settings
SET menu_revision = menu_revision + 1,
    version = version + 1,
    updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM menu_items
  WHERE id = 'f8c229a9-53bb-4b37-b325-b45901d31392'
);
