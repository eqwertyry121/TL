-- Bring seeded menu to production-ready names, descriptions and order.

UPDATE categories
SET
  title_ru = CASE id
    WHEN '11111111-1111-1111-1111-111111111001' THEN 'Хинкали'
    WHEN '11111111-1111-1111-1111-111111111002' THEN 'Хачапури'
    WHEN '11111111-1111-1111-1111-111111111003' THEN 'Горячее'
    WHEN '11111111-1111-1111-1111-111111111004' THEN 'Напитки'
    ELSE title_ru
  END,
  title_sr = CASE id
    WHEN '11111111-1111-1111-1111-111111111001' THEN 'Hinkali'
    WHEN '11111111-1111-1111-1111-111111111002' THEN 'Hacapuri'
    WHEN '11111111-1111-1111-1111-111111111003' THEN 'Topla jela'
    WHEN '11111111-1111-1111-1111-111111111004' THEN 'Pica'
    ELSE title_sr
  END,
  title_en = CASE id
    WHEN '11111111-1111-1111-1111-111111111001' THEN 'Khinkali'
    WHEN '11111111-1111-1111-1111-111111111002' THEN 'Khachapuri'
    WHEN '11111111-1111-1111-1111-111111111003' THEN 'Hot dishes'
    WHEN '11111111-1111-1111-1111-111111111004' THEN 'Drinks'
    ELSE title_en
  END,
  updated_at = now()
WHERE id IN (
  '11111111-1111-1111-1111-111111111001',
  '11111111-1111-1111-1111-111111111002',
  '11111111-1111-1111-1111-111111111003',
  '11111111-1111-1111-1111-111111111004'
);

