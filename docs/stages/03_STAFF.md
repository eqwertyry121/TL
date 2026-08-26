# Этап 3 — Kitchen и Courier

## Цель

Реализовать максимально простой рабочий процесс сотрудников:

Доставка: `NEW (Новые/В процессе) → одна кнопка Kitchen → OUT_FOR_DELIVERY → одна кнопка Courier → DELIVERED`.

Самовывоз: `NEW → одна кнопка Kitchen → READY_FOR_PICKUP → ЗАБРАН И ОПЛАЧЕН → DELIVERED`.

## Критерии входа

- Этап 2 принят.
- Staff bot настроен.
- Telegram IDs Kitchen и единственного Courier внесены.
- Утверждены notification texts и cash confirmation.

## 1. Общий staff bootstrap

- Открытие через staff bot.
- Backend validates raw initData against staff bot.
- Active role из PostgreSQL.
- KITCHEN видит только Kitchen app.
- COURIER видит только Courier app.
- ADMIN не получает staff action автоматически, если не назначена нужная роль;
  ADMIN использует собственный order console.
- Revoked staff session перестаёт работать.

Если открыть не свой URL, backend возвращает `FORBIDDEN`.

## 2. Kitchen polling

Каждые примерно 5 секунд:

- `GET /kitchen/orders`;
- response содержит только `NEW`;
- ETag/updated marker уменьшает payload;
- при resume — immediate refresh;
- visible indicator:
  `Обновлено N секунд назад` / `Нет связи`.

Нет WebSocket/SSE. При таком масштабе polling проще и достаточно быстрый.

## 3. Kitchen главный экран

Header:

- `НОВЫЕ ЗАКАЗЫ`;
- количество;
- connection indicator;
- button refresh.

Order row/card должен быть компактным, как список чатов в Telegram: одна
визуальная строка с аватаркой/инициалами клиента, номером, временем, пометкой
`Новый`/`Прочитано`, короткими метаданными и основной кнопкой. При этом кухня
не должна открывать отдельный экран, чтобы понять состав заказа.

В строке кухни:

- крупный `Заказ #N`;
- `@username` клиента кликабелен и открывает Telegram ЛС, если username есть;
- время и возраст заказа;
- все items сразу видны: quantity × title, без сворачивания в “ещё N”;
- комментарий, если есть;
- payment: `Наличные`/`Оплачен`;
- крупная кнопка `ЗАКАЗ ГОТОВ`;
- `⋯`.

Ordering: сначала самый старый. Внутри `NEW` кухня видит две организационные
группы: `НОВЫЕ` и `В ПРОЦЕССЕ`. На телефоне это вкладки, на планшете/широком
экране — колонки. Рабочий ресторанный планшет с минимальной шириной `663 dp`
должен уже показывать две колонки доставки без горизонтального overflow и
обрезания карточек; для самовывоза группа `ГОТОВЫ` переносится ниже, если трём
колонкам не хватает места. Произвольного drag-and-drop и ручной сортировки нет.

## 4. Kitchen action

Kitchen показывает два окна: `ДОСТАВКА` и `САМОВЫВОЗ`. В выбранном окне заказ
свайпом вправо переносится `НОВЫЕ → В ПРОЦЕССЕ`; backend атомарно записывает
`kitchen_started_at`, оставляя `fulfillment_status=NEW`. Самовывоз сортируется
по `pickup_at`, срочность всегда видна на карточке, готовые заказы находятся в
третьей группе `ГОТОВЫ`. Courier pickup-заказы не получает. Детали:
[PICKUP_SPEC.md](../PICKUP_SPEC.md).

Требования к свайпу:

1. Только ось X; вертикальный скролл страницы остаётся нативным.
2. Смещение ограничено шириной action-зоны, карточка не может улететь за экран.
3. Короткий жест пружинно возвращает карточку на место.
4. Переход выполняется только после distance/velocity threshold.
5. На широком экране layout-анимация переносит ту же карточку между колонками.
6. `prefers-reduced-motion` отключает заметное перемещение, но действие остаётся
   доступным.
7. При server conflict карточка возвращается на место и список обновляется.
8. Ошибочный свайп можно отменить через `⋯ → Вернуть в новые`.
9. После начала приготовления backend запрещает дозаказ в этот order.

После `ЗАКАЗ ГОТОВ`:

1. Короткий confirm: для доставки `Заказ #N готов и передаётся курьеру?`, для
   самовывоза `Заказ #N готов к выдаче в HH:MM?`.
2. Button progress/disabled.
3. `POST /kitchen/orders/{id}/ready` с idempotency и version.
4. Success доставки: card исчезает, backend status `OUT_FOR_DELIVERY`,
   уведомления queued клиенту и курьеру.
