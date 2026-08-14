# Stage 0 Open Items

Эти данные нужны от владельца, чтобы закрыть этап 0 и перейти к этапу 1.

## GitHub

- Добавить SSH public key этой машины в GitHub account или как deploy key с
  write access для `eqwertyry121/TL`.
- Либо подключить GitHub-доступ в Codex, если удобнее работать через connector.
- После этого агент сможет push и проверить GitHub Pages deploy.

## Telegram

- Client bot username: `@TakoLako_main_bot`.
- Переданный token временно относится к `@TakoLako_main_bot`, но перед
  production его нужно заменить через BotFather.
- Создать второй bot для staff, если его ещё нет.
- Первый Admin Telegram ID: `1048084234`.
- Для локального теста этот же Telegram ID получает `KITCHEN` и `COURIER`.
- Перед production заменить Kitchen/Courier на реальные Telegram IDs.
- Перед production заменить раскрытый в чате token через BotFather.

## Ресторан

- Public name RU/SR/EN.
- Адрес ресторана.
- Support Telegram username: `@Tako_Lako`.
- Логотип и право использования.
- Цвета, если есть брендовые.
- Для публичных юридических страниц: полное наименование ИП из APR, matični
  broj, PIB, юридический адрес, адрес ресторана, рабочие email и телефон.
- Подтвердить с бухгалтером/юристом опубликованный draft условий продажи,
  возврата и конфиденциальности перед включением оплаты картой.

Сейчас используются fixture-значения из `docs/product-config.md`.

## Меню

- Production-меню позже заменить вместо fixture `docs/menu-fixtures.csv`.
- Передать фотографии блюд.
- Передать weight text, если нужно показывать.
- Максимум количества одного блюда в заказе сейчас fixture `99`.

## Доставка

- Доставка зафиксирована как бесплатная: `0 RSD`.
- Подтвердить обязательные поля адреса.
- Подтвердить текст предупреждения проверить адрес/телефон.

## Оплата и касса

- Подтвердить, что cash включён в MVP.
- Решить, нужна ли карта в первом production release.
- Если карта нужна, передать official merchant docs/sandbox.
- Решить, кто отвечает за фискальный чек.
- Решить, касса ведётся вручную или будет fiscal API.
