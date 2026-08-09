# Этап 1 — фундамент и backend

## Цель

Создать минимальный монорепозиторий, PostgreSQL schema, Telegram auth, роли,
меню, график и безопасный API заказов. В конце backend можно проверить
автоматическими API-тестами без готового UI.

## Критерии входа

- Этап 0 принят либо есть обезличенные fixtures.
- Известны Go module name, bot audiences и initial ADMIN Telegram ID.
- Подтверждён упрощённый state flow.

## 1. Структура

```text
/apps
  /client
  /kitchen
  /courier
  /admin
/packages
  /api-client
  /telegram
  /ui
  /i18n
/backend
  /cmd/app
  /internal/auth
  /internal/catalog
  /internal/orders
  /internal/staff
  /internal/admin
  /internal/payments
  /internal/notifications
  /migrations
/deploy
/docs
/tests
```

Один `backend/cmd/app` запускает:

- HTTP API;
- Telegram webhook handlers;
- простой background loop notification jobs/expired payments.

Не создавать отдельные services.

## 2. Стек

- Go stable pinned;
- `chi` HTTP router;
- `pgx` + parameterized queries/`sqlc`;
- PostgreSQL;
- migration tool;
- React + TypeScript + Vite + pnpm;
- OpenAPI 3.1, generated TypeScript types/client;
- Go tests, Vitest, Testing Library, Playwright;
- Docker Compose и Nginx.

Версии pinned lock files. Не подключать большую UI-библиотеку, если общий
маленький component set покрывает интерфейс.

## 3. Конфигурация

`.env.example`:

- environment/public origins;
- DB connection;
- client/staff bot IDs/tokens;
- session TTL;
- initData max age;
- encryption key;
- media path;
- timezone/currency;
- notification polling/retry;
- feature flags cash/card/crypto;
- payment/fiscal adapter mode.

Production не запускается с fake bot/provider, default encryption key или
wildcard origins.

## 4. PostgreSQL schema

### Identity

`users`:

- UUID;
- telegram_user_id bigint unique;
- safe profile name/language;
- encrypted phone + normalized keyed hash;
- timestamps/status.

`staff`:

- user_id/telegram_user_id;
- role enum `KITCHEN|COURIER|ADMIN`;
- active;
- created_by/timestamps.
- unique `(telegram_user_id, role)`;
- один Telegram user может иметь несколько staff roles для owner/tester flow.

`sessions`:

- hash random token;
- user ID/role/audience;
- expires_at/revoked_at.

Token в БД хранится только hash. Один random token не менее 256 bit.

### Menu

`categories`:

- UUID;
- title_ru/title_sr/title_en;
- sort_order;
- visible;
- archived.

`menu_items`:

- UUID/category;
- title/description RU/SR/EN;
- price_minor/currency;
- photo_path;
- weight_text;
- allergen_text RU/SR/EN;
- sort_order;
- visible;
- archived;
- version.

Никаких option/variant/inventory tables.

### Orders

`orders`:

- UUID и unique public number;
- client user ID;
- fulfillment `NEW|OUT_FOR_DELIVERY|DELIVERED|CANCELLED`;
- payment method/status;
- subtotal/delivery fee/total integer minor;
- encrypted phone/address snapshot;
- customer comment;
- locale;
- created/ready/delivered/cancelled timestamps;
- version.

`order_items`:

- order/item reference;
- snapshot title;
- unit price;
- quantity;
- line total.

`order_events`:

- order, from/to/action;
- actor role/user;
- reason;
- timestamp/request ID.

`idempotency_keys`:

- actor + operation + key unique;
- request hash;
- result order/status;
- expiry.

`notification_jobs`:

- recipient bot/chat;
- template + order/event reference без копии phone/address;
- status, attempts, next attempt, error code.

`app_settings`:

- schedule;
- order cutoff;
- manual_day_off;
- flat delivery fee;
- support;
- feature flags.

`audit_log` для ADMIN/menu/staff/settings/order actions.

### Payments

Создать только provider-neutral skeleton:

- `payment_attempts`;
- `payment_events` unique provider event;
- `refunds`.

Конкретные provider fields добавляются этапом 5.

## 5. Telegram auth и сессия

`POST /api/v1/auth/telegram`:

1. frontend передаёт raw `initData` и app identifier;
2. backend выбирает client/staff Bot Token по allowlist;
3. проверяет официальный Telegram HMAC и `auth_date`;
4. upsert user;
5. для staff проверяет active role;
6. выдаёт случайную DB session;
7. возвращает `me`.

Frontend держит session token только в памяти. При новом открытии снова
проходит Telegram auth.

Initial ADMIN создаётся CLI-командой с numeric Telegram ID. Потом ADMIN
добавляет остальных через UI/API.

Local bootstrap seed:

- `BOOTSTRAP_OWNER_TELEGRAM_ID=1048084234`;
- создать staff-доступы `ADMIN`, `KITCHEN`, `COURIER` для этого ID;
- frontend staff app может предложить переключение активной роли только среди
  ролей, разрешённых backend.

## 6. Runtime/menu API

`GET /runtime`:

- server time/timezone;
- принимает ли ресторан orders;
- reason: schedule/manual day off;
- next order opening;
- manual banner text;
- flat delivery fee;
- enabled payments;
- supported locales/support.

`GET /menu?locale=`:

- visible, non-archived categories/items;
- price/photo/weight/allergen;
- version/ETag.

