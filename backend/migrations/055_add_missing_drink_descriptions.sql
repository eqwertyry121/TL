UPDATE menu_items
SET description_ru = CASE id
      WHEN '44444444-4444-4444-4444-444444444014'::uuid THEN 'Питьевая вода без газа.'
      WHEN '44444444-4444-4444-4444-444444444015'::uuid THEN 'Минеральная газированная вода.'
      WHEN '44444444-4444-4444-4444-444444444018'::uuid THEN 'Классическая Coca-Cola.'
      WHEN '44444444-4444-4444-4444-444444444019'::uuid THEN 'Классическая Coca-Cola.'
      WHEN '44444444-4444-4444-4444-444444444020'::uuid THEN 'Классическая Coca-Cola.'
      WHEN 'e487229d-84ed-4bdf-94ad-e6e51f6ec382'::uuid THEN 'Грузинская минеральная вода, 0,5 л.'
      ELSE description_ru
    END,
    description_sr = CASE id
      WHEN '44444444-4444-4444-4444-444444444014'::uuid THEN 'Negazirana voda za piće.'
      WHEN '44444444-4444-4444-4444-444444444015'::uuid THEN 'Gazirana mineralna voda.'
      WHEN '44444444-4444-4444-4444-444444444018'::uuid THEN 'Klasična Coca-Cola.'
      WHEN '44444444-4444-4444-4444-444444444019'::uuid THEN 'Klasična Coca-Cola.'
      WHEN '44444444-4444-4444-4444-444444444020'::uuid THEN 'Klasična Coca-Cola.'
      WHEN 'e487229d-84ed-4bdf-94ad-e6e51f6ec382'::uuid THEN 'Gruzijska mineralna voda, 0,5 l.'
      ELSE description_sr
    END,
    description_en = CASE id
      WHEN '44444444-4444-4444-4444-444444444014'::uuid THEN 'Still drinking water.'
      WHEN '44444444-4444-4444-4444-444444444015'::uuid THEN 'Sparkling mineral water.'
      WHEN '44444444-4444-4444-4444-444444444018'::uuid THEN 'Classic Coca-Cola.'
      WHEN '44444444-4444-4444-4444-444444444019'::uuid THEN 'Classic Coca-Cola.'
      WHEN '44444444-4444-4444-4444-444444444020'::uuid THEN 'Classic Coca-Cola.'
      WHEN 'e487229d-84ed-4bdf-94ad-e6e51f6ec382'::uuid THEN 'Georgian mineral water, 0.5 L.'
      ELSE description_en
    END,
    version = version + 1,
    updated_at = now()
WHERE id IN (
  '44444444-4444-4444-4444-444444444014'::uuid,
  '44444444-4444-4444-4444-444444444015'::uuid,
  '44444444-4444-4444-4444-444444444018'::uuid,
  '44444444-4444-4444-4444-444444444019'::uuid,
  '44444444-4444-4444-4444-444444444020'::uuid,
  'e487229d-84ed-4bdf-94ad-e6e51f6ec382'::uuid
);
