INSERT INTO app_settings (id, timezone, currency, manual_day_off, day_off_banner, flat_delivery_fee_minor, support_text, max_item_quantity, max_comment_length)
VALUES (true, 'Europe/Belgrade', 'RSD', false, 'ВЫХОДНОЙ', 0, '@Tako_Lako', 99, 300)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (id, title_ru, title_sr, title_en, sort_order)
VALUES
  ('11111111-1111-1111-1111-111111111001', 'Хинкали', 'Hinkali', 'Khinkali', 10),
  ('11111111-1111-1111-1111-111111111002', 'Хачапури', 'Hacapuri', 'Khachapuri', 20),
  ('11111111-1111-1111-1111-111111111003', 'Горячее', 'Topla jela', 'Hot dishes', 30),
  ('11111111-1111-1111-1111-111111111004', 'Напитки', 'Pica', 'Drinks', 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_items (
  id, category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
  price_minor, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en, sort_order
)
VALUES
  ('22222222-2222-2222-2222-222222222001', '11111111-1111-1111-1111-111111111001', 'Классические хинкали', 'Klasicni hinkali', 'Classic khinkali', 'Замороженные хинкали с говядиной и зеленью. Минимум 5 шт', 'Zamrznuti hinkali sa govedinom i zacinima. Minimum 5 kom', 'Frozen khinkali with beef and herbs. Minimum 5 pcs', 690, '', 'от 5 шт', 5, '', '', '', 10),
  ('22222222-2222-2222-2222-222222222002', '11111111-1111-1111-1111-111111111001', 'Хинкали без кинзы', 'Hinkali bez korijandera', 'Khinkali without cilantro', 'Замороженные хинкали с говядиной без кинзы. Минимум 5 шт', 'Zamrznuti hinkali sa govedinom bez korijandera. Minimum 5 kom', 'Frozen beef khinkali without cilantro. Minimum 5 pcs', 640, '', 'от 5 шт', 5, '', '', '', 20),
  ('22222222-2222-2222-2222-222222222003', '11111111-1111-1111-1111-111111111002', 'Аджарский хачапури', 'Adzarski hacapuri', 'Adjarian khachapuri', 'Лодочка с сыром, яйцом и сливочным маслом', 'Ladjica sa sirom jajetom i puterom', 'Cheese bread boat with egg and butter', 890, '', '1 шт', 1, '', '', '', 30),
  ('22222222-2222-2222-2222-222222222004', '11111111-1111-1111-1111-111111111002', 'Имеретинский хачапури', 'Imeretinski hacapuri', 'Imeretian khachapuri', 'Круглый хачапури с сыром внутри', 'Okrugli hacapuri sa sirom', 'Round cheese-filled bread', 760, '', '1 шт', 1, '', '', '', 40),
  ('22222222-2222-2222-2222-222222222005', '11111111-1111-1111-1111-111111111003', 'Чахохбили', 'Cahohbili', 'Chakhokhbili', 'Курица в томатном соусе с травами', 'Piletina u paradajz sosu sa zacinima', 'Chicken in tomato herb sauce', 940, '', '350 г', 1, '', '', '', 50),
  ('22222222-2222-2222-2222-222222222006', '11111111-1111-1111-1111-111111111003', 'Лобио', 'Lobio', 'Lobio', 'Фасоль с орехами, зеленью и специями', 'Pasulj sa orasima zacinima i zeleni', 'Beans with walnuts herbs and spices', 620, '', '300 г', 1, '', '', '', 60),
  ('22222222-2222-2222-2222-222222222007', '11111111-1111-1111-1111-111111111004', 'Лимонад тархун', 'Limonada tarhun', 'Tarragon lemonade', 'Холодный газированный лимонад', 'Hladna gazirana limunada', 'Cold sparkling lemonade', 290, '', '500 мл', 1, '', '', '', 70),
  ('22222222-2222-2222-2222-222222222008', '11111111-1111-1111-1111-111111111004', 'Морс ягодный', 'Vocni napitak', 'Berry mors', 'Домашний ягодный напиток', 'Domaci vocni napitak', 'House berry drink', 260, '', '400 мл', 1, '', '', '', 80)
ON CONFLICT (id) DO NOTHING;
