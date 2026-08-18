INSERT INTO app_settings (id, timezone, currency, manual_day_off, day_off_banner, flat_delivery_fee_minor, support_text, max_item_quantity, max_comment_length)
VALUES (true, 'Europe/Belgrade', 'RSD', false, 'ВЫХОДНОЙ', 0, '@Tako_Lako', 99, 300)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (id, title_ru, title_sr, title_en, sort_order)
VALUES
  ('33333333-3333-3333-3333-333333333001', 'Хачапури и горячие блюда', 'Hacapuri i topla jela', 'Khachapuri and hot dishes', 10),
  ('33333333-3333-3333-3333-333333333002', 'Соусы', 'Sosevi', 'Sauces', 20),
  ('33333333-3333-3333-3333-333333333003', 'Супы', 'Supe', 'Soups', 30),
  ('33333333-3333-3333-3333-333333333004', 'Салаты и закуски', 'Salate i predjela', 'Salads and appetizers', 40),
  ('33333333-3333-3333-3333-333333333005', 'Десерты', 'Deserti', 'Desserts', 50),
  ('33333333-3333-3333-3333-333333333006', 'Напитки', 'Pica', 'Drinks', 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_items (
  id, category_id, title_ru, title_sr, title_en, description_ru, description_sr, description_en,
  price_minor, photo_path, weight_text, min_quantity, allergen_text_ru, allergen_text_sr, allergen_text_en, sort_order
)
VALUES
  ('44444444-4444-4444-4444-444444444001', '33333333-3333-3333-3333-333333333001', 'Аджарский хачапури', 'Adzarski hacapuri', 'Adjarian khachapuri', 'Лодочка с сыром и яйцом.', 'Oblik camca sa jajetom.', 'Boat-shaped cheese bread with egg.', 1120, '/media/menu/adzarski-hacapuri.jpg', '', 1, '', '', '', 10),
  ('44444444-4444-4444-4444-444444444002', '33333333-3333-3333-3333-333333333001', 'Мегрельский хачапури', 'Megrelski hacapuri', 'Megrelian khachapuri', 'Круглый хачапури с сыром внутри и сверху.', 'Okrugli, sir unutra i odozgo.', 'Round cheese bread with cheese inside and on top.', 1190, '/media/menu/megrelski-hacapuri.jpg', '', 1, '', '', '', 20),
  ('44444444-4444-4444-4444-444444444003', '33333333-3333-3333-3333-333333333001', 'Оджахури с мясом', 'Adzahuri sa mesom', 'Ojakhuri with meat', 'Говядина, картофель, красная паприка, зелень.', 'Govedina, krompir, crvena paprika, zelenilo.', 'Beef, potatoes, red pepper and herbs.', 1330, '/media/menu/adzahuri-sa-mesom.jpg', '', 1, '', '', '', 30),
  ('44444444-4444-4444-4444-444444444004', '33333333-3333-3333-3333-333333333001', 'Чкмерули', 'Ckmeruli', 'Chkmeruli', 'Куриное мясо без кости в сливочно-чесночном соусе.', 'Pilece meso bez kosti u kremasto-belom sosu sa belim lukom.', 'Boneless chicken in creamy garlic sauce.', 1120, '/media/menu/ckmeruli.jpg', '', 1, '', '', '', 40),
  ('44444444-4444-4444-4444-444444444005', '33333333-3333-3333-3333-333333333002', 'Сацебели', 'Sacebeli', 'Satsebeli', 'Томатная основа, специи, зелень.', 'Paradajz osnova, zacini, zelenilo.', 'Tomato base, spices and herbs.', 210, '/media/menu/sacebeli.jpg', '', 1, '', '', '', 10),
  ('44444444-4444-4444-4444-444444444006', '33333333-3333-3333-3333-333333333002', 'Сливочно-чесночный соус', 'Kremasti sos sa belim lukom', 'Creamy garlic sauce', 'Сливочный соус с чесноком.', 'Kremasti sos sa belim lukom.', 'Creamy sauce with garlic.', 140, '/media/menu/kremasti-sos-sa-belim-lukom.jpg', '', 1, '', '', '', 20),
  ('44444444-4444-4444-4444-444444444007', '33333333-3333-3333-3333-333333333003', 'Лобио без мяса', 'Lobio bez mesa', 'Meatless lobio', 'Фасолевый суп без мяса.', 'Lobio bez mesa.', 'Meatless bean soup.', 350, '/media/menu/lobio-bez-mesa.jpg', '', 1, '', '', '', 10),
  ('44444444-4444-4444-4444-444444444008', '33333333-3333-3333-3333-333333333004', 'Салат «Тбилиси»', 'Salata „tbilisi”', 'Tbilisi salad', 'Говядина, фасоль, красная паприка, лук, грецкий орех, чеснок, зелень.', 'Govedina, pasulj, crvena paprika, luk, orah, beli luk, zelenilo.', 'Beef, beans, red pepper, onion, walnut, garlic and herbs.', 1050, '/media/menu/salata-tbilisi.jpg', '', 1, 'грецкий орех', 'orah', 'walnut', 10),
  ('44444444-4444-4444-4444-444444444009', '33333333-3333-3333-3333-333333333004', 'Грузинский салат', 'Gruzijska salata', 'Georgian salad', 'Помидор, огурец, лук, грецкий орех, масло.', 'Paradajz, krastavac, luk, orah, ulje.', 'Tomato, cucumber, onion, walnut and oil.', 630, '/media/menu/gruzijska-salata.jpg', '', 1, 'грецкий орех', 'orah', 'walnut', 20),
  ('44444444-4444-4444-4444-444444444010', '33333333-3333-3333-3333-333333333004', 'Рулетики из баклажана', 'Rolnice od patlidzana', 'Eggplant rolls', 'Ореховая начинка, зелень.', 'Orahov nadev, zelenilo.', 'Walnut filling and herbs.', 770, '/media/menu/rolnice-od-patlidzana.jpg', '', 1, 'грецкий орех', 'orah', 'walnut', 30),
  ('44444444-4444-4444-4444-444444444011', '33333333-3333-3333-3333-333333333005', 'Медовик', 'Medovik', 'Honey cake', 'Медовые коржи и нежный крем.', 'Medene kore i nezan krem.', 'Honey layers and delicate cream.', 630, '/media/menu/medovik.jpg', '', 1, '', '', '', 10),
  ('44444444-4444-4444-4444-444444444012', '33333333-3333-3333-3333-333333333005', 'Пирожное «Картошка»', 'Kolac „krompir”', 'Potato cake', 'Шоколадный десерт из бисквитной крошки и какао.', 'Cokoladni desert od biskvitnih mrvica i kakaa.', 'Chocolate dessert made with biscuit crumbs and cocoa.', 532, '/media/menu/kolac-krompir.jpg', '', 1, '', '', '', 20),
  ('44444444-4444-4444-4444-444444444013', '33333333-3333-3333-3333-333333333006', 'Натакхари с грушей 0.5 л', 'Natakhtari sa kruskom 0.5 l', 'Natakhtari pear 0.5 l', 'Рекомендация от разработчика: Грузинский газированный лимонад со вкусом груши.', 'Preporuka developera: Gruzijsko gazirano pice sa ukusom kruske.', 'Chef''s recommendation: Georgian sparkling lemonade with pear flavor.', 588, '/media/menu/natakhtari-pear-05l.jpg', '0.5 л', 1, '', '', '', 10),
  ('44444444-4444-4444-4444-444444444014', '33333333-3333-3333-3333-333333333006', 'Вода Rosa негазированная', 'Voda Rosa negazirana', 'Rosa still water', '', '', '', 140, '/media/menu/rosa-still-water.jpg', '', 1, '', '', '', 20),
  ('44444444-4444-4444-4444-444444444015', '33333333-3333-3333-3333-333333333006', 'Вода Knjaz Milos газированная', 'Voda Knjaz Milos gazirana', 'Knjaz Milos sparkling water', '', '', '', 280, '/media/menu/knjaz-milos-sparkling-water.jpg', '', 1, '', '', '', 30),
  ('44444444-4444-4444-4444-444444444016', '33333333-3333-3333-3333-333333333006', 'Натакхари виноград 0.5 л', 'Natakhtari grozdje 0.5 l', 'Natakhtari grape 0.5 l', 'Грузинский газированный лимонад со вкусом винограда.', 'Gruzijsko gazirano pice sa ukusom grozdja.', 'Georgian sparkling lemonade with grape flavor.', 588, '/media/menu/natakhtari-grape-05l.jpg', '0.5 л', 1, '', '', '', 40),
  ('44444444-4444-4444-4444-444444444017', '33333333-3333-3333-3333-333333333006', 'Комбуча', 'Kombuca', 'Kombucha', 'Холодный ферментированный чай.', 'Hladni fermentisani caj.', 'Cold fermented tea.', 868, '/media/menu/kombucha.jpg', '', 1, '', '', '', 50),
  ('44444444-4444-4444-4444-444444444018', '33333333-3333-3333-3333-333333333006', 'Coca-Cola 0.33 л', 'Coca-Cola 0.33 l', 'Coca-Cola 0.33 l', '', '', '', 280, '/media/menu/coca-cola-033l.jpg', '0.33 л', 1, '', '', '', 60),
  ('44444444-4444-4444-4444-444444444019', '33333333-3333-3333-3333-333333333006', 'Coca-Cola 0.5 л', 'Coca-Cola 0.5 l', 'Coca-Cola 0.5 l', '', '', '', 350, '/media/menu/coca-cola-05l.jpg', '0.5 л', 1, '', '', '', 70),
  ('44444444-4444-4444-4444-444444444020', '33333333-3333-3333-3333-333333333006', 'Coca-Cola 1 л', 'Sok Gazirani Coca Cola 1 l', 'Coca-Cola 1 l', '', '', '', 460, '/media/menu/coca-cola-1l.jpg', '1 л', 1, '', '', '', 80)
ON CONFLICT (id) DO NOTHING;
