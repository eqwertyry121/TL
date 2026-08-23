# Изолированный тестовый стенд

Ветка `test` регулярно синхронизируется с `main`, после чего в неё добавляются
новые функции для проверки. Production продолжает собираться только из `main`.

## Адреса

- Client: `https://takolako.site/testbranch/`
- Client alias для Telegram: `https://takolako.site/testbranch/main/`
- Kitchen: `https://takolako.site/testbranch/kitchen/`
- Courier: `https://takolako.site/testbranch/courier/`
- Admin: `https://takolako.site/testbranch/admin/`
- Test API и webhook: `https://api.takolako.site/testbranch-api/`

GitHub Pages публикует единый artifact: production из `main` остаётся в корне,
а сборка `test` помещается в `/testbranch/`. Поэтому deploy любой из двух веток
не удаляет соседний контур.

## Изоляция от production

Тестовый backend использует:

- Compose project `takolako-test`;
- порт `127.0.0.1:18081`;
- отдельный PostgreSQL volume;
- deploy path `<TK_DEPLOY_PATH>-test`;
- uploads `/srv/tk-delivery-test/uploads`;
- отдельный Telegram bot token, webhook secret и session keys.

Production database, uploads, bot token и webhook не используются.

## Однократная настройка

1. Добавить содержимое `deploy/nginx.test-path.example.conf` внутрь
   существующего server block `api.takolako.site`, затем выполнить `nginx -t`
   и reload. Новая DNS-запись и новый сертификат не нужны.
2. В GitHub Actions создать repository secret
   `TK_TEST_CLIENT_BOT_TOKEN`. Токен нельзя добавлять в variables или git.
3. Push в `test` запускает CI, отдельный backend deploy, combined GitHub Pages
   deploy, public healthcheck, Telegram webhook и test Mini App menu button.
   После первичного добавления секрета тот же deploy можно запустить вручную:
   Actions → Backend CI → Run workflow → ветка `test`.

Workflow сам получает username тестового бота через `getMe`. Runtime secrets,
пароль тестовой PostgreSQL и webhook secret генерируются на VPS при первом
deploy и сохраняются в `.env.test` с правами `0600`.

## Продвижение изменений

1. Обновить `test` из актуального `main`.
2. Реализовать функцию только в `test` и провести UAT.
3. После подтверждения открыть PR `test -> main`.
4. Не переносить тестовую БД, uploads или `.env.test` в production.

## Проверка

```text
https://api.takolako.site/testbranch-api/ready
https://takolako.site/testbranch/
https://takolako.site/testbranch/kitchen/
https://takolako.site/testbranch/courier/
https://takolako.site/testbranch/admin/
```

После первого deploy открыть тестового бота: его menu button должен вести на
`https://takolako.site/testbranch/main/`. Затем создать тестовый заказ и
провести его через Kitchen и Courier до `DELIVERED`.
