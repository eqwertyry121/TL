# Local Development

## Static Mini App preview

The current Client Mini App lives in `apps/client`.

```powershell
pnpm client:dev
```

Open:

```text
http://127.0.0.1:5173/
```

GitHub Pages builds the same app in demo mode, because production
backend is not deployed yet.

## Staff Mini Apps

Kitchen:

```powershell
pnpm kitchen:dev
```

Open:

```text
http://127.0.0.1:5174/
```

Courier:

```powershell
pnpm courier:dev
```

Open:

```text
http://127.0.0.1:5175/
```

Admin:

```powershell
pnpm admin:dev
```

Open:

```text
http://127.0.0.1:5176/
```

In demo mode, Client/Kitchen/Courier/Admin share browser
`localStorage`. Create a cash order in Client, open Kitchen, press
`ЗАКАЗ ГОТОВ`, then open Courier and press `ДОСТАВЛЕНО`. Admin can also hide
demo dishes, change delivery fee and toggle manual `ВЫХОДНОЙ`; Client will see
those demo changes in the same browser. Real cross-device sync requires
PostgreSQL and backend deployment.

Demo mode also has `Crypto TEST`: it marks a demo order as paid without real
money, provider, wallet or webhook. It is only for UI/staff-flow testing and is
not a production payment integration.

## Static preview

The old root `public/` preview was removed. Use the Vite apps instead:

```powershell
pnpm client:dev
pnpm admin:dev
pnpm kitchen:dev
pnpm courier:dev
```

## Backend with PostgreSQL

Start only PostgreSQL:

```powershell
docker compose up -d postgres
$env:POSTGRES_DSN = "postgres://tk_delivery:tk_delivery@localhost:15432/tk_delivery?sslmode=disable"
$env:PII_HASH_KEY = "change-me-local-dev-pii-hash-key"
pnpm api:dev
```

Or start PostgreSQL and backend together:

```powershell
docker compose up --build
```

Backend URL:

```text
http://127.0.0.1:18080
```

Default local Docker ports avoid common conflicts with other local projects:

- backend host port: `18080` → container `8080`;
- PostgreSQL host port: `15432` → container `5432`.

If these ports are busy too, override them before starting compose:

```powershell
$env:APP_HOST_PORT = "18081"
$env:POSTGRES_HOST_PORT = "15433"
docker compose up --build
```

Uploaded menu photos are served from `/media/...` and stored in `MEDIA_DIR`
(`backend/uploads` by default). This folder is ignored by git.

## Dev sessions

Dev auth is disabled in production. Locally it creates a session for API smoke
tests without Telegram `initData`.

Client:

```powershell
$client = Invoke-RestMethod http://127.0.0.1:8080/api/v1/dev/session `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"telegram_user_id":1048084234,"role":"CLIENT","phone":"+381600000000"}'
```

Kitchen/Courier/Admin use the same endpoint with `KITCHEN`, `COURIER` or
`ADMIN`. Telegram ID `1048084234` is seeded with all three staff roles for local
testing.

For the bootstrap owner in `development`, cash-location challenge is verified
without real GPS so the full cash flow can be tested locally. In production this
bypass is disabled.

## Telegram contact and location webhook

Real Telegram contact/location confirmation requires the backend to be reachable
from Telegram by public HTTPS. Local `127.0.0.1` is not enough; use the VPS or a
temporary HTTPS tunnel during integration testing.

Production cash-location verification accepts only native Telegram location
sent to the bot. Browser or Mini App coordinates are accepted only in
development/testing and must not be used for real cash orders.

Set a secret in `.env.local` or deployment secrets:

```powershell
$env:TELEGRAM_WEBHOOK_SECRET = "long-random-string"
```

Then register the client bot webhook:

```text
https://api.telegram.org/bot<CLIENT_BOT_TOKEN>/setWebhook?url=https://<backend-domain>/api/v1/telegram/client/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Do not put the real bot token or webhook secret in git, docs, screenshots or
logs.

## Minimal cash-flow smoke

1. `GET /api/v1/menu`
2. `POST /api/v1/orders/calculate` with a client bearer token
3. `GET /api/v1/contact`; for real Telegram it must be verified by
   `request_contact`, for local bootstrap owner `/dev/session` can seed it
4. `POST /api/v1/cash-location/challenges` with the calculation token
5. wait until challenge status is `VERIFIED`
6. `POST /api/v1/orders` with `Idempotency-Key` and
   `cash_location_challenge_id`
7. `GET /api/v1/kitchen/orders` with a kitchen token
8. `POST /api/v1/kitchen/orders/{id}/ready`
9. `GET /api/v1/courier/orders` with a courier token
10. `POST /api/v1/courier/orders/{id}/delivered`

If the restaurant is closed by schedule or manual `ВЫХОДНОЙ`, order creation
returns `RESTAURANT_CLOSED` or `MANUAL_DAY_OFF`. Menu and calculation remain
available.

## DEV city-location help smoke

The one-time Mini App city check and its contextual help are gated by both
`VITE_DEV_SANDBOX=true` and the server's `city_verification_enabled` flag.
No help is shown before an attempt. Denied permission opens a compact centered
application dialog over a dimmed checkout. It has one permission action, two
CSS-cropped original Telegram screenshots (off/on) and a support link to
https://t.me/eqwertyry. No close control, Escape dismissal or backdrop dismissal.
This is an application dialog, not an OS permission prompt; Telegram still
requires the user's consent.

The access-settings button calls `LocationManager.openSettings()` directly
from a tap, only for an initialized manager with location available and
previously requested but ungranted permission. Unsupported/throwing settings
show a short retry error. Without a supported settings action the button retries
the native location request. Opening settings never verifies the city by itself.
After an explicit settings tap, SDK permission updates, app activation and focus
resume the location/server check once access is granted. A 500 ms timer only reads
the local SDK flag (no GPS/network polling); waiting expires after 60 seconds.
Unmounting cancels listeners/timers and late callbacks. The dialog stays open
during retries and server checks, displaying relevant failure text when needed.
Non-permission failures hide the off/on screenshots. The support link remains
available while waiting and on failure. Successful verification hides the block.

Run the isolated UI smoke (no restaurant orders or real Telegram calls):

```powershell
pnpm client:location:test
$env:VITE_APP_ENV = "production"
$env:VITE_DEMO_MODE = "false"
$env:VITE_DEV_SANDBOX = "true"
$env:VITE_API_BASE_URL = "https://city-test.invalid"
$env:VITE_BASE_PATH = "/"
pnpm --filter @tk-delivery/client build
pnpm --filter @tk-delivery/client exec vite preview --host 127.0.0.1 --port 4183
```

In another terminal run `node tests/city-location-ui.mjs`. It covers success,
denial, retry, timeout, unavailable location, inaccurate/outside-area results,
network failure, settings invocation/fallback, automatic resume and duplicate-event
protection, blocked dismissal, support navigation, unmount cleanup, RU/SR/EN
and 320/360/768 px layouts. Screenshots
are written to `test-results/city-location/`. Stop the preview after testing;
do not publish this mock-API build.
