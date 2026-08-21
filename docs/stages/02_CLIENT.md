# Этап 2 — Client Mini App и cash-заказ

## Цель

Сделать понятный клиентский путь: открыть меню, выбрать количества, оформить
cash-заказ и видеть его status. На этом этапе весь flow работает в staging;
production включается после согласования чека.

## Критерии входа

- Этап 1 принят.
- Есть client staging bot и HTTPS URL.
- Загружено тестовое или реальное меню.
- Подтверждены flat delivery fee, адресные поля и тексты.

## 1. Запуск

1. Инициализировать Telegram WebApp adapter.
2. Применить theme, safe area и viewport.
3. Получить raw `initData`.
4. Обменять на backend session.
5. Загрузить `runtime` и `menu`.
6. Восстановить cart.

Production browser без Telegram показывает понятную ошибку. Local development
может иметь явно отмеченный mock mode, который невозможно включить production.

## 2. Экраны

- `/` — menu;
- `/dish/:id` — dish;
- `/cart`;
- `/checkout`;
- `/order/:id`;
- `/orders`;
- `/support`;
- `/terms`.

Telegram BackButton синхронизирован с routes. Назад после успешного order не
повторяет submit.

## 3. Меню

- header с logo/name;
- красная плашка `ВЫХОДНОЙ` для Monday/manual stop;
- сообщение о закрытом приёме до 13/после 21;
- категории;
- dish card: photo, title, weight, price, allergen marker;
- hidden/archived items не показываются;
- menu можно смотреть, когда checkout закрыт.

Ручная плашка рекомендации допустима у конкретного блюда, но не меняет порядок
категорий или блюд: такой товар остаётся на своём месте в меню.

Не добавлять поиск, фильтры и рекомендации, пока размер реального меню не
покажет необходимость.

## 4. Блюдо

- photo;
- localized title/description;
- weight/portion text;
- allergen text;
- quantity minus/plus;
- `Добавить в корзину`.

Нет selectors, sizes, extras, sauces и ingredient removal. Необязательный
общий комментарий находится в cart/checkout, а не сложный комментарий к каждой
позиции.

Количество проверяется frontend для удобства и backend для истины.

## 5. Корзина

Строка:

- dish title;
- unit price;
- quantity control;
- line total;
- remove.

Итого:

- subtotal;
- flat delivery fee;
- total.

Cart persisted с schema version:

- item ID;
- display snapshot;
- quantity;
- timestamps/menu version.

Не хранить phone/address/session/raw initData. После открытия cart сверяется с
актуальным menu. Скрытый/изменившийся item помечается, checkout запрашивает
server calculation.

## 6. Закрытое время

Frontend берёт решение из `runtime`:

- Monday/manual stop → красная `ВЫХОДНОЙ`;
- до 13:00 → следующий приём;
- 13:00–21:00 → checkout enabled;
- после 21:00 → `Приём заказов на сегодня завершён`.

Кнопка оформления disabled, но cart/menu доступны. Даже если frontend ошибся,
backend отклоняет order.

## 7. Checkout

Одна страница/короткий flow:

1. Telegram contact или уже сохранённый verified contact.
2. Text address:
   - street/number;
   - apartment/access;
   - note.
3. Общий комментарий к заказу.
4. Server calculation.
5. Cash-location confirmation через Telegram, если cash location включён.
6. Состав, delivery fee, total.
7. Cash payment.
8. Условия доставки.
9. `ОФОРМИТЬ • X RSD`.

До подключения эквайринга frontend может показывать отдельную карточку
`Банковской картой` с пометкой `Скоро`. Нажатие выводит короткое пояснение, но
не выбирает способ оплаты, не отправляет `card` в API и не меняет cash-flow.

Не показывать карту, координаты, delivery zone и ETA. Радиус можно упоминать
только простым текстом в контексте проверки наличного заказа.

### Телефон

- `requestContact` вызывается только по user click;
- bot/backend принимает контакт только текущего user;
- для cash-заказа manual fallback не является verified contact и не позволяет
  создать заказ;
- в UI показывать masked saved value;
- timeout/deny не оставляет endless spinner.

### Cash-location

- frontend создаёт challenge после успешного server calculation;
- frontend не принимает произвольные latitude/longitude и не показывает карту;
- основной путь: backend отправляет в bot native `request_location`, а frontend
  сразу открывает bot-chat;
- команда `/share` в bot повторно показывает `request_location`, если Telegram
  скрыл кнопку; команда не может сама отправить GPS;
- для Telegram desktop/web пользователь открывает заказ на телефоне и
  отправляет native Telegram location из bot-чата; production backend не
  доверяет координатам из browser/Mini App endpoint;
- UI polling'ом показывает `PENDING`, `VERIFIED`, `REJECTED` или `EXPIRED`;
- submit cash-заказа disabled, пока challenge не `VERIFIED`;
- при смене корзины/calculation старый challenge не используется.
- при случайном закрытии Mini App frontend восстанавливает неистёкшие
  calculation/challenge для той же корзины без хранения session token,
  телефона, адреса, raw `initData` или точных координат.