UPDATE menu_items
SET
  title_ru = CASE id
    WHEN '22222222-2222-2222-2222-222222222001' THEN 'Классические хинкали'
    WHEN '22222222-2222-2222-2222-222222222002' THEN 'Хинкали без кинзы'
    WHEN '22222222-2222-2222-2222-222222222003' THEN 'Аджарский хачапури'
    WHEN '22222222-2222-2222-2222-222222222004' THEN 'Имеретинский хачапури'
    WHEN '22222222-2222-2222-2222-222222222005' THEN 'Чахохбили'
    WHEN '22222222-2222-2222-2222-222222222006' THEN 'Лобио'
    WHEN '22222222-2222-2222-2222-222222222007' THEN 'Лимонад тархун'
    WHEN '22222222-2222-2222-2222-222222222008' THEN 'Натакхари с грушей'
    ELSE title_ru
  END,
  title_sr = CASE id
    WHEN '22222222-2222-2222-2222-222222222001' THEN 'Klasicni hinkali'
    WHEN '22222222-2222-2222-2222-222222222002' THEN 'Hinkali bez korijandera'
    WHEN '22222222-2222-2222-2222-222222222003' THEN 'Adzarski khachapuri'
    WHEN '22222222-2222-2222-2222-222222222004' THEN 'Imeretinski khachapuri'
    WHEN '22222222-2222-2222-2222-222222222005' THEN 'Cahokhbili'
    WHEN '22222222-2222-2222-2222-222222222006' THEN 'Lobio'
    WHEN '22222222-2222-2222-2222-222222222007' THEN 'Limonada tarhun'
    WHEN '22222222-2222-2222-2222-222222222008' THEN 'Natakhtari sa kruškom'
    ELSE title_sr
  END,
  title_en = CASE id
    WHEN '22222222-2222-2222-2222-222222222001' THEN 'Classic khinkali'
    WHEN '22222222-2222-2222-2222-222222222002' THEN 'Khinkali without cilantro'
    WHEN '22222222-2222-2222-2222-222222222003' THEN 'Adjarian khachapuri'
    WHEN '22222222-2222-2222-2222-222222222004' THEN 'Imeretian khachapuri'
    WHEN '22222222-2222-2222-2222-222222222005' THEN 'Chakhokhbili'
    WHEN '22222222-2222-2222-2222-222222222006' THEN 'Lobio'
    WHEN '22222222-2222-2222-2222-222222222007' THEN 'Tarragon lemonade'
    WHEN '22222222-2222-2222-2222-222222222008' THEN 'Natakhtari with pear'
    ELSE title_en
  END,
  description_ru = CASE id
    WHEN '22222222-2222-2222-2222-222222222001' THEN 'Замороженные хинкали с говядиной и зеленью. Минимум 5 шт.'
    WHEN '22222222-2222-2222-2222-222222222002' THEN 'Замороженные хинкали с говядиной без кинзы. Минимум 5 шт.'
    WHEN '22222222-2222-2222-2222-222222222003' THEN 'Лодочка с сыром, яйцом и сливочным маслом'
    WHEN '22222222-2222-2222-2222-222222222004' THEN 'Круглый хачапури с сыром внутри.'
    WHEN '22222222-2222-2222-2222-222222222005' THEN 'Курица в томатном соусе с зеленью и пряными травами.'
    WHEN '22222222-2222-2222-2222-222222222006' THEN 'Фасоль с орехами, зеленью и лёгкими специями.'
    WHEN '22222222-2222-2222-2222-222222222007' THEN 'Холодный газированный лимонад'
    WHEN '22222222-2222-2222-2222-222222222008' THEN 'Рекомендация от разработчика: Натуральный квасный напиток с сочной грушей и мягкими нотами кардамона.'
    ELSE description_ru
  END,
  description_sr = CASE id
    WHEN '22222222-2222-2222-2222-222222222001' THEN 'Zamrznuti hinkali sa govedinom i zacinima, minimum 5 kom.'
    WHEN '22222222-2222-2222-2222-222222222002' THEN 'Zamrznuti hinkali sa govedinom bez korijandera, minimum 5 kom.'
    WHEN '22222222-2222-2222-2222-222222222003' THEN 'Ladjica sa sirom, jajetom i puterom'
    WHEN '22222222-2222-2222-2222-222222222004' THEN 'Okrugli khachapuri sa sirom iznutra.'
    WHEN '22222222-2222-2222-2222-222222222005' THEN 'Piletina u paradajz sosu sa svežim začinskim biljem.'
    WHEN '22222222-2222-2222-2222-222222222006' THEN 'Pasulj sa orasima, biljem i blagim začinima.'
    WHEN '22222222-2222-2222-2222-222222222007' THEN 'Hladni gazirani limunada sa tarrhun'
    WHEN '22222222-2222-2222-2222-222222222008' THEN 'Preporuka developera: Prirodni napitak kvasca sa sočnom kruškom i blagim karanfila i kardamoma.'
    ELSE description_sr
  END,
  description_en = CASE id
    WHEN '22222222-2222-2222-2222-222222222001' THEN 'Frozen khinkali with beef and herbs. Minimum 5 pcs.'
    WHEN '22222222-2222-2222-2222-222222222002' THEN 'Frozen beef khinkali without cilantro. Minimum 5 pcs.'
    WHEN '22222222-2222-2222-2222-222222222003' THEN 'Cheese bread boat with egg and butter'
    WHEN '22222222-2222-2222-2222-222222222004' THEN 'Round cheese-filled khachapuri.'
    WHEN '22222222-2222-2222-2222-222222222005' THEN 'Chicken in tomato sauce with herbs.'
    WHEN '22222222-2222-2222-2222-222222222006' THEN 'Beans with walnuts and herbs.'
    WHEN '22222222-2222-2222-2222-222222222007' THEN 'Cold sparkling lemonade with tarragon'
    WHEN '22222222-2222-2222-2222-222222222008' THEN 'Chef''s recommendation: natural pear kvass drink with gentle cardamom and clove notes.'
    ELSE description_en
  END,
  price_minor = CASE id
    WHEN '22222222-2222-2222-2222-222222222008' THEN 430
    ELSE price_minor
  END,
  weight_text = CASE id
    WHEN '22222222-2222-2222-2222-222222222008' THEN '450 мл'
    ELSE weight_text
  END,
  sort_order = CASE id
    WHEN '22222222-2222-2222-2222-222222222008' THEN 10
    WHEN '22222222-2222-2222-2222-222222222007' THEN 20
    ELSE sort_order
  END,
  min_quantity = CASE id
    WHEN '22222222-2222-2222-2222-222222222001' THEN 5
    WHEN '22222222-2222-2222-2222-222222222002' THEN 5
    ELSE 1
  END,
  updated_at = now()
WHERE id IN (
  '22222222-2222-2222-2222-222222222001',
  '22222222-2222-2222-2222-222222222002',
  '22222222-2222-2222-2222-222222222003',
  '22222222-2222-2222-2222-222222222004',
  '22222222-2222-2222-2222-222222222005',
  '22222222-2222-2222-2222-222222222006',
  '22222222-2222-2222-2222-222222222007',
  '22222222-2222-2222-2222-222222222008'
);
