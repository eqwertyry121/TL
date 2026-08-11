# Pay Layer Research — Serbia card/IPS payments

Дата: 2026-08-09  
Статус: ресерч/decision notes, к реализации вернуться позже.

## Контекст

Ресторан — один небольшой бизнес в Сербии. Есть ИП/предпринимательский бизнес и
business account в `Alta Banka`. Цель: дать клиенту возможность оплатить заказ
сербской картой, а деньги должны приходить на бизнес-счёт ресторана.

Важно: “подключить карту Alta/Raiffeisen/Postanska” — неправильная постановка.
Нужно подключить интернет-эквайринг/payment provider для ресторана. После этого
клиент сможет платить картой своего банка, если provider поддерживает card
scheme: Visa, Mastercard, DinaCard и т.д.

## Предварительный вывод

Первый кандидат: `Alta Banka / AltaPay + Payten`.

Причины:

- business account ресторана уже в Alta Banka;
- AltaPay предлагает e-commerce solution для sole proprietors/legal entities in
  Serbia;
- AltaPay заявляет Visa/Mastercard и IPS QR;
- Payten уже делал для Alta Banka card + instant payment integration;
- для маленького ресторана это самый прямой путь: договор, settlement на Alta
  business account, локальная поддержка.

Запасные варианты:

1. PaySpot — сербский provider, card + IPS.
2. Raiffeisen e-commerce — Visa/Mastercard/DinaCard, Apple Pay/Google Pay.
3. OTP / Banca Intesa / UniCredit — крупные банки с e-commerce acquiring.
4. Monri / Payten WebPay — сильный gateway/integrator, 3DS, PCI DSS.

Stripe не считать основным вариантом для сербского ИП: по official Stripe
availability Serbia не выглядит как обычная fully supported страна для открытия
локального merchant account.

## Как должен платить клиент

Клиентская карта может быть:

- Alta Visa/Dina;
- Raiffeisen Visa/Mastercard/Dina;
- Banka Poštanska štedionica Visa/Mastercard/Dina;
- другая сербская или иностранная Visa/Mastercard.

Flow:

1. Client выбирает блюда.
2. Нажимает `Оплатить картой`.
3. Backend создаёт checkout/payment attempt у provider.
4. Provider возвращает hosted checkout URL.
5. Client открывает защищённую страницу provider/bank.
6. Client вводит card number, expiry, CVV.
7. Issuer делает 3D Secure: SMS OTP, mBanking confirm, PIN/biometrics.
8. Provider шлёт webhook на backend.
9. Backend проверяет signature/event/amount/currency.
10. Только после этого backend создаёт order `NEW`.
11. Kitchen видит заказ.

Запрещено:

- принимать card number/CVV внутри нашего приложения;
- хранить PAN/CVV;
- создавать order `NEW` по browser redirect/success page;
- показывать card/IPS кнопку до полностью рабочей provider integration.

## DinaCard

DinaCard важна для Сербии. Для merchant acceptance нужно заключить договор с
банком/acquirer. Для online acceptance нужен `DinaCard Secure` / 3DS-подобный
flow. Alta Banka уже сообщает о DinaCard Secure для своих карт, но merchant
тоже должен иметь active support.

Вопрос к provider: поддерживает ли наш merchant/Mini App `DinaCard Secure`.

## IPS QR / IPS deep link

IPS — это не card payment, а instant bank transfer через mBanking.

Плюсы:

- клиент не вводит card data;
- платёж идёт через банк;
- часто дешевле card acquiring;
- хорошо подходит для локальных клиентов в Сербии.

Минусы:

- это отдельный payment method, не “карта”;
- нужно проверить UX внутри Telegram Mini App;
- нужен provider/bank, который даёт online IPS QR/deep link integration и
  webhook/status query.

Желаемый порядок:

1. Cash — уже есть.
2. Card — основной online payment method.
3. IPS QR/deep link — второй сербский online method, если AltaPay/Payten даст
   нормальные docs/API.

## Вопросы к Alta / AltaPay

Отправить в Alta/AltaPay:

```text
We have a Serbian preduzetnik / restaurant with a business account in Alta Banka.
We are building a Telegram Mini App for food delivery and want to accept online payments.

Please confirm:

1. Do you provide e-commerce acquiring for small restaurants / food delivery?
2. Can settlement be paid to our existing Alta Banka business RSD account?
3. Which card brands are supported: Visa, Mastercard, DinaCard, UnionPay, AmEx?
4. Is DinaCard Secure supported for online payments?
5. Do you support hosted checkout page / redirect flow?
6. Do you provide sandbox credentials and test cards?
7. Do you provide server-to-server webhook notifications?
8. How is webhook signature verified?
9. Do you support full refund via API?
10. Do you support payment status query API?
11. Do you support IPS QR / IPS deep link for online checkout?
12. What are fees: setup, monthly fee, transaction %, refund fee, chargeback fee?
13. What is settlement timing: T+1, T+2, other?
14. Are Telegram Mini Apps allowed as a sales channel?
15. What public legal pages are required: terms, privacy, refund policy, company data?
16. What fiscal receipt requirements do you expect from merchant side?
```

