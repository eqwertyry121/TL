import type { Locale } from "./types";

type Key =
  | "closed"
  | "checkoutClosed"
  | "menu"
  | "cart"
  | "checkout"
  | "orders"
  | "support"
  | "terms"
  | "add"
  | "goCheckout"
  | "emptyCart"
  | "phone"
  | "street"
  | "details"
  | "note"
  | "comment"
  | "cash"
  | "placeOrder"
  | "accepted"
  | "delivery"
  | "delivered"
  | "cancelled"
  | "retry"
  | "total"
  | "deliveryFee"
  | "subtotal"
  | "agree"
  | "addressWarning";

const dict: Record<Locale, Record<Key, string>> = {
  ru: {
    closed: "ВЫХОДНОЙ",
    checkoutClosed: "Сейчас заказы не принимаются",
    menu: "Меню",
    cart: "Корзина",
    checkout: "Оформление",
    orders: "История",
    support: "Поддержка",
    terms: "Условия",
    add: "Добавить",
    goCheckout: "Оформить",
    emptyCart: "Корзина пуста",
    phone: "Телефон",
    street: "Улица и номер",
    details: "Подъезд, этаж, квартира",
    note: "Ориентир",
    comment: "Комментарий к заказу",
    cash: "Наличными",
    placeOrder: "ОФОРМИТЬ",
    accepted: "Заказ принят, готовится",
    delivery: "Заказ в доставке",
    delivered: "Заказ доставлен",
    cancelled: "Заказ отменён",
    retry: "Повторить",
    total: "Итого",
    deliveryFee: "Доставка",
    subtotal: "Блюда",
    agree: "Я согласен с условиями доставки",
    addressWarning: "Проверьте адрес и телефон перед отправкой.",
  },
  sr: {
    closed: "ZATVORENO",
    checkoutClosed: "Porudžbine trenutno nisu dostupne",
    menu: "Meni",
    cart: "Korpa",
    checkout: "Plaćanje",
    orders: "Istorija",
    support: "Podrška",
    terms: "Uslovi",
    add: "Dodaj",
    goCheckout: "Naruči",
    emptyCart: "Korpa je prazna",
    phone: "Telefon",
    street: "Ulica i broj",
    details: "Ulaz, sprat, stan",
    note: "Napomena za adresu",
    comment: "Komentar uz porudžbinu",
    cash: "Gotovina",
    placeOrder: "NARUČI",
    accepted: "Porudžbina je prihvaćena i priprema se",
    delivery: "Porudžbina je na dostavi",
    delivered: "Porudžbina je dostavljena",
    cancelled: "Porudžbina je otkazana",
    retry: "Pokušaj ponovo",
    total: "Ukupno",
    deliveryFee: "Dostava",
    subtotal: "Jela",
    agree: "Slažem se sa uslovima dostave",
    addressWarning: "Proverite adresu i telefon pre slanja.",
  },
  en: {
    closed: "CLOSED",
    checkoutClosed: "Orders are not accepted now",
    menu: "Menu",
    cart: "Cart",
    checkout: "Checkout",
    orders: "History",
    support: "Support",
    terms: "Terms",
    add: "Add",
    goCheckout: "Checkout",
    emptyCart: "Cart is empty",
    phone: "Phone",
    street: "Street and number",
    details: "Entrance, floor, apartment",
    note: "Address note",
    comment: "Order comment",
    cash: "Cash",
    placeOrder: "PLACE ORDER",
    accepted: "Order accepted, preparing",
    delivery: "Order is out for delivery",
    delivered: "Order delivered",
    cancelled: "Order cancelled",
    retry: "Retry",
    total: "Total",
    deliveryFee: "Delivery",
    subtotal: "Items",
    agree: "I agree to the delivery terms",
    addressWarning: "Check address and phone before sending.",
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