5. Success самовывоза: backend status `READY_FOR_PICKUP`, уведомление queued
   только клиенту, card остаётся в `ГОТОВЫ К ВЫДАЧЕ` до кнопки
   `ЗАБРАН И ОПЛАЧЕН` для наличных либо `ЗАБРАН` для уже оплаченного заказа.
6. Conflict означает, что order уже изменён ADMIN/другим устройством; refresh.
7. Timeout → проверить order state с тем же key, не создавать второй action.

Kitchen не нажимает «Принять» и не ставит business-status `PREPARING`.
`kitchen_started_at` является только внутренней отметкой начала приготовления.

Kitchen может одним нажатием сообщить клиенту ориентировочное время готовности.
Это отдельный timestamp, который не меняет status, не заменяет `ЗАКАЗ ГОТОВ` и
не ставит `kitchen_started_at`. UX, API и notification contract определены в
[DELIVERY_TIMING_SPEC.md](../DELIVERY_TIMING_SPEC.md).

## 5. Kitchen звук и экран

- Один заметный сигнал только при появлении нового order ID: готовая MP3-запись
  уведомления длительностью около 2,8 секунды воспроизводится три раза подряд с
  короткой паузой. Синтезированные WebAudio-мелодии не используются.
  Одновременные события не накладывают несколько сигналов друг на друга.
- Звук включён по умолчанию, без отдельной кнопки в интерфейсе.
- Подтверждения основных действий содержат только короткий вопрос и кнопки.
  Поясняющие подписи о внутренней логике уведомлений и переходов не выводятся.
- Из-за browser autoplay rules приложение best-effort готовит звук при старте,
  а если браузер блокирует автозвук — автоматически разблокирует его при первом
  касании/нажатии клавиши и проигрывает pending-сигнал для уже пришедшего
  заказа.
- Visual highlight и counter работают даже без звука.
- Wake Lock запрашивается best-effort при старте, после user action и повторно
  при возвращении app.
- Если OS/Telegram запретил Wake Lock, показать `Экран может выключиться`.
- Звук и Wake Lock не являются гарантией; staff bot message можно отправлять
  kitchen chat как дополнительный fallback, если владелец хочет.

## 6. Kitchen menu `⋯`

Только:

- `Подробнее`;
- `Вернуть в новые`, только для заказа `В ПРОЦЕССЕ`;
- `Сообщить о проблеме` — открыть ADMIN/support chat с номером.

Не добавлять:

- изменение menu;
- отмену;
- status choice;
- скрытие блюда;
- управление courier.

## 7. Courier notification

Для owner/courier ID `8609105840` действуют два ранних персональных alert:

- сразу после создания нового delivery-заказа;
- один раз при первом переводе заказа Kitchen в `В ПРОЦЕССЕ`.

Оба сообщения содержат номер, сумму и полный состав заказа, отправляются с
обычным Telegram sound notification и не создаются для самовывоза. Повтор
идемпотентного запроса и возврат карточки назад не должны дублировать alert.

При Kitchen ready backend отправляет единственному active COURIER:

- `Заказ #N готов к доставке`;
- address;
- phone;
- cash amount или `Оплачен`;
- button/link открыть Courier Mini App.

Job retry работает из PostgreSQL. Если Telegram notification не отправилось,
order всё равно появится app polling.

## 8. Courier polling

Каждые примерно 5 секунд:

- `GET /courier/orders`;
- все orders `OUT_FOR_DELIVERY`;
- самые старые ready first;
- backend возвращает внутреннюю пометку `courier_started_at`;
- no claim/assignment/mine/available sections;
- immediate refresh on resume.

Если orders несколько, courier сам решает последовательность.

## 9. Courier главный экран

Header `ДОСТАВКИ` + connection indicator.

Под header две крупные группы:

- `ВЕЗУ СЕЙЧАС` — карточки с `courier_started_at`;
- `ОТВЕЗТИ` — остальные готовые доставки.

На телефоне одновременно показывается только выбранная группа. На экранах от
48rem группы можно показать двумя колонками. Свайп вправо по карточке в
`ОТВЕЗТИ` атомарно ставит `courier_started_at`, после чего интерфейс открывает
`ВЕЗУ СЕЙЧАС`. Это не новый fulfillment status, не assignment и не сигнал
клиенту. Через `⋯` доступно `Вернуть в «Отвезти»`.

Card:

- number/ready time;
- аватарка/инициалы клиента и `@username`, если Telegram отдал username;
- `@username` кликабелен и открывает Telegram ЛС;
- пометка `Новый`/`Прочитано`;
- full text address;
- phone tap-to-call;
- items/quantities;
- payment;
- cash amount крупно;
- primary `ДОСТАВЛЕНО`;
- `⋯`.

