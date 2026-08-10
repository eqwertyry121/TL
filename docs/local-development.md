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

## Legacy static preview

```powershell
python -m http.server 4173 -d public
```

Open:

```text
http://127.0.0.1:4173/
```

## Backend with PostgreSQL

Start only PostgreSQL:

```powershell
docker compose up -d postgres
$env:POSTGRES_DSN = "postgres://tk_delivery:tk_delivery@localhost:15432/tk_delivery?sslmode=disable"
go run ./backend/cmd/app
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
  -Body '{"telegram_user_id":1048084234,"role":"CLIENT"}'
```

Kitchen/Courier/Admin use the same endpoint with `KITCHEN`, `COURIER` or
`ADMIN`. Telegram ID `1048084234` is seeded with all three staff roles for local
testing.

## Minimal cash-flow smoke

1. `GET /api/v1/menu`
2. `POST /api/v1/orders/calculate` with a client bearer token
3. `POST /api/v1/orders` with `Idempotency-Key`
4. `GET /api/v1/kitchen/orders` with a kitchen token
5. `POST /api/v1/kitchen/orders/{id}/ready`
6. `GET /api/v1/courier/orders` with a courier token
7. `POST /api/v1/courier/orders/{id}/delivered`

If the restaurant is closed by schedule or manual `ВЫХОДНОЙ`, order creation
returns `RESTAURANT_CLOSED` or `MANUAL_DAY_OFF`. Menu and calculation remain
available.