## Что запросить у любого provider

До кода нужны:

- merchant agreement status;
- sandbox credentials;
- official API docs;
- create checkout endpoint;
- webhook docs;
- webhook signature verification;
- status query endpoint;
- refund endpoint;
- test cards/test scenarios;
- allowed checkout domains;
- success/fail/cancel return URLs;
- fees and settlement timing;
- supported card brands;
- supported currencies, likely `RSD`;
- chargeback/refund rules;
- fiscal/receipt expectations.

## Техническая архитектура

GitHub Pages не подходит для настоящих оплат. Нужен публичный backend на HTTPS,
потому что provider будет слать webhook.

Flow:

```text
Client Mini App
  ↓ create checkout
Backend
  ↓ create payment at provider
Provider hosted checkout
  ↓ customer pays + 3DS
Provider webhook
  ↓ verified by backend
Backend creates order NEW
  ↓
Kitchen sees order
```

Backend model:

- `checkout_intents` — immutable snapshot of cart/contact/address/payment method;
- `payment_attempts` — provider refs/status/amount/currency;
- `payment_events` — unique provider event IDs to deduplicate webhooks;
- `refunds` — full refund only for first version;
- order `NEW` is created only after verified `PAID`.

Payment statuses target:

- `PENDING`;
- `CASH_PENDING`;
- `PAID`;
- `FAILED`;
- `EXPIRED`;
- `CANCELLED`;
- `REFUND_PENDING`;
- `REFUNDED`;
- `REVIEW_REQUIRED`.

Fulfillment remains separate:

`NEW → OUT_FOR_DELIVERY → DELIVERED`, plus `CANCELLED`.

## Implementation rule

Use provider adapter, not hardcoded Alta logic across the codebase.

Suggested internal interface:

```text
PaymentProvider
  CreateCheckout(intent) -> hosted_checkout_url, provider_reference
  VerifyWebhook(raw_body, headers) -> event
  QueryPayment(provider_reference) -> status
  Refund(provider_reference, amount, idempotency_key) -> refund_reference
```

Provider secrets must live only in server environment variables.

## Security requirements

- PAN/CVV never touch backend.
- Provider secrets only server env.
- Raw webhook body size limit.
- Verify webhook signature.
- Unique provider event ID for replay protection.
- Verify amount, currency, merchant, provider reference.
- Browser redirect never marks payment as paid.
- Logs redact payment/customer sensitive data.
- Refund only ADMIN and audited.
- Staging/production credentials separate.
- Feature flag cannot enable card/IPS unless provider config is complete.

## Fiscalization

This remains a separate required decision before production.

Options:

### A. Existing cash register/manual process

- Admin/staff sees instruction when to issue receipt;
- order stores fiscal status/reference manually entered by ADMIN;
- list orders without receipt;
- cancellation/refund requires fiscal correction/storno marker.

### B. Fiscal API

- provider adapter issues receipt;
- cancels/refunds receipt;
- query status;
- retry failures;
- visible admin errors.

Need accountant decision:

- when receipt is issued for cash/card/IPS;
- how delivery fee is represented;
- cancellation/refund/storno process;
- whether existing cash register is enough.

## Recommended next action

1. Contact Alta/AltaPay with the question list above.
2. If they provide docs/sandbox and confirm Telegram Mini App channel — use
   Alta/AltaPay first.
3. If blocked, ask PaySpot and Raiffeisen in parallel.
4. Keep card/IPS hidden in UI until sandbox + device tests pass.
5. Implement cash fiscal/admin marking first if online provider onboarding takes
   time.

## Sources

- AltaPay e-commerce: https://altapay.rs/en/services/e-commerce/
- Payten + Alta Banka project: https://www.payten.com/en/news-events/news/payten-and-alta-banka-revolutionize-online-payments-electro-distribution-serbia-portal-instant-payment-integration/
- NBS IPS online payments: https://ips.nbs.rs/en/ips-mesta-i-nacini-placanja/ips-na-internet-prodajnim-mestima
- NBS accepting instant payments online: https://ips.nbs.rs/en/trgovci/prihvatanje-instant-placanja-na-internet-prodajnim-mestima
- DinaCard merchants: https://dinacard.nbs.rs/en/trgovci_akceptanti
- Alta DinaCard Secure: https://altabanka.com/secure-online-shopping-with-alta-dinacard-for-the-first-time-in-serbia-with-dinacard-secure-protection/
- Raiffeisen e-commerce Serbia: https://www.raiffeisenbank.rs/sr/privreda/prihvatanje-platnih-kartica/e-commerce.html
- OTP e-commerce corporate: https://www.otpbanka.rs/en/e-commerce-for-corporate/
- Payten WebPay by Monri: https://www.payten.com/en/offers/for-merchants/e-commerce/webpay-payment-gateway-monri/
- Payten Payment Gateway docs: https://merchantsafeunipay.com/msu/api/v2/doc
- Stripe global availability: https://stripe.com/global
