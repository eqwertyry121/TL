# Этап 0 — исходные данные и контент

## Цель

Получить реальные данные ресторана и зафиксировать несколько решений, без
которых coding-агент начнёт выдумывать production-настройки.

На этом этапе не пишется основная бизнес-логика.

## Критерии входа

- Владелец согласен с упрощённым flow из мастер-ТЗ.
- Подтверждено: один ресторан, один courier, четыре роли, до 50 orders/day.

## 1. Карточка ресторана

Создать `docs/product-config.md`:

- public name RU/SR/EN;
- logo и основные цвета;
- адрес ресторана;
- support Telegram username/phone;
- ссылка/текст условий доставки;
- валюта RSD;
- timezone Europe/Belgrade.

Файлы логотипа и фотографий должны иметь понятный источник и право
использования.

## 2. Рабочее время

Зафиксировать начальные значения:

- Monday closed;
- Tuesday–Sunday open 13:00–22:00;
- checkout 13:00–21:00;
- manual ADMIN day-off switch;
- текст красной плашки: `ВЫХОДНОЙ`;
- сообщение вне времени приёма, например
  `Заказы принимаем сегодня с 13:00 до 21:00`.

Подтвердить, остаётся ли меню доступным для просмотра в режиме `ВЫХОДНОЙ`.
Default мастер-ТЗ: остаётся.

## 3. Меню

Подготовить таблицу/JSON без технических IDs:

- category RU/SR-Latn/EN;
- dish name RU/SR-Latn/EN;
- description RU/SR-Latn/EN;
- price RSD;
- weight/portion display, если нужен;
- allergen text, если нужен;
- image file;
- sort order;
- visible yes/no.

Отдельно подтвердить:

- максимальное количество одного блюда в order;
- максимальный общий комментарий;
- можно ли заказывать скрытое блюдо из старой сохранённой корзины — default нет.

В fixtures не добавлять options, sizes или ingredient inventory.

## 4. Доставка

Подтвердить:

- единая стоимость доставки для всех адресов;
- либо доставка бесплатная;
- нужен ли минимальный заказ — актуальный default: нет;
- какие поля адреса обязательны;
- текст предупреждения проверить адрес/телефон.

Не собирать полигоны, координаты и API ключи карт. Внешняя карта получает
только готовую текстовую строку адреса по нажатию курьера.

## 5. Сотрудники и bots

Получить:

- Telegram ID первого ADMIN;
- Telegram ID Kitchen;
- Telegram ID единственного Courier;
- client bot username/token;
- staff bot username/token;
- staging bots отдельно от production, если возможно.

Token хранится только в secret storage/`.env` вне git. В документе записываются
username и owner, но не token.

## 6. Оплата и касса

Подтвердить:

- cash нужен в MVP — default да;
- карта нужна в первом production release или позже;
- конкретный card provider и наличие merchant sandbox/docs;
- crypto нужна или кнопка остаётся скрытой;
- кто отвечает за фискальный чек;
- существующая касса используется вручную или есть fiscal API;
- как оформляется refund.

Отсутствие card/crypto данных не блокирует этапы 1–4. Эти способы просто не
показываются.

## 7. Простые wireframes

Зафиксировать без pixel-perfect дизайна:

### Client

Menu → Dish quantity → Cart → Contact/address → Confirm/pay → Order status.

### Kitchen

```text
НОВЫЕ ЗАКАЗЫ

Заказ #104 · 8 минут
2 × Хинкали
1 × Хачапури
Комментарий: ...

[ ЗАКАЗ ГОТОВ ]
                      [⋯]
```

### Courier

```text
ДОСТАВКИ

Заказ #104
Адрес: ...
Телефон: ...
Наличными: 2 400 RSD

[ ДОСТАВЛЕНО ]
                      [⋯]
```

### Admin

Menu / Orders / Staff / Schedule / Analytics / Settings. На главной странице
крупный switch `Остановить приём заказов`.

## 8. Минимальные тексты

Подготовить RU/SR-Latn/EN:

- `ВЫХОДНОЙ`;
- приём закрыт до следующего времени;
- order accepted/preparing;
- order in delivery;
- delivered/cancelled;
- kitchen/courier notification templates;
- support/invalid address/payment error;
- согласие с delivery terms.

## Артефакты этапа

- `docs/product-config.md`;
- menu data и images;
- staff/bot identifiers без secrets;
- payment/fiscal decision status;
- wireframes;
- тексты трёх языков.

## Acceptance criteria

- В меню нет sizes/options/modifiers и inventory.
- Указана единая цена доставки либо zero.
- График точно соответствует Monday off, 13–22, checkout до 21.
- Известны Telegram IDs всех initial staff.
- Card/crypto явно marked enabled later либо есть official integration input.
- Kitchen и Courier wireframes имеют по одной основной кнопке.
- Все неизвестные production-значения имеют owner, а не выдуманный default.

## Не входит

- Backend/frontend implementation.
- Юридическая консультация.
- Создание merchant account за владельца.

## Критерий выхода

Coding-агент может начать проект без вопросов о меню, staff flow и базовых
настройках. Внешние оплаты могут оставаться отдельным блокером этапа 5.
