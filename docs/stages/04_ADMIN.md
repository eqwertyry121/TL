# Этап 4 — Admin и простая аналитика

## Цель

Дать ADMIN понятный полный контроль над прикладной системой: меню, график,
ручной `ВЫХОДНОЙ`, orders, staff, settings и базовые цифры. Всё делается без
SQL и deploy.

## Критерии входа

- Этап 3 принят.
- Известен первый ADMIN Telegram ID.
- Утверждены menu fields, schedule и flat delivery fee.
- Есть реальные или test images.

## 1. Навигация

Нижнее/боковое меню:

- `Главная`;
- `Меню`;
- `Заказы`;
- `Сотрудники`;
- `График`;
- `Аналитика`;
- `Настройки`.

Главная:

- принимает ли ресторан orders;
- крупный switch `Остановить приём заказов`;
- current new/out-for-delivery counts;
- orders/revenue today;
- последние ошибки notifications/payments.

## 2. Ручной `ВЫХОДНОЙ`

### Включение

1. ADMIN нажимает switch.
2. Confirm:
   `Новые заказы будут остановлены. Уже созданные заказы останутся активны.`
3. Backend ставит `manual_day_off=true` с optimistic version.
4. Client runtime немедленно начинает возвращать closed.
5. На Client показывается красная плашка `ВЫХОДНОЙ`.
6. Checkout server-side blocked.

### Выключение

- `manual_day_off=false`;
- backend снова проверяет обычный weekday/time;
- если сейчас Monday/вне 13–21, orders всё равно closed с правильной причиной.

Audit хранит ADMIN, time, old/new. Switch не отменяет existing orders.

## 3. График

Простая форма недели:

- closed checkbox;
- open time;
- order cutoff;
- restaurant close time.
- кнопки открытия/закрытия дня сохраняют график сразу, чтобы ADMIN мог быстро
  включить понедельник для теста и сразу проверить Client;
- ручное редактирование времени сохраняется кнопкой `Сохранить график`.

Initial:

- Monday closed;
- Tue–Sun open 13, cutoff 21, close 22.

Validation:

- open < cutoff ≤ close;
- no multiple intervals/day;
- timezone fixed Europe/Belgrade;
- preview: `Если сейчас [time], можно ли заказать?`.

После save changes применяются сразу к новым checkout. Никакого сложного
holiday calendar в первой версии; разовый праздник закрывается manual
`ВЫХОДНОЙ`.

## 4. Categories

List:

- title;
- visible;
- sort;
- item count;
- edit/archive.

Form:

- title RU/SR-Latn/EN;
- sort order;
- visible.

Удаление:

- пустую никогда не использованную category можно удалить;
- с items/history — archive;
- скрытая/archived category скрывает блюда из Client.

## 5. Dishes

List:

- thumbnail/title/category/price;
- visible switch;
- edit;
- archive/delete.

Form:

- RU/SR-Latn/EN title/description;
- price RSD;
- photo;
- weight text;
- allergen text RU/SR-Latn/EN;
- category;
- sort;
- visible.

Нет вкладок variants/options/ingredients/stock.

### Сохранение

- local form validation;
- backend validation/version;
- direct save без сложного draft workflow;
- если visible dish price меняется, confirm с old/new;
- menu version меняется;
- Client polling/next request получает new menu;
- existing order items remain snapshot.

### Видимость

ADMIN может быстро hide/show. Это заменяет отдельный operational availability
screen. Kitchen ничего не управляет.

### Photo

- JPEG/PNG/WebP;
- проверять decoded content, размер/dimensions;
- re-encode/strip EXIF;
- random filename;
- persistent volume;
- old file удаляется только если больше не используется;
- никаких SVG/base64 in DB.

## 6. Orders

Tabs/filters:

- `NEW`;
- `OUT_FOR_DELIVERY`;
- `DELIVERED`;
- `CANCELLED`;
- date/search public number/phone.

Detail:

- composition snapshot;
- totals/payment;
- contact/address;
- `@username` клиента кликабелен и открывает Telegram ЛС, если username есть;
- timestamps/status history;
- notification attempts.

Actions:

