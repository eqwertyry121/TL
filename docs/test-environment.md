# Изолированный тестовый стенд

Тестовый стенд автоматически обновляется из ветки `test` после успешного
`Backend CI`. Production продолжает обновляться только из `main`.

## Адреса

- Client: `https://test.takolako.site/`
- Client alias: `https://test.takolako.site/main/`
- Kitchen: `https://test.takolako.site/kitchen/`
- Courier: `https://test.takolako.site/courier/`
- Admin: `https://test.takolako.site/admin/`
- API и Telegram webhook: `https://test.takolako.site/api/`

Один тестовый hostname выбран специально: он требует только одной DNS-записи и
одного TLS-сертификата, но данные и процессы остаются изолированными.

## Изоляция от production

Тестовый контур использует:

- Compose project `takolako-test`;
- backend port `127.0.0.1:18081`;
- отдельный PostgreSQL volume;
- отдельный deploy path `<TK_DEPLOY_PATH>-test`;
- отдельный uploads directory;
- отдельный Telegram bot token и webhook secret;
- отдельный frontend build из ветки `test`.

Production database, uploads, bot token, webhook и frontend не используются.

## Однократная настройка

1. Создать DNS `A`/`AAAA` для `test.takolako.site` на тот же VPS.
2. Установить `deploy/nginx.test.host.example.conf` как отдельный Nginx site,
   сверить его `root` с фактическим `<TK_DEPLOY_PATH>-test`, проверить
   `nginx -t`, reload и выпустить TLS-сертификат.
3. В GitHub Actions создать repository secret
   `TK_TEST_CLIENT_BOT_TOKEN`. Токен нельзя добавлять в variables или git.
4. При нестандартном hostname создать repository variable
   `TK_TEST_BASE_URL` с полным HTTPS URL.
5. В BotFather установить Mini App URL `https://test.takolako.site/main/`.
6. Push в `test` запускает проверки, сборку четырёх Mini Apps, отдельный
   backend deploy, public healthcheck и установку Telegram webhook.

Workflow переиспользует существующие production SSH secrets только для входа
на тот же VPS. Сам test deploy выполняется в отдельный sibling path и Compose
project. Runtime secrets, пароль тестовой PostgreSQL и webhook secret
генерируются на VPS при первом deploy и затем сохраняются в `.env.test` с
правами `0600`.

## Продвижение изменений

1. Разработка и UAT идут в `test`.
2. После проверки открыть PR `test -> main`.
3. В production попадает тот же проверенный commit либо merge commit после CI.
4. Нельзя копировать тестовую БД, uploads или `.env.test` в production.

## Проверка

После deploy проверить:

```text
https://test.takolako.site/ready
https://test.takolako.site/
https://test.takolako.site/kitchen/
https://test.takolako.site/courier/
https://test.takolako.site/admin/
```

Затем создать один тестовый заказ и провести его через Kitchen и Courier до
`DELIVERED`.
