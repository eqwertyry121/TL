# GitHub Pages Frontend Hosting

Цель: хостить статический frontend Telegram Mini Apps на custom domain.

## URL

Production адрес:

```text
https://takolako.site/
```

Тестовая копия из ветки `test` публикуется рядом, не заменяя production:

```text
https://takolako.site/testbranch/
```

Этот URL указывается в Telegram/BotFather как Mini App URL.

Backend и Telegram webhooks не живут на GitHub Pages. Для них используется:

```text
https://api.takolako.site/
```

## Как устроено

- Source apps: `apps/client`, `apps/kitchen`, `apps/courier`, `apps/admin`
- Build output artifact:
  - `/` from `apps/client/dist`
  - `/kitchen/` from `apps/kitchen/dist`
  - `/courier/` from `apps/courier/dist`
  - `/admin/` from `apps/admin/dist`
  - `/testbranch/` and staff/admin subpaths from the same apps in branch `test`
- Workflow: `.github/workflows/pages.yml`
- В workflow используется официальный GitHub Pages deploy через Actions.
- Frontend deploy запускается после успешного `Backend CI` для `main` или
  `test`. Workflow всегда собирает единый artifact: production из `main` и
  тестовую копию из `test`, поэтому один deploy не удаляет другой.
- Production frontend собирается с `VITE_API_BASE_URL=https://api.takolako.site`
  и ходит в backend по HTTPS.
- Test frontend собирается с
  `VITE_API_BASE_URL=https://api.takolako.site/testbranch-api`.

## Что нужно включить в GitHub

1. Добавить рабочий SSH-доступ к репозиторию или подключить GitHub-доступ в
   Codex.
2. В DNS домена настроить `A` records для `takolako.site` на GitHub Pages и
   `CNAME www -> eqwertyry121.github.io`.
3. В GitHub repo открыть `Settings -> Pages`.
4. В `Custom domain` указать `takolako.site`.
5. В `Build and deployment` выбрать source `GitHub Actions`.
6. Для автоматического backend deploy на VPS добавить GitHub secrets:
   `TK_DEPLOY_HOST`, `TK_DEPLOY_USER`, `TK_DEPLOY_SSH_KEY`, `TK_DEPLOY_PATH`.
   Если их нет, `Backend CI` выполнит проверки, но deploy job будет пропущен.
7. Push branch `main`.
8. Дождаться зелёного deploy и открыть URL выше.
9. После выпуска сертификата включить `Enforce HTTPS`.

## Ограничения

GitHub Pages не подходит для backend и секретов. Нельзя хранить Telegram Bot
Token, payment secrets, database URL и private keys в `public/` или в git.

Если `api.takolako.site` ещё не поднят на VPS, production frontend откроется,
но реальные API-запросы, Telegram contact и GPS-check работать не будут.
