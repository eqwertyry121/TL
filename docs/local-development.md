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

GitHub Pages builds the same app in staging demo mode, because production
backend is not deployed yet.

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
go run ./backend/cmd/app
```

Or start PostgreSQL and backend together:

```powershell
docker compose up --build
```

Backend URL:

```text
http://127.0.0.1:8080
```

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
