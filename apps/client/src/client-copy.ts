import type { Locale } from "./types";

export type ClientCopy = {
  brand: string;
  loading: string;
  statusUpdateFailed: string;
  cancel: string;
  back: string;
  orderHours: string;
  orderHoursAria: string;
  ownerRoleSwitch: string;
  roleClient: string;
  roleAdmin: string;
  roleKitchen: string;
  roleCourier: string;
  addToCart: string;
  unitShort: string;
  combo: (index: number) => string;
  orderLoading: string;
  addition: string;
  toOrder: (number: number) => string;
  timeRemaining: string;
  backToOrder: string;
  add: string;
  positionsShort: string;
  nothingSelected: string;
  addToOrder: string;
  dishNotFound: string;
  unavailable: string;
  removeUnavailable: string;
  emptyCart: string;
  forgotSomething: string;
  additionUnavailable: string;
  canAddFor: string;
  added: string;
  addedAt: (time: string) => string;
  receiving: string;
  pickupAt: string;
  address: string;
  payment: string;
  delivery: string;
  pickup: string;
  cash: string;
  cashPickup: string;
  card: string;
  paid: string;
  pickupAccepted: (time: string) => string;
  pickupReady: (time: string) => string;
  pickupCompleted: string;
  historyEmpty: string;
  showMore: string;
  minus: string;
  plus: string;
  fewMinutes: string;
  additionalAlreadyAdded: string;
  pickupPreparationStarted: string;
  additionExpired: string;
  ordersClosed: string;
  orderingEnded: string;
  cashOnly: string;
  orderProgressed: string;
  additionNotAllowed: string;
  portalTitle: string;
  openMiniApp: string;
  portalHint: string;
  openBotTitle: string;
  openBotText: string;
  openBot: string;
  devUnavailable: string;
  devUnavailableText: string;
  refreshDev: string;
};

