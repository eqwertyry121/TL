# Staff And Bots

Статус: Stage 0 draft. В документе нельзя хранить bot tokens.

## Bots

| Назначение | Username | Token |
|---|---|---|
| Client bot | `@TakoLako_main_bot` | передан один token, локально не сохранён |
| Staff bot | нужно создать/уточнить | нужно предоставить отдельно |

Открытый вопрос: переданный token считается token для `@TakoLako_main_bot`.
Перед production token нужно заменить через BotFather, потому что он был
передан в чате.

Решение мастер-ТЗ: для production нужны два bot:

- public client bot для клиентов;
- закрытый staff bot для Kitchen/Courier/Admin.

## Staff Telegram IDs

| Роль | Telegram ID | Статус |
|---|---|---|
| Первый `ADMIN` | `1048084234` | owner/tester |
| `KITCHEN` | `1048084234` | local tester |
| Единственный `COURIER` | `1048084234` | local tester |

Telegram ID должен быть числовым ID пользователя, не `@username`.

## Owner/tester access

Для локальной разработки Telegram ID `1048084234` получает доступ к staff
проекциям `ADMIN`, `KITCHEN` и `COURIER`, чтобы один человек мог пройти весь
flow. Это не добавляет пятую роль и не создаёт production-role `GOD`.

В production можно оставить `1048084234` как первый `ADMIN`, а реальные Kitchen
и Courier IDs заменить через Admin UI.

## Правило хранения

- `.env.example` содержит только имена переменных.
- Реальные tokens хранятся в `.env.local`, GitHub Actions secrets или VPS
  secrets.
- `raw initData`, tokens, phone и address не логируются.