- cancel с required reason;
- return `OUT_FOR_DELIVERY → NEW` при ошибочном Kitchen click;
- исправить phone/address;
- resend client/courier message;
- full refund online payment после этапа 5;
- add internal note.

Не создавать field/dropdown «выбрать любой status». Каждое действие отдельно и
проверяется backend.

## 7. Staff

List:

- Telegram ID;
- display label;
- role;
- active.

Actions:

- add numeric Telegram ID;
- role KITCHEN/COURIER/ADMIN;
- deactivate/reactivate;
- invalidate active sessions on deactivation.

Правила:

- username не используется как identity;
- один active COURIER по текущему product scope;
- нельзя отключить последнего ADMIN;
- любое изменение audit.

Система может технически хранить несколько staff records, но business flow
рассчитан на одного active courier и не распределяет orders.

## 8. Settings

- flat delivery fee;
- max dish quantity;
- max comment/address lengths;
- support Telegram/phone;
- text/link terms;
- enabled payment methods;
- notification toggles/templates при необходимости.

Secrets отсутствуют. Card/crypto нельзя enabled, если backend не видит
production-ready provider config.

## 9. Аналитика

Обычные PostgreSQL queries, без warehouse/materialized pipeline.

Filters:

- today;
- 7 days;
- current month;
- custom date range с разумным max.

Cards/tables:

- count all/delivered/cancelled;
- revenue only paid/delivered according to confirmed accounting rule;
- average check;
- cash/card/crypto;
- top dishes by quantity;
- daily rows.

Важно:

- использовать order item snapshots;
- исключать pending/failed payment;
- refunds subtract;
- local day Europe/Belgrade;
- test orders excluded flag;
- показывать generated time;
- CSV export без phone/address.

Не нужны charts ради charts: достаточно компактных cards/table, один простой
line/bar chart допустим, если реально помогает.

## 10. Audit

ADMIN view:

- who;
- action;
- target/public order;
- timestamp;
- safe before/after;
- reason.

Обязательно:

- day-off/schedule;
- menu/price/visibility;
- staff;
- cancel/return/edit contact;
- refund/payment action.

Phone/address не дублировать в audit plaintext; показывать masked/change marker.

## 11. Security и UX

- Backend ADMIN check на каждом endpoint.
- Forms use optimistic version, stale edit gets conflict.
- User text rendered as text, not raw HTML.
- Confirm destructive/financial actions.
- Mobile и Telegram Desktop layout.
- Clear success/error/request ID.
- Dirty form warning.
- No secret/config environment in browser.

## 12. Тесты

Backend:

- role matrix all admin endpoints;
- manual day off overrides and audit;
- schedule validation;
- category/dish CRUD/archive/history;
- visibility immediately changes menu/calculation;
- price change preserves old order;
- upload spoof/oversize/path traversal;
- one active courier/last admin protection;
- order commands and audit redaction;
- analytics golden small dataset.

E2E:

- add/edit/hide/show/archive dish;
- upload/replace image;
- change price and Client sees update;
- turn `ВЫХОДНОЙ` on/off and Client banner/checkout;
- edit schedule;
- add/deactivate staff;
- cancel/return order;
- analytics/CSV.

## Артефакты этапа

- Admin Mini App;
- menu/photo management;
- manual day off/schedule;
- order console;
- staff;
- settings;
- simple analytics/CSV;
- audit.

## Acceptance criteria

- ADMIN controls all daily functions without developer/SQL.
- One switch blocks checkout and shows exact red `ВЫХОДНОЙ` banner.
- Kitchen has no menu/visibility controls.
- Dish can be add/edit/hide/archive easily, historical orders remain correct.
- Schedule defaults exactly Monday off, Tue–Sun 13–22, checkout to 21.
- Analytics matches a manually calculated test set.
- Non-ADMIN cannot access any Admin endpoint.

## Не входит

- Complex draft/publish CMS.
- Holiday calendar.
- Warehouse/stock.
- Advanced BI/LTV/cohorts.
- Secret management.

## Критерий выхода

Владелец может самостоятельно управлять рестораном и видеть базовые результаты,
не усложняя staff интерфейсы.
