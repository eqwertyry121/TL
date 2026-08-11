import type { Category, Order, Runtime } from "@tk-delivery/api-client/generated";

export const demoRuntime: Runtime = {
  server_time: new Date().toISOString(),
  timezone: "Europe/Belgrade",
  accepting_orders: true,
  reason: "open",
  day_off_banner: "ВЫХОДНОЙ",
  flat_delivery_fee_minor: 0,
  currency: "RSD",
  enabled_payments: ["cash"],
  supported_locales: ["ru", "sr", "en"],
  support_text: "@Tako_Lako",
  cash_location_required: true,
  cash_location_radius_meters: 12000,
};

export const demoCategories: Category[] = [
  {
    id: "11111111-1111-1111-1111-111111111001",
    title: "Хинкали",
    sort_order: 10,
    items: [
      {
        id: "22222222-2222-2222-2222-222222222001",
        category_id: "11111111-1111-1111-1111-111111111001",
        title: "Классические хинкали",
        description: "Замороженные хинкали с говядиной и зеленью. Минимум 5 шт",
        price_minor: 690,
        currency: "RSD",
        photo_path: "fixtures/khinkali-classic.webp",
        weight_text: "от 5 шт",
        min_quantity: 5,
        allergen_text: "",
        sort_order: 10,
        version: 1,
      },
      {
        id: "22222222-2222-2222-2222-222222222002",
        category_id: "11111111-1111-1111-1111-111111111001",
        title: "Хинкали без кинзы",
        description: "Замороженные хинкали с говядиной без кинзы. Минимум 5 шт",
        price_minor: 640,
        currency: "RSD",
        photo_path: "fixtures/khinkali-cheese.webp",
        weight_text: "от 5 шт",
        min_quantity: 5,
        allergen_text: "",
        sort_order: 20,
        version: 1,
      },
    ],
  },
  {
    id: "11111111-1111-1111-1111-111111111002",
    title: "Хачапури",
    sort_order: 20,
    items: [
      {
        id: "22222222-2222-2222-2222-222222222003",
        category_id: "11111111-1111-1111-1111-111111111002",
        title: "Аджарский хачапури",
        description: "Лодочка с сыром, яйцом и сливочным маслом",
        price_minor: 890,
        currency: "RSD",
        photo_path: "fixtures/khachapuri-adjarian.webp",
        weight_text: "1 шт",
        min_quantity: 1,
        allergen_text: "",
        sort_order: 30,
        version: 1,
      },
      {
        id: "22222222-2222-2222-2222-222222222004",
        category_id: "11111111-1111-1111-1111-111111111002",
        title: "Имеретинский хачапури",
        description: "Круглый хачапури с сыром внутри",
        price_minor: 760,
        currency: "RSD",
        photo_path: "fixtures/khachapuri-imeretian.webp",
        weight_text: "1 шт",
        min_quantity: 1,
        allergen_text: "",
        sort_order: 40,
        version: 1,
      },
    ],
  },
  {
    id: "11111111-1111-1111-1111-111111111003",
    title: "Горячее",
    sort_order: 30,
    items: [
      {
        id: "22222222-2222-2222-2222-222222222005",
        category_id: "11111111-1111-1111-1111-111111111003",
        title: "Чахохбили",
        description: "Курица в томатном соусе с травами",
        price_minor: 940,
        currency: "RSD",
        photo_path: "fixtures/chakhokhbili.webp",
        weight_text: "350 г",
        min_quantity: 1,
        allergen_text: "",
        sort_order: 50,
        version: 1,
      },
      {
        id: "22222222-2222-2222-2222-222222222006",
        category_id: "11111111-1111-1111-1111-111111111003",
        title: "Лобио",
        description: "Фасоль с орехами, зеленью и специями",
        price_minor: 620,
        currency: "RSD",
        photo_path: "fixtures/lobio.webp",
        weight_text: "300 г",
        min_quantity: 1,
        allergen_text: "",
        sort_order: 60,
        version: 1,
      },
    ],
  },
  {
    id: "11111111-1111-1111-1111-111111111004",
    title: "Напитки",
    sort_order: 40,
    items: [
      {
        id: "22222222-2222-2222-2222-222222222007",
        category_id: "11111111-1111-1111-1111-111111111004",
        title: "Лимонад тархун",
        description: "Холодный газированный лимонад",
        price_minor: 290,
        currency: "RSD",
        photo_path: "fixtures/lemonade-tarragon.webp",
        weight_text: "500 мл",
        min_quantity: 1,
        allergen_text: "",
        sort_order: 70,
        version: 1,
      },
      {
        id: "22222222-2222-2222-2222-222222222008",
        category_id: "11111111-1111-1111-1111-111111111004",
        title: "Морс ягодный",
        description: "Домашний ягодный напиток",
        price_minor: 260,
        currency: "RSD",
        photo_path: "fixtures/berry-mors.webp",
        weight_text: "400 мл",
        min_quantity: 1,
        allergen_text: "",
        sort_order: 80,
        version: 1,
      },
    ],
  },
];

export function orderStatusText(order: Order): string {
  switch (order.fulfillment_status) {
    case "NEW":
      return "Заказ принят, готовится";
    case "OUT_FOR_DELIVERY":
      return "Заказ в доставке";
    case "DELIVERED":
      return "Заказ доставлен";
    case "CANCELLED":
      return "Заказ отменён";
  }
}