Для единственного courier full address/phone доступны всем active courier
sessions. После завершения detail скрывает PII из обычного списка; history
может показывать только number/time/status.

## 10. Courier delivered

Online-paid:

- confirm `Заказ #N доставлен?`.

Cash:

- confirm `Получены наличные X RSD?`;
- без подтверждения action недоступен.

Request:

- idempotency + version;
- only current `OUT_FOR_DELIVERY`;
- success `DELIVERED`;
- cash payment `PAID`;
- client notification;
- event/audit.

Card исчезает из active list. Повтор request безопасен.

## 11. Courier menu `⋯`

- позвонить;
- скопировать адрес;
- открыть external map с URL-encoded text address;
- проблема с доставкой → ADMIN/support chat.
- `Вернуть в «Отвезти»`, только если стоит внутренняя пометка
  `courier_started_at`;
- быстрые кнопки `5/10/15/20 мин` открывают ЛС клиента с draft-сообщением
  `курьер TakoLako: приеду к вам через X минут`, если у клиента есть
  `@username`; если username нет, используется fallback-уведомление через bot.

Map — только внешняя ссылка. Система не получает coordinates, не строит и не
оптимизирует route.

Операции start/reset требуют роли COURIER, `Idempotency-Key` и актуальную
version, работают только для `OUT_FOR_DELIVERY`, пишут order event и не создают
Telegram notification.

Проблема с доставкой не создаёт новый status в первой версии. ADMIN решает:
исправить contact/address, вернуть order на кухню или отменить.

## 12. Client updates

Kitchen ready:

- client bot: `Заказ #N передан курьеру`;
- Client polling показывает `Заказ в доставке`.

Courier delivered:

- client bot: `Заказ #N доставлен`;
- Client polling показывает delivered.

Notification duplicate protection: recipient + order event unique.

## 13. Admin recovery

Временно минимальные backend/Admin actions:

- вернуть ошибочно готовый order `OUT_FOR_DELIVERY → NEW`;
- cancel с reason;
- resend notification.

Kitchen/Courier эти actions не видят.

## 14. Тесты

Backend:

- KITCHEN start/reset preparation только для `NEW`, с expected version и
  idempotency;
- start сохраняет `kitchen_started_at`, но не создаёт client/courier
  notifications и не меняет fulfillment status;
- start блокирует дальнейший дозаказ;
- KITCHEN ready только from NEW;
- COURIER delivered только from OUT_FOR_DELIVERY;
- roles forbidden;
- kitchen projection has no address/phone;
- duplicate ready/delivered one transition/job;
- cash confirmation;
- notification failure does not rollback status;
- admin return/cancel audited.

Frontend:

- swipe threshold/short-swipe reset/conflict reset;
- mobile tabs, tablet columns и `prefers-reduced-motion`;
- polling initial/new/removal;
- connection stale/recovery;
- sound dedupe and disabled fallback;
- Wake Lock denied;
- ready/delivered confirm;
- timeout/conflict;
- multiple courier orders simple list;
- menu `⋯` actions.

E2E:

1. Client cash order → Kitchen appears automatically.
2. No accept action; swipe order to `В ПРОЦЕССЕ`.
3. Kitchen one click/confirm ready.
4. Client and Courier notification.
5. Courier sees address/phone.
6. Courier one click/confirm delivered/cash.
7. Client sees delivered.
8. Repeat with Telegram message failure: polling still works.
9. Repeat accidental ready: ADMIN returns to NEW.

## Артефакты этапа

- Kitchen Mini App;
- Courier Mini App;
- polling;
- reliable Telegram messages;
- sound/Wake Lock best-effort;
- one-button staff commands;
- tests/UAT guide.

## Acceptance criteria

- Kitchen имеет два простых внутренних списка `НОВЫЕ`/`В ПРОЦЕССЕ`, без
  отдельного экрана деталей, и одну основную финальную action.
- Orders появляются автоматически без accept.
- Courier один, без claim/assignment/route engine.
- Kitchen ready одновременно меняет status и ставит client/courier messages.
- Courier sees correct address/phone/cash.
- Telegram failure не скрывает order из polling.
- Full end-to-end flow проходит за три business statuses.

## Не входит

- Kitchen menu/availability controls.
- Courier GPS/route/assignment.
- Delivery-failed state machine.
- Several couriers.

## Критерий выхода

Сотрудники выполняют нормальный order двумя основными действиями: Kitchen
`ЗАКАЗ ГОТОВ` и Courier `ДОСТАВЛЕНО`.
