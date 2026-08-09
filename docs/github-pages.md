# GitHub Pages Preview

Цель: дать временный HTTPS URL для Telegram Mini App до покупки домена.

## URL

Ожидаемый адрес после deploy:

```text
https://eqwertyry121.github.io/TL/
```

Этот URL можно указать в Telegram/BotFather как временный Mini App URL.

## Как устроено

- Source: `public/`
- Workflow: `.github/workflows/pages.yml`
- В workflow используется официальный GitHub Pages deploy через Actions.
- Сейчас это static demo prototype на fixture-данных. Backend API, Telegram
  webhooks и база позже будут жить на VPS.

## Что нужно включить в GitHub

1. Добавить рабочий SSH-доступ к репозиторию или подключить GitHub-доступ в
   Codex.
2. Push branch `main`.
3. В GitHub repo открыть `Settings -> Pages`.
4. В `Build and deployment` выбрать source `GitHub Actions`.
5. Запустить workflow `Deploy GitHub Pages preview`, если он не стартовал сам.
6. Дождаться зелёного deploy и открыть URL выше.

## Ограничения

GitHub Pages не подходит для backend и секретов. Нельзя хранить Telegram Bot
Token, payment secrets, database URL и private keys в `public/` или в git.
