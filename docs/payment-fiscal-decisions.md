# Payment And Fiscal Decisions

Статус: Stage 0 draft.

## MVP

| Вопрос | Решение |
|---|---|
| Наличные | включить в MVP |
| Карта | не блокирует этапы 1-4, подключается позже по официальным docs/sandbox |
| Криптовалюта | скрыта до отдельного compliant provider |
| Refund | для online payments только через provider, детали позже |

## AltaPay onboarding draft

Данные основаны на owner-provided APR extract/решении и ответе владельца от
17.08.2026. Точные требования документов и финальные технические поля должны
подтвердить AltaPay/прихватный банк.

| Вопрос | Значение |
|---|---|
| Provider candidate | AltaPay e-commerce |
| Merchant | `Siarhei Dashchynski pr Ugostiteljska radnja TAKO LAKO Novi Sad` |
| Matični broj | `68187907` |
| PIB | `115213491` |
| PDV status | `nije u sistemu PDV-a` |
| Šifra delatnosti | `5610 - Delatnosti restorana i pokretnih ugostiteljskih objekta` |
| Datum početka obavljanja delatnosti | `03.11.2025` |
| Status | активан, по APR extract |
| RSD poslovni račun | указан в APR extract; отправлять AltaPay напрямую, не хранить в client bundle |
| Public website | `https://takolako.site/` |
| Telegram Mini App bot | `@TakoLako_main_bot` |
| Monthly orders estimate | `150` |
| Average order | `4500 RSD` |
| Maximum order | `10000 RSD` |
| Monthly card turnover estimate | `750000 RSD` |
| Markets | Serbia only |
| Currency | RSD only |
| Signatory | direktor / preduzetnik |
| Electronic signature | нет |
| Blockade/debt/bankruptcy | нет, по ответу владельца |

## Fiscal decision draft

| Вопрос | Решение |
|---|---|
| Фискализация | существующий POS terminal/каса |
| Чек клиенту | бумажный и/или электронный вариант |
| Ответственный за рекламации | менеджер |
| Production gate | бухгалтер должен подтвердить, когда пробивается чек для cash/card, как отражается доставка `0 RSD`, и как оформляется сторно/возврат |

## Нужно от владельца

| Вопрос | Owner | Статус |
|---|---|---|
| Нужна ли карта в первом production release | владелец | да, через AltaPay e-commerce |
| Card processor и merchant sandbox/docs | владелец | ждём официальный ответ AltaPay |
| Нужна ли crypto-кнопка вообще | владелец | нужно решить позже |
| Кто отвечает за фискальный чек | владелец/бухгалтер | текущий процесс: POS terminal/касса; нужно подтверждение бухгалтера |
| Касса вручную или fiscal API | бухгалтер | manual existing kasa draft; подтвердить до production |
| Правила отмены/возврата | бухгалтер/provider | public draft обновлён; подтвердить до card production |

Без фискального решения production-продажи не включаются.
