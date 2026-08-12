# Production alerts

Минимальный production-мониторинг для одного VPS без отдельной инфраструктуры.

## Что проверяется

- `API_HEALTH_URL` — публичный `/health`, который проверяет доступность backend и PostgreSQL.
- `notification_jobs.status = 'failed'` — если Telegram-уведомления перестали отправляться, админ получает alert.

Скрипт не спамит: одна ошибка отправляется один раз, после восстановления приходит отдельное recovery-сообщение.

## Установка на VPS

1. Скопировать репозиторий на VPS.
2. Заполнить переменные в `deploy/.env.production` или отдельном env-файле для cron:

```sh
API_HEALTH_URL=https://api.takolako.site/health
ALERT_BOT_TOKEN=123456:telegram-bot-token
ALERT_CHAT_ID=1048084234
FAILED_NOTIFICATION_THRESHOLD=1
COMPOSE_FILE=/opt/tk-delivery/deploy/docker-compose.api.yml
PROJECT_DIR=/opt/tk-delivery/deploy
```

`ALERT_BOT_TOKEN` можно взять от того же Telegram-бота, но лучше позже сделать отдельного технического alert-бота.

3. Проверить вручную:

```sh
sh /opt/tk-delivery/deploy/health-alert.sh
```

4. Добавить cron раз в минуту:

```cron
* * * * * . /opt/tk-delivery/deploy/.env.production; sh /opt/tk-delivery/deploy/health-alert.sh >/dev/null 2>&1
```

## Важное

- Скрипт не логирует Telegram-токен.
- `ALERT_STATE_DIR` по умолчанию `/var/lib/tk-delivery-alerts`; там хранятся только флаги уже отправленных alerts.
- Если `docker compose` или compose-файл недоступны, проверка failed notification jobs пропускается, но `/health` продолжает проверяться.
