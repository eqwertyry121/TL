# Domain architecture

Статус: актуальная схема после покупки `takolako.site`.

## Hosts

| Host | Назначение | Где живёт |
|---|---|---|
| `https://takolako.site/` | Client Mini App | GitHub Pages |
| `https://takolako.site/kitchen/` | Kitchen Mini App | GitHub Pages |
| `https://takolako.site/courier/` | Courier Mini App | GitHub Pages |
| `https://takolako.site/admin/` | Admin Mini App | GitHub Pages |
| `https://api.takolako.site/` | Go backend, API, media, Telegram webhooks | VPS/Nginx |

GitHub Pages хранит только статический frontend. PostgreSQL, секреты,
Telegram tokens, webhook logic, phone verification и GPS verification находятся
только на backend.

## DNS

Для GitHub Pages:

```text
A      @     185.199.108.153
A      @     185.199.109.153
A      @     185.199.110.153
A      @     185.199.111.153
CNAME  www   eqwertyry121.github.io
```

После появления VPS:

```text
A      api   <VPS_PUBLIC_IP>
```

## Frontend build

`.github/workflows/pages.yml` собирает все frontend apps с:

```text
VITE_APP_ENV=production
VITE_DEMO_MODE=false
VITE_API_BASE_URL=https://api.takolako.site
```

Поэтому после deploy frontend сразу работает с real backend. Если backend ещё
не поднят, API-запросы будут падать — это ожидаемо.

## Backend production env

Минимальные production values:

```text
APP_ENV=production
HTTP_ADDR=:8080
APP_PUBLIC_BASE_URL=https://api.takolako.site
APP_ALLOWED_ORIGINS=https://takolako.site,https://www.takolako.site
POSTGRES_DSN=postgres://...
APP_ENCRYPTION_KEY=<32-byte-base64-or-long-secret>
PII_HASH_KEY=<different-32-byte-base64-or-long-secret>
TELEGRAM_CLIENT_BOT_USERNAME=TakoLako_main_bot
TELEGRAM_CLIENT_BOT_TOKEN=<secret>
TELEGRAM_STAFF_BOT_USERNAME=<staff_bot_username>
TELEGRAM_STAFF_BOT_TOKEN=<secret>
TELEGRAM_WEBHOOK_SECRET=<long-random-secret>
BOOTSTRAP_OWNER_TELEGRAM_IDS=1048084234,8241921060,8609105840,7604602332
BOOTSTRAP_OWNER_TELEGRAM_ID=1048084234
LOCAL_ROLE_SWITCHER_ENABLED=false
NOTIFICATION_DRY_RUN=false
MEDIA_DIR=/app/uploads
```

Secrets must be stored only in VPS environment/secrets, never in git.

## Telegram setup

BotFather Mini App URL for client bot:

```text
https://takolako.site/
```

Client bot webhook for Telegram contact and GPS:

```text
https://api.telegram.org/bot<CLIENT_BOT_TOKEN>/setWebhook?url=https://api.takolako.site/api/v1/telegram/client/webhook&secret_token=<TELEGRAM_WEBHOOK_SECRET>
```

Do not paste real bot token into docs, screenshots or commits.

## Cash phone/GPS flow

1. Client opens `https://takolako.site/` inside Telegram.
2. Frontend authenticates with backend using Telegram `initData`.
3. Client presses “Поделиться телефоном”.
4. Telegram sends native contact to client bot webhook.
5. Backend stores encrypted phone and `phone_verified_at`.
6. Client calculates cart.
7. Frontend creates cash-location challenge at backend.
8. Backend sends Telegram `request_location` keyboard to the same user.
9. Frontend immediately opens the client bot chat so the user sees where to
   press the location button.
10. If Telegram hides the keyboard, user can send `/share` to show it again.
    `/share` does not send GPS by itself.
11. On Telegram desktop/web, where the bot keyboard may send plain text instead
    of a location object, user must open the order on a phone and send native
    Telegram location from the bot chat.
12. Production backend does not accept browser/Mini App coordinates for cash
    verification. The session-protected WebApp location endpoint is development
    only.
13. Telegram sends native location to client bot webhook.
14. Backend checks distance to `45.241970, 19.808807` within configured radius.
15. Backend stores only status/distance/accuracy, not exact client coordinates.
16. Only then `/orders` can create cash order `NEW`.