### Адрес

Простые текстовые inputs с max length. Клиент сам отвечает за корректность;
рядом короткое предупреждение. Сохранение последнего адреса допустимо, если
это подтверждено Privacy Policy.

### Самовывоз по времени

- отдельный выбор `Доставка / Самовывоз`;
- для самовывоза обязательны адрес ресторана, ссылка на карту и свободный слот
  текущего дня из `GET /pickup/slots`;
- backend повторно проверяет время и вместимость слота при submit;
- pickup сохраняется как `NEW` с `pickup_at`, не попадает курьеру и использует
  отдельный статус `READY_FOR_PICKUP` после готовности;
- полное поведение определено в [PICKUP_SPEC.md](../PICKUP_SPEC.md).

## 8. Submit и дубли

- При первом submit создаётся UUID Idempotency-Key.
- Кнопка сразу блокируется и показывает progress.
- При timeout key сохраняется.
- `Проверить заказ` повторяет тот же request/key.
- Новый key создаётся только после изменения intent.
- Success очищает cart и делает replace route на order.
- Price/item change показывает обновлённый calculation, без автоматического
  заказа.

## 9. Статус заказа

Экран:

- номер;
- created time;
- composition/total/payment;
- address/phone masked;
- один текущий статус;
- support link.

Тексты:

- `NEW` → `Заказ принят, готовится`;
- `OUT_FOR_DELIVERY` → `Заказ в доставке`;
- `READY_FOR_PICKUP` → `Заказ готов к самовывозу`;
- `DELIVERED` → `Заказ доставлен`;
- `CANCELLED` → `Заказ отменён`.

Polling каждые 10 секунд, при focus/resume — немедленно. При network error
показывается последнее update time; UI не выдумывает новый status.

## 10. История

- последние orders;
- number/date/total/status;
- detail;
- repeat order не нужен в первой версии;
- support link с номером.

CLIENT получает только свои orders. Проверить подмену UUID.

## 11. Telegram UX

- MainButton можно использовать для `Добавить`/`Оформить`, но есть HTML fallback.
- MainButton listener всегда снимается при route change.
- Haptic только дополнительный effect.
- requestWriteAccess предлагается после объяснения notifications, отказ не
  блокирует order.
- themes light/dark;
- inputs не перекрываются keyboard;
- closing confirmation только во время незавершённого submit, не постоянно.

## 12. Локализация

- RU/SR-Latn/EN для всех UI strings;
- source: saved choice → Telegram language → RU;
- переключение не очищает cart;
- price через `Intl.NumberFormat`;
- server error code переводится frontend;
- missing translation check в CI.

## 13. Состояния ошибок

- auth invalid/expired;
- menu load/retry;
- restaurant closed/manual day off;
- empty cart;
- item hidden/price changed;
- invalid quantity;
- contact denied/invalid;
- address missing;
- duplicate/lost response;
- server unavailable/offline;
- cancelled order.

Каждая ошибка имеет понятное действие: retry, исправить, открыть support. Нельзя
показывать stack trace.

## 14. Тесты

Component:

- menu/runtime banners;
- quantity/cart totals;
- persistence/reconciliation;
- checkout validation;
- phone grant/deny/manual;
- submit single click/timeout;
- status mapping;
- three locales/themes.

Playwright:

- open → add quantities → cart → cash order → status/history;
- reload cart;
- Monday/manual day off/after 21;
- hidden/price changed item;
- double click and lost response;
- чужой order forbidden;
- offline/reconnect;
- mobile keyboard.

Real Telegram Android/iOS/Desktop smoke:

- auth;
- safe area/Back/MainButton;
- contact grant/deny;
- close/reopen cart;
- notification permission;
- status refresh.

## Артефакты этапа

- Client Mini App;
- cart persistence;
- text phone/address checkout;
- cash order submit;
- status/history/support;
- localization;
- tests/device matrix.

## Acceptance criteria

- Клиент оформляет cash order без выбора чего-либо кроме dishes/quantity.
- Нет map/coordinates/zones/modifiers.
- Monday/manual `ВЫХОДНОЙ` даёт красную плашку и блокирует checkout.
- После 21:00 backend/frontend не создают order.
- Double tap/timeout создаёт ровно один order.
- Cart переживает закрытие Mini App.
- Client не читает чужой order.
- Flow пройден в реальном Telegram на основных устройствах.

## Не входит

- Kitchen/Courier UI.
- Рабочая card/crypto оплата. Информационная frontend-карточка будущей оплаты
  картой допустима, но не участвует в оформлении заказа.
- Promo/loyalty/preorder.
- Повтор заказа одной кнопкой.

## Критерий выхода

В staging реальный Telegram user может оформить один корректный cash order, а
backend автоматически создаёт его в status `NEW`.