const copy: Record<Locale, ClientCopy> = {
  ru: {
    brand: "Tako Lako — Грузинская кухня", loading: "Загрузка…", statusUpdateFailed: "Не удалось обновить статус заказа", cancel: "Отмена", back: "Назад",
    orderHours: "Заказы", orderHoursAria: "Приём заказов с 13:00 до 21:00", ownerRoleSwitch: "Переключение роли owner", roleClient: "Клиент", roleAdmin: "Админ", roleKitchen: "Кухня", roleCourier: "Курьер",
    addToCart: "В корзину", unitShort: "шт", combo: (index) => `Комбо ${index}`, orderLoading: "Загружаем заказ…", addition: "Дозаказ",
    toOrder: (number) => `К заказу #${number}`, timeRemaining: "Осталось", backToOrder: "Назад к заказу", add: "Добавить", positionsShort: "поз.", nothingSelected: "Ничего не выбрано", addToOrder: "Добавить к заказу",
    dishNotFound: "Блюдо не найдено", unavailable: "Блюдо недоступно", removeUnavailable: "Удалить недоступное блюдо", emptyCart: "Корзина пуста",
    forgotSomething: "Забыли что-то?", additionUnavailable: "Дозаказ недоступен", canAddFor: "Можно добавить ещё", added: "Добавлено", addedAt: (time) => `Добавлено в ${time}`,
    receiving: "Получение", pickupAt: "Забрать", address: "Адрес", payment: "Оплата", delivery: "Доставка", pickup: "Самовывоз", cash: "Наличные", cashPickup: "Наличные при самовывозе", card: "Карта", paid: "PAID",
    pickupAccepted: (time) => `Принят · забрать в ${time}`, pickupReady: (time) => `Готов · ждём к ${time}`, pickupCompleted: "Заказ выдан", historyEmpty: "История пуста", showMore: "Показать ещё",
    minus: "Уменьшить количество", plus: "Увеличить количество", fewMinutes: "несколько минут",
    additionalAlreadyAdded: "Дозаказ уже был добавлен", pickupPreparationStarted: "Кухня уже готовит заказ к выбранному времени", additionExpired: "Прошло больше 5 минут", ordersClosed: "Приём заказов закрыт", orderingEnded: "Приём заказов завершён", cashOnly: "Доступно только для наличных", orderProgressed: "Заказ уже передан дальше", additionNotAllowed: "Сейчас добавить нельзя",
    portalTitle: "Грузинская кухня в Telegram", openMiniApp: "Открыть Mini App", portalHint: "Если Telegram не открылся автоматически, найдите бота @takolako_main_bot.",
    openBotTitle: "Заказ оформляется в Telegram", openBotText: "Так мы безопасно получаем ваш Telegram contact и подтверждаем геолокацию для cash-заказа.", openBot: "Открыть бота",
    devUnavailable: "DEV временно не загрузился", devUnavailableText: "Обновите Mini App. Переход в рабочее приложение отключён.", refreshDev: "Обновить DEV",
  },
  sr: {
    brand: "Tako Lako — Gruzijska kuhinja", loading: "Učitavanje…", statusUpdateFailed: "Nije uspelo ažuriranje statusa porudžbine", cancel: "Otkaži", back: "Nazad",
    orderHours: "Porudžbine", orderHoursAria: "Porudžbine od 13:00 do 21:00", ownerRoleSwitch: "Promena owner uloge", roleClient: "Klijent", roleAdmin: "Admin", roleKitchen: "Kuhinja", roleCourier: "Kurir",
    addToCart: "U korpu", unitShort: "kom", combo: (index) => `Kombo ${index}`, orderLoading: "Učitavamo porudžbinu…", addition: "Dodatna porudžbina",
    toOrder: (number) => `Za porudžbinu #${number}`, timeRemaining: "Preostalo", backToOrder: "Nazad na porudžbinu", add: "Dodaj", positionsShort: "stav.", nothingSelected: "Ništa nije izabrano", addToOrder: "Dodaj porudžbini",
    dishNotFound: "Jelo nije pronađeno", unavailable: "Jelo nije dostupno", removeUnavailable: "Ukloni nedostupno jelo", emptyCart: "Korpa je prazna",
    forgotSomething: "Nešto ste zaboravili?", additionUnavailable: "Dodatna porudžbina nije dostupna", canAddFor: "Možete dodati još", added: "Dodato", addedAt: (time) => `Dodato u ${time}`,
    receiving: "Preuzimanje", pickupAt: "Preuzeti", address: "Adresa", payment: "Plaćanje", delivery: "Dostava", pickup: "Lično preuzimanje", cash: "Gotovina", cashPickup: "Gotovina pri preuzimanju", card: "Kartica", paid: "PLAĆENO",
    pickupAccepted: (time) => `Prihvaćeno · preuzimanje u ${time}`, pickupReady: (time) => `Spremno · čekamo vas u ${time}`, pickupCompleted: "Porudžbina je preuzeta", historyEmpty: "Istorija je prazna", showMore: "Prikaži još",
    minus: "Smanji količinu", plus: "Povećaj količinu", fewMinutes: "nekoliko minuta",
    additionalAlreadyAdded: "Dodatna porudžbina je već poslata", pickupPreparationStarted: "Kuhinja već priprema porudžbinu za izabrano vreme", additionExpired: "Prošlo je više od 5 minuta", ordersClosed: "Porudžbine su zatvorene", orderingEnded: "Prijem porudžbina je završen", cashOnly: "Dostupno samo za gotovinu", orderProgressed: "Porudžbina je već prosleđena", additionNotAllowed: "Trenutno nije moguće dodati",
    portalTitle: "Gruzijska kuhinja u Telegramu", openMiniApp: "Otvori Mini App", portalHint: "Ako se Telegram nije automatski otvorio, pronađite bota @takolako_main_bot.",
    openBotTitle: "Porudžbina se završava u Telegramu", openBotText: "Tako bezbedno dobijamo vaš Telegram kontakt i potvrđujemo lokaciju za gotovinsku porudžbinu.", openBot: "Otvori bota",
    devUnavailable: "DEV se privremeno nije učitao", devUnavailableText: "Osvežite Mini App. Prelazak u produkciju je isključen.", refreshDev: "Osveži DEV",
  },
  en: {
    brand: "Tako Lako — Georgian cuisine", loading: "Loading…", statusUpdateFailed: "Could not update the order status", cancel: "Cancel", back: "Back",
    orderHours: "Orders", orderHoursAria: "Orders from 13:00 to 21:00", ownerRoleSwitch: "Switch owner role", roleClient: "Client", roleAdmin: "Admin", roleKitchen: "Kitchen", roleCourier: "Courier",
    addToCart: "Add to cart", unitShort: "pcs", combo: (index) => `Combo ${index}`, orderLoading: "Loading order…", addition: "Add to order",
    toOrder: (number) => `For order #${number}`, timeRemaining: "Time left", backToOrder: "Back to order", add: "Add", positionsShort: "items", nothingSelected: "Nothing selected", addToOrder: "Add to order",
    dishNotFound: "Dish not found", unavailable: "Dish unavailable", removeUnavailable: "Remove unavailable dish", emptyCart: "Cart is empty",
    forgotSomething: "Forgot something?", additionUnavailable: "Adding items is unavailable", canAddFor: "You can add items for", added: "Added", addedAt: (time) => `Added at ${time}`,
    receiving: "Receiving", pickupAt: "Collect at", address: "Address", payment: "Payment", delivery: "Delivery", pickup: "Pickup", cash: "Cash", cashPickup: "Cash at pickup", card: "Card", paid: "PAID",
    pickupAccepted: (time) => `Accepted · collect at ${time}`, pickupReady: (time) => `Ready · see you at ${time}`, pickupCompleted: "Order collected", historyEmpty: "History is empty", showMore: "Show more",
    minus: "Decrease quantity", plus: "Increase quantity", fewMinutes: "a few minutes",
    additionalAlreadyAdded: "Items have already been added", pickupPreparationStarted: "The kitchen is already preparing the order for the selected time", additionExpired: "More than 5 minutes have passed", ordersClosed: "Orders are closed", orderingEnded: "Ordering has ended", cashOnly: "Available for cash orders only", orderProgressed: "The order has already moved forward", additionNotAllowed: "Items cannot be added now",
    portalTitle: "Georgian cuisine in Telegram", openMiniApp: "Open Mini App", portalHint: "If Telegram did not open automatically, find @takolako_main_bot.",
    openBotTitle: "Checkout continues in Telegram", openBotText: "This lets us securely receive your Telegram contact and verify location for a cash order.", openBot: "Open bot",
    devUnavailable: "DEV did not load", devUnavailableText: "Refresh the Mini App. Switching to production is disabled.", refreshDev: "Refresh DEV",
  },
};

export function clientCopy(locale: Locale): ClientCopy {
  return copy[locale] || copy.ru;
}

export function localizedWeightText(value: string, locale: Locale): string {
  const text = value.trim();
  if (!text || locale === "ru") return text;
  const exact: Record<string, { sr: string; en: string }> = {
    "на 4–5 человек": { sr: "za 4–5 osoba", en: "serves 4–5" },
    "на 1 человека": { sr: "za 1 osobu", en: "serves 1" },
    "на 2–3 человек": { sr: "za 2–3 osobe", en: "serves 2–3" },
    "4 десерта": { sr: "4 deserta", en: "4 desserts" },
    "без мяса": { sr: "bez mesa", en: "meat-free" },
  };
  const translated = exact[text.toLowerCase()]?.[locale];
  if (translated) return translated;
  return text
    .replace(/\s*шт\.?$/iu, locale === "sr" ? " kom." : " pcs")
    .replace(/\s*(?:гр|г)\.?$/iu, " g")
    .replace(/\s*л\.?$/iu, " l");
}
