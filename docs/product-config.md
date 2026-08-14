# Product Config

Статус: Stage 0 draft. Этот файл хранит только публичные и несекретные значения.

## Зафиксировано

| Поле | Значение |
|---|---|
| Проект | TK Delivery |
| Public name RU | Tako Lako |
| Public name SR-Latn | Tako Lako |
| Public name EN | Tako Lako |
| Репозиторий | `git@github.com:eqwertyry121/TL.git` |
| Production Mini App URL | `https://takolako.site/` |
| Production API URL | `https://api.takolako.site/` |
| Таймзона | `Europe/Belgrade` |
| Валюта | `RSD` |
| Координаты ресторана для cash geo-check | `45.241970, 19.808807` |
| Support Telegram | `@Tako_Lako` |
| Основные цвета | wine/qvevri palette: `#6B1F2A`, `#43141B`, `#F8F1E5`, `#FFFDF8`, `#B95532` |
| Ресторанов | 1 |
| Курьеров | 1 |
| Ожидаемая нагрузка | до 50 заказов в день |
| Роли | `CLIENT`, `KITCHEN`, `COURIER`, `ADMIN` |
| Понедельник | выходной |
| Вторник-воскресенье | 13:00-22:00 |
| Приём заказов | 13:00-21:00 |
| Ручная остановка заказов | Admin switch `Остановить приём заказов` |
| Красная плашка | `ВЫХОДНОЙ` |
| Меню в режиме `ВЫХОДНОЙ` | показывается, checkout заблокирован |
| Стоимость доставки | бесплатно, `0 RSD` |
| Минимальный заказ | нет |
| Максимум одного блюда в заказе | test fixture: `99` |
| Максимальная длина комментария | test fixture: `300` символов |

## Нужно от владельца

| Поле | Owner | Статус |
|---|---|---|
| Логотип | владелец | позже заменить test placeholder |
| Полное наименование ИП из APR | владелец | обязательно для public legal pages и эквайринга |
| Matični broj и PIB | владелец | обязательно для public legal pages и эквайринга |
| Юридический адрес ИП | владелец | обязательно для public legal pages и эквайринга |
| Реальный текстовый адрес ресторана | владелец | обязательно для контактов/документов |
| Рабочий email для заказов/рекламаций | владелец | обязательно; Telegram не заменяет email |
| Рабочий телефон продавца | владелец | обязательно для public legal pages |
| Реальная стоимость доставки | владелец | зафиксировано: бесплатно |

## Публичные юридические страницы

Client app содержит доступные без Telegram-авторизации страницы:

- `https://takolako.site/#/terms` — условия продажи и доставки;
- `https://takolako.site/#/returns` — отмена, рекламации и возврат;
- `https://takolako.site/#/privacy` — обработка персональных данных.

Текст опубликован на RU, SR-Latn и EN. Обязательные реквизиты подставляются при
сборке из public GitHub Actions variables `LEGAL_BUSINESS_NAME`,
`LEGAL_REGISTRATION_NUMBER`, `LEGAL_TAX_ID`, `LEGAL_REGISTERED_ADDRESS`,
`LEGAL_RESTAURANT_ADDRESS`, `LEGAL_EMAIL` и `LEGAL_PHONE`. Пока хотя бы один из
основных реквизитов пуст, страница явно помечает документ как черновик, не
готовый для проверки банка/эквайера.

## Секреты

Telegram Bot Token не записывается в этот файл и не коммитится. Токен,
переданный в чате, нужно считать раскрытым и заменить через BotFather перед
production.
