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
  price_minor, photo_path, weight_text, allergen_text_ru, allergen_text_sr, allergen_text_en, sort_order
)
VALUES
  ('22222222-2222-2222-2222-222222222001', '11111111-1111-1111-1111-111111111001', 'Классические хинкали', 'Klasicni hinkali', 'Classic khinkali', 'Сочные хинкали с говядиной и зеленью', 'Socni hinkali sa govedinom i zacinima', 'Juicy dumplings with beef and herbs', 690, 'fixtures/khinkali-classic.webp', '5 шт', '', '', '', 10),
  ('22222222-2222-2222-2222-222222222002', '11111111-1111-1111-1111-111111111001', 'Хинкали с сыром', 'Hinkali sa sirom', 'Cheese khinkali', 'Мягкая сырная начинка и тонкое тесто', 'Mekani sir i tanko testo', 'Soft cheese filling and thin dough', 640, 'fixtures/khinkali-cheese.webp', '5 шт', '', '', '', 20),
  ('22222222-2222-2222-2222-222222222003', '11111111-1111-1111-1111-111111111002', 'Аджарский хачапури', 'Adzarski hacapuri', 'Adjarian khachapuri', 'Лодочка с сыром, яйцом и сливочным маслом', 'Ladjica sa sirom jajetom i puterom', 'Cheese bread boat with egg and butter', 890, 'fixtures/khachapuri-adjarian.webp', '1 шт', '', '', '', 30),
  ('22222222-2222-2222-2222-222222222004', '11111111-1111-1111-1111-111111111002', 'Имеретинский хачапури', 'Imeretinski hacapuri', 'Imeretian khachapuri', 'Круглый хачапури с сыром внутри', 'Okrugli hacapuri sa sirom', 'Round cheese-filled bread', 760, 'fixtures/khachapuri-imeretian.webp', '1 шт', '', '', '', 40),
  ('22222222-2222-2222-2222-222222222005', '11111111-1111-1111-1111-111111111003', 'Чахохбили', 'Cahohbili', 'Chakhokhbili', 'Курица в томатном соусе с травами', 'Piletina u paradajz sosu sa zacinima', 'Chicken in tomato herb sauce', 940, 'fixtures/chakhokhbili.webp', '350 г', '', '', '', 50),
  ('22222222-2222-2222-2222-222222222006', '11111111-1111-1111-1111-111111111003', 'Лобио', 'Lobio', 'Lobio', 'Фасоль с орехами, зеленью и специями', 'Pasulj sa orasima zacinima i zeleni', 'Beans with walnuts herbs and spices', 620, 'fixtures/lobio.webp', '300 г', '', '', '', 60),
  ('22222222-2222-2222-2222-222222222007', '11111111-1111-1111-1111-111111111004', 'Лимонад тархун', 'Limonada tarhun', 'Tarragon lemonade', 'Холодный газированный лимонад', 'Hladna gazirana limunada', 'Cold sparkling lemonade', 290, 'fixtures/lemonade-tarragon.webp', '500 мл', '', '', '', 70),
  ('22222222-2222-2222-2222-222222222008', '11111111-1111-1111-1111-111111111004', 'Морс ягодный', 'Vocni napitak', 'Berry mors', 'Домашний ягодный напиток', 'Domaci vocni napitak', 'House berry drink', 260, 'fixtures/berry-mors.webp', '400 мл', '', '', '', 80)
ON CONFLICT (id) DO NOTHING;
