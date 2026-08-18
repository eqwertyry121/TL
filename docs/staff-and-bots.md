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
| `ADMIN` | `8241921060` | owner/tester |
| `KITCHEN` | `8241921060` | owner/tester |
| `COURIER` | `8241921060` | owner/tester |

Telegram ID должен быть числовым ID пользователя, не `@username`.

## Owner/tester access

Для разработки и тестирования Telegram ID `1048084234` и `8241921060` получают
доступ к staff-проекциям `ADMIN`, `KITCHEN` и `COURIER`, чтобы один человек мог
пройти весь flow. Это не добавляет пятую роль и не создаёт production-role
`GOD`.

В production staff-доступы больше не редактируются через Admin UI. Список
owner/tester ID задаётся кодом/конфигом через `BOOTSTRAP_OWNER_TELEGRAM_IDS`
(`1048084234,8241921060` для текущего проекта). При старте backend каждый ID из
списка получает активные staff-роли `ADMIN`, `KITCHEN` и `COURIER`.

Legacy-переменная `BOOTSTRAP_OWNER_TELEGRAM_ID` оставлена только для обратной
совместимости локального/dev flow; новый список имеет приоритет.

## Правило хранения

- `.env.example` содержит только имена переменных.
- Реальные tokens хранятся в `.env.local`, GitHub Actions secrets или VPS
  secrets.
- `raw initData`, tokens, phone и address не логируются.
