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
  | "terms"
  | "add"
  | "goCheckout"
  | "emptyCart"
  | "noAvailableItems"
  | "phone"
  | "street"
  | "details"
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
    terms: "Условия",
    add: "Добавить",
    goCheckout: "Оформить",
    emptyCart: "Корзина пуста",
    noAvailableItems: "Нет доступных блюд",
    phone: "Телефон",
    street: "Улица и номер",
    details: "Подъезд, этаж, квартира",
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
    terms: "Uslovi",
    add: "Dodaj",
    goCheckout: "Naruči",
    emptyCart: "Korpa je prazna",
    noAvailableItems: "Nema dostupnih jela",
    phone: "Telefon",
    street: "Ulica i broj",
    details: "Ulaz, sprat, stan",
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
    terms: "Terms",
    add: "Add",
    goCheckout: "Checkout",
    emptyCart: "Cart is empty",
    noAvailableItems: "No available items",
    phone: "Phone",
    street: "Street and number",
    details: "Entrance, floor, apartment",
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