В 21:00 menu остаётся readable, но runtime/checkout закрыт.

## 7. Расписание

Seed:

- Mon closed;
- Tue–Sun open 13:00–22:00;
- accepting 13:00–21:00.

Функция `CanAcceptOrder(serverNow)`:

- сначала manual_day_off;
- затем weekday;
- затем local time;
- возвращает bool, reason и next opening.

Проверка выполняется на checkout внутри той же server operation. Frontend clock
не используется.

## 8. Расчёт и создание cash order

`POST /orders/calculate`:

- принимает item IDs/quantities;
- проверяет visible/not archived;
- проверяет quantity limits;
- читает реальные prices;
- считает subtotal + flat delivery fee;
- возвращает calculation token/short expiry и breakdown.

`POST /orders`:

- session + Idempotency-Key;
- calculation token;
- phone/address/comment;
- payment method cash;
- terms acceptance.

В одной транзакции:

- повторно проверить schedule/manual day off;
- проверить calculation;
- сохранить order snapshot/items;
- `payment=CASH_PENDING`;
- `fulfillment=NEW`;
- записать event/audit/notification job;
- завершить idempotency result.

Повтор того же key возвращает тот же order. Новый key означает новый явный
заказ.

## 9. Конкретные staff commands

`POST /kitchen/orders/{id}/ready`:

- role KITCHEN;
- expected current `NEW`;
- idempotency + expected version;
- set `OUT_FOR_DELIVERY`;
- ready_at;
- два notification jobs: client + courier;
- event/audit.

`POST /courier/orders/{id}/delivered`:

- role COURIER;
- current `OUT_FOR_DELIVERY`;
- cash confirmation/amount;
- set `DELIVERED`;
- cash `PAID`;
- delivered_at;
- client notification;
- event/audit.

`POST /admin/orders/{id}/cancel` и `return-to-kitchen`:

- only ADMIN;
- reason required;
- payment/fiscal consequences validated;
- audit.

Нет generic status endpoint.

## 10. Polling read API

- `GET /kitchen/orders` → только `NEW`, без phone/address;
- `GET /courier/orders` → `OUT_FOR_DELIVERY` с address/phone;
- `GET /orders/{id}` → client only own, staff projection by role;
- `GET /orders` → client history;
- `GET /admin/orders` → filters/history.

Поддержать `updated_since` или ETag, чтобы polling был лёгким. При 50 orders/day
обычных indexes достаточно.

## 11. Notification worker

- Jobs создаются в той же transaction, что status.
- Loop выбирает due rows через PostgreSQL lock.
- Worker по order reference получает нужную role-safe информацию только в
  момент отправки.
- Bot API timeout/retry/backoff.
- Unique business event+recipient не отправляется дважды.
- Permanent `bot blocked` marked failed и не откатывает order.
- Тексты локализованы по user language.
- Courier notification содержит address/phone; client notification не содержит
  лишний PII.

## 12. Media

- Upload позже через Admin API, но storage interface создаётся сейчас.
- Production path — persistent mounted directory, не container layer.
- Random safe filename, только decoded JPEG/PNG/WebP.
- Max size/dimensions, strip EXIF через re-encode.
- Nginx/Go отдаёт versioned URL.

## 13. Ошибки

Единая schema:

- `code`;
- `message_key`;
- `request_id`;
- safe details.

Основные:

- `AUTH_INVALID/EXPIRED`;
- `FORBIDDEN`;
- `RESTAURANT_CLOSED`;
- `MANUAL_DAY_OFF`;
- `ITEM_UNAVAILABLE`;
- `PRICE_CHANGED`;
- `INVALID_QUANTITY`;
- `ORDER_STATUS_CONFLICT`;
- `IDEMPOTENCY_CONFLICT`;
- `PAYMENT_NOT_CONFIRMED`.

## 14. Тесты

Unit:

- Monday closed;
- Tue–Sun before 13, 13–21 accepted, after 21 rejected;
- manual day off overrides schedule;
- next opening;
- money/quantity/flat delivery;
- state transitions/roles;
- locale fallback.

Integration:

- valid/forged/stale/wrong-bot initData;
- CLIENT cannot call staff;
- KITCHEN cannot see address;
- COURIER sees only out-for-delivery;
- concurrent duplicate checkout creates one order;
- concurrent ready/delivered creates one transition/notifications;
- archived/price-changed item rejected/recalculated;
- notification retry;
- migrations on clean DB.

## Артефакты этапа

- monorepo skeleton;
- Docker local environment;
- migrations;
- auth/sessions/roles;
- menu/runtime/schedule;
- cash calculation/order;
- staff commands/read projections;
- notification queue/worker;
- OpenAPI/generated client;
- CI format/lint/test/build.

## Acceptance criteria

- API cash flow проходит от calculation до `DELIVERED`.
- State chain содержит только `NEW → OUT_FOR_DELIVERY → DELIVERED`.
- Monday/manual day off/after 21 реально блокируют order server-side.
- Kitchen response не содержит phone/address.
- Один duplicate request не создаёт второй order/notification.
- Schema не содержит zones/options/inventory/courier assignment.
- Project поднимается одной documented командой.

## Не входит

- Готовые пользовательские интерфейсы.
- Реальные card/crypto/fiscal providers.
- Production deployment.

## Критерий выхода

Backend полностью поддерживает простой flow и готов для четырёх небольших
frontend без дополнительной доменной логики в браузере.
