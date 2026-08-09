# Этап 5 — карты, крипто и фискализация

## Цель

Подключить только реально нужные и готовые payment methods, обеспечить чек и
возврат. Cash остаётся базовым. Card/crypto скрыты, пока их integration не
готова полностью.

## Критерии входа

- Этап 4 принят.
- Бухгалтер подтвердил fiscal process.
- Для card: official merchant docs, sandbox и credentials.
- Для crypto: отдельное решение owner/legal, approved provider и актуальная
  проверка Telegram rules.

Если внешних данных нет, cash/fiscal часть делается, а card/crypto substeps
переносятся. UI не показывает неработающие кнопки.

## 1. Общая модель payment

Payment method:

- `CASH`;
- `CARD`;
- `CRYPTO`.

Payment status:

- `PENDING`;
- `CASH_PENDING`;
- `PAID`;
- `FAILED`;
- `EXPIRED`;
- `CANCELLED`;
- `REFUND_PENDING`;
- `REFUNDED`;
- `REVIEW_REQUIRED`.

Fulfillment остаётся только:

`NEW → OUT_FOR_DELIVERY → DELIVERED`, плюс `CANCELLED`.

Payment status не заменяет fulfillment.

## 2. Cash

- Создание order: `CASH_PENDING + NEW`.
- Courier detail показывает exact total.
- `ДОСТАВЛЕНО` требует confirm cash received.
- После success: `PAID + DELIVERED`.
- Если наличные не получены/не совпадают, courier не завершает и открывает
  `⋯ → Проблема`; ADMIN решает вручную.
- ADMIN exception имеет reason/audit.
- При отмене неоплаченного cash order payment становится `CANCELLED`.

## 3. Card provider gate

До кода заполнить provider mapping:

- create checkout endpoint;
- amount/minor units/currency;
- hosted checkout/3-D Secure behavior;
- success/fail return;
- webhook signature/raw body;
- event IDs/status mapping;
- server query;
- expiration;
- full refund;
- sandbox test cards;
- production URLs/rate limits.

Нельзя выбирать Alta/NestPay/другой processor «на глаз».

## 4. Card flow

1. Client получает свежий server calculation.
2. Выбирает card.
3. Backend создаёт pending `checkout_intent`/payment attempt с idempotency.
4. Provider возвращает exact allowlisted hosted checkout URL.
5. Telegram открывает checkout/external browser способом, проверенным на
   Android/iOS/Desktop.
6. Return page показывает `Проверяем оплату` и polls backend.
7. Backend принимает raw webhook, проверяет signature/event/amount/currency.
8. `PAID` атомарно создаёт настоящий order `NEW` из сохранённого immutable
   checkout snapshot и notification Kitchen/staff.
9. Failed/expired не появляется Kitchen.

Browser redirect никогда не ставит `PAID`.

## 5. Expiry/late/duplicate

- Pending attempt имеет provider-supported expiration.
- DB worker отмечает `EXPIRED`.
- Duplicate/reordered webhook обрабатывается один раз по provider event ID.
- Поздняя оплата expired/cancelled order:
  `REVIEW_REQUIRED`, ADMIN alert, Kitchen не запускается.
- ADMIN проверяет provider и делает full refund либо отдельно подтверждённое
  ручное решение.

`checkout_intents` хранят server calculation, contact/address snapshot, actor,
expiry и idempotency. Failed/expired intent не попадает в обычный список
Kitchen orders.

## 6. Full refund

Для простоты первая версия поддерживает только полный refund:

- ADMIN order detail → `Вернуть оплату`;
- confirm number/amount/reason;
- provider idempotency key;
- `REFUND_PENDING`;
- webhook/server query → `REFUNDED`;
- fiscal cancellation/correction;
- client notification;
- audit.

Partial refunds не входят.

## 7. Crypto gate

Crypto — опционально и не блокирует запуск.

Требования:

- готовый provider, без private keys/nodes на нашем VPS;
- один утверждённый asset/network;
- точный server quote в integer atomic/decimal, никогда float;
- expiry;
- signed webhook/server query;
- under/over/wrong/late → `REVIEW_REQUIRED`;
- no Kitchen before confirmed `PAID`;
- full refund process;
- fiscal/accounting decision.

Перед реализацией повторно проверить актуальные Telegram Blockchain Guidelines.
Если TON-compatible/правовой flow не подтверждён, `crypto=false` и кнопки нет.

## 8. Fiscalization

Выбрать один вариант:

### A. Existing cash register/manual process

- ADMIN/staff получает понятную инструкцию, когда пробить чек;
- order хранит fiscal status/reference, введённый ADMIN;
- список orders без чека;
- cancel/refund требует отметку о сторно;
- production UAT с бухгалтером.

### B. Fiscal API

Provider adapter:

- issue receipt;
- cancel/refund receipt;
- query status;
- retry.

Receipt data из order snapshot:

- items/quantity/unit/total;
- flat delivery line;
- payment type;
- tax category из menu item, если требуется;
- public order reference.

Временный сбой visible ADMIN и retries. Нельзя молча считать чек выпущенным.

## 9. Простая сверка

Admin report за день:

- internal paid cash/card/crypto;
- delivered/cancelled;
- refunds;
- provider totals;
- fiscal issued/missing/cancelled;
- discrepancies.

CSV/manual comparison достаточно для 50 orders/day. Отдельный reconciliation
service не нужен.

## 10. Security

- PAN/CVV не проходят backend и не хранятся.
- Provider secrets только server env.
- Exact checkout domain allowlist.
- Raw webhook signature, replay/unique event and body limit.
- Проверка amount/currency/order/provider merchant.
- Payment data/logs redacted.
- Refund only ADMIN and audited.
- Staging/production credentials separate.
- Feature flag cannot enable missing/invalid provider.

## 11. Тесты

Cash:

- cash delivered/confirmed;
- no cash confirmation;
- duplicate delivered.

Card sandbox:

- success/decline/cancel/timeout;
- invalid signature;
- wrong amount/currency;
- duplicate/reordered webhook;
- close TMA/reopen;
- return before/after webhook;
- expiry/late payment;
- full refund success/failure/duplicate.

Crypto if enabled:

- correct/under/over/wrong asset;
- expiry/late;
- duplicate event;
- refund.

Fiscal:

- issue;
- duplicate/retry;
- failure visible;
- cancel/refund;
- daily missing check.

Device:

- hosted checkout/3DS Android/iOS/Desktop.

## Артефакты этапа

- cash fiscal flow;
- provider adapters for enabled methods;
- Client payment selector only for ready methods;
- webhook/expiry/refund;
- Admin payment/fiscal view;
- daily reconciliation;
- runbooks.

## Acceptance criteria

- Cash has agreed fiscal result.
- Card/crypto buttons do not exist unless end-to-end ready.
- Redirect/invalid webhook cannot create `NEW`.
- Duplicate event produces one payment/order.
- Late/ambiguous payment never launches Kitchen.
- Full refund and fiscal correction are auditable.
- Daily totals can be manually reconciled.

## Не входит

- Own payment gateway/wallet/node.
- Partial refund.
- Chargeback automation.
- Multiple crypto assets/networks.

## Критерий выхода

Every enabled payment method has passed sandbox/device/accounting UAT. Methods
without complete integration remain hidden without blocking cash release.
