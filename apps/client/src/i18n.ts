import type { Locale } from "./types";

type Key =
  | "closed"
  | "checkoutClosed"
  | "dayOffMessage"
  | "nextOpening"
  | "menu"
  | "cart"
  | "checkout"
  | "orders"
  | "support"
	| "booking"
  | "terms"
  | "acceptTerms"
  | "termsRequired"
  | "add"
  | "goCheckout"
  | "emptyCart"
  | "noAvailableItems"
  | "phone"
  | "street"
  | "houseNumber"
  | "entrance"
  | "floor"
  | "apartment"
  | "comment"
  | "cash"
  | "placeOrder"
  | "accepted"
  | "delivery"
  | "delivered"
  | "cancelled"
  | "retry"
  | "total"
  | "subtotal";

const dict: Record<Locale, Record<Key, string>> = {
  ru: {
    closed: "ВЫХОДНОЙ",
    checkoutClosed: "Приём заказов временно закрыт",
    dayOffMessage: "Сегодня заказы не принимаем.",
    nextOpening: "Ждем вас",
    menu: "Меню",
    cart: "Корзина",
    checkout: "Оформление",
    orders: "История",
    support: "Поддержка",
		booking: "Столик",
    terms: "условия продажи и доставки",
    acceptTerms: "Я прочитал(а) и принимаю",
    termsRequired: "Примите условия продажи и доставки",
    add: "Добавить",
    goCheckout: "Оформить",
    emptyCart: "Корзина пуста",
    noAvailableItems: "Нет доступных блюд",
    phone: "Телефон",
    street: "Улица",
    houseNumber: "Дом",
    entrance: "Подъезд",
    floor: "Этаж",
    apartment: "Квартира",
    comment: "Комментарий к заказу",
    cash: "Наличными",
    placeOrder: "ОФОРМИТЬ",
    accepted: "Заказ принят, готовится",
    delivery: "Заказ в доставке",
    delivered: "Заказ доставлен",
    cancelled: "Заказ отменён",
    retry: "Повторить",
    total: "Итого",
    subtotal: "Блюда",
  },
  sr: {
    closed: "ZATVORENO",
    checkoutClosed: "Porudžbine trenutno nisu dostupne",
    dayOffMessage: "Danas ne primamo porudžbine.",
    nextOpening: "Čekamo vas",
    menu: "Meni",
    cart: "Korpa",
    checkout: "Plaćanje",
    orders: "Istorija",
    support: "Podrška",
		booking: "Sto",
    terms: "uslove prodaje i dostave",
    acceptTerms: "Pročitao/la sam i prihvatam",
    termsRequired: "Prihvatite uslove prodaje i dostave",
    add: "Dodaj",
    goCheckout: "Naruči",
    emptyCart: "Korpa je prazna",
    noAvailableItems: "Nema dostupnih jela",
    phone: "Telefon",
    street: "Ulica",
    houseNumber: "Broj",
    entrance: "Ulaz",
    floor: "Sprat",
    apartment: "Stan",
    comment: "Komentar uz porudžbinu",
    cash: "Gotovina",
    placeOrder: "NARUČI",
    accepted: "Porudžbina je prihvaćena i priprema se",
    delivery: "Porudžbina je na dostavi",
    delivered: "Porudžbina je dostavljena",
    cancelled: "Porudžbina je otkazana",
    retry: "Pokušaj ponovo",
    total: "Ukupno",
    subtotal: "Jela",
  },
  en: {
    closed: "CLOSED",
    checkoutClosed: "Orders are not accepted now",
    dayOffMessage: "We are not taking orders today.",
    nextOpening: "See you",
    menu: "Menu",
    cart: "Cart",
    checkout: "Checkout",
    orders: "History",
    support: "Support",
		booking: "Table",
    terms: "terms of sale and delivery",
    acceptTerms: "I have read and accept the",
    termsRequired: "Accept the terms of sale and delivery",
    add: "Add",
    goCheckout: "Checkout",
    emptyCart: "Cart is empty",
    noAvailableItems: "No available items",
    phone: "Phone",
    street: "Street",
    houseNumber: "No.",
    entrance: "Entrance",
    floor: "Floor",
    apartment: "Apartment",
    comment: "Order comment",
    cash: "Cash",
    placeOrder: "PLACE ORDER",
    accepted: "Order accepted, preparing",
    delivery: "Order is out for delivery",
    delivered: "Order delivered",
    cancelled: "Order cancelled",
    retry: "Retry",
    total: "Total",
    subtotal: "Items",
  },
};

export function t(locale: Locale, key: Key): string {
  return dict[locale][key] || dict.ru[key];
}

export function telegramLocale(value?: string): Locale {
  if (value?.startsWith("sr")) return "sr";
  if (value?.startsWith("en")) return "en";
  return "ru";
}
