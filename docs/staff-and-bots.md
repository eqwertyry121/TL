# Staff And Bots

Статус: Stage 0 draft. В документе нельзя хранить bot tokens.

## Bots

| Назначение | Username | Token |
|---|---|---|
| Client bot | нужно уточнить | передан один token, локально не сохранён |
| Staff bot | нужно создать/уточнить | нужно предоставить отдельно |

Открытый вопрос: переданный token относится к client bot или staff bot.

Решение мастер-ТЗ: для production нужны два bot:

- public client bot для клиентов;
- закрытый staff bot для Kitchen/Courier/Admin.

## Staff Telegram IDs

| Роль | Telegram ID | Статус |
|---|---|---|
| Первый `ADMIN` | нужно предоставить | blocker для админ-доступа |
| `KITCHEN` | нужно предоставить | blocker для staff flow |
| Единственный `COURIER` | нужно предоставить | blocker для доставки |

Telegram ID должен быть числовым ID пользователя, не `@username`.

## Правило хранения

- `.env.example` содержит только имена переменных.
- Реальные tokens хранятся в `.env.local`, GitHub Actions secrets или VPS
  secrets.
- `raw initData`, tokens, phone и address не логируются.
