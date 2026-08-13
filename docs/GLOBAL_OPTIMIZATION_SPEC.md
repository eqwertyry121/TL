# ТЗ: глобальная оптимизация TK Delivery

Статус: локально реализовано и проверено; финальная production-приёмка требует
внешних staging/production действий
Дата аудита: 2026-08-13
Область: client, kitchen, courier, admin, Go API, PostgreSQL, media, Nginx,
CI/CD и эксплуатация.

## 0. Статус реализации на 2026-08-13

В первом проходе внедрены совместимые изменения без расширения архитектуры:

- HTML/CSS startup: Telegram SDK переведён на `defer`, добавлены точечные
  `preconnect` к `api.takolako.site` и `telegram.org`, внешний Google Fonts
  `@import` убран из critical path; root fallback с Telegram `initData`
  рендерит app без второго document load на `/main/`;
- Client: добавлен progressive bootstrap, публичный local cache меню,
  lazy загрузка истории и контакта; checkout draft/progress/idempotency state
  переведён в `sessionStorage`, старые sensitive `localStorage` keys очищаются;
- Kitchen/Courier/Admin: стартовые запросы сокращены за счёт role bootstrap и
  загрузки только видимого раздела Admin;
- Polling: вынесен общий visibility-aware polling util без перекрывающихся
  interval-запросов;
- Media: fixture 404 убраны, `photo_path` для menu item ограничен пустым
  значением или optimized `/media/menu/*.jpg`, upload оптимизируется в JPEG с
  resize через общий media pipeline, PNG/JPEG/WebP decode, EXIF orientation
  correction и ранняя проверка input size/dimensions до полного bitmap decode
  покрыты тестами, media cache сделан immutable; новые uploads создают display
  JPEG и thumbnail JPEG, а menu JSON отдаёт additive `photo_variants`; metadata
  вариантов сохраняется в PostgreSQL в `menu_media` и подтягивается через JOIN
  без N+1; client image rendering использует `srcSet`/`sizes`/geometry/fetch
  priority, а Admin preview берёт
  thumbnail variant вместо полного display image;
- HTTP/API: добавлены bootstrap endpoints, ETag/Cache-Control для публичных JSON,
  gzip и preflight cache; order list endpoints (`client`, `kitchen`,
  `courier`, `admin`) отдают private ETag/304, а frontend API helpers
  переиспользуют 304 из in-memory cache без `localStorage`;
- Public cache: добавлен короткий in-process cache + `singleflight` для
  runtime/menu/public bootstrap, с invalidation после успешных Admin-мутаций;
- PostgreSQL: cart calculation и order list переведены с N+1 на batch-запросы,
  добавлены индексы, sargable Admin date filter и integration query-count tests
  для cart calculation/kitchen/courier/admin order lists; kitchen/courier active
  lists теперь выполняются за 2 SQL-запроса (`orders+users` page и batch
  `order_items`) вместо отдельного ID round trip; Admin date filter
  покрыт boundary-test на локальный день `Europe/Belgrade` и source contract
  против `to_char`/`created_at::date` в `WHERE`; PostgreSQL EXPLAIN regression
  на realistic dataset фиксирует использование `idx_orders_created_desc` без
  `Seq Scan` по `orders`; Admin и client history list
  используют paginated `OrderSummary` без items/events/decrypted phone/address,
  что покрыто source contract и integration test с повреждённым encrypted PII;
  client summary/bootstrap/detail paths дополнительно покрыты foreign-order
  isolation test и source contract на `client_user_id`; staff session bootstrap
  role isolation покрыт integration test: пользователь с активной только
  `KITCHEN` ролью не может получить `COURIER` session; detail остаётся отдельным
  endpoint; integration test фиксирует, что `ЗАКАЗ ГОТОВ` сохраняет
  `OUT_FOR_DELIVERY` и pending client/courier notifications до фактической
  Telegram-доставки, а idempotency replay не дублирует jobs;
  order item snapshots title/price/quantity/line_total и порядок позиций
  зафиксированы integration test после Admin CMS edit и архивирования уже
  использованного блюда;
- CreateCashOrder больше не делает per-item `Exec` для `order_items`: snapshots
  пишутся одной PostgreSQL `COPY`-операцией внутри транзакции, а integration
  query-count test фиксирует bounded create path при росте корзины с 1 до 8
  позиций;
- Admin orders pagination: backend, OpenAPI, real frontend и demo fallback
  зафиксированы на default page 20 и bounded max 50, чтобы startup/manual calls
  не возвращали старую страницу на 100 заказов;
- Admin audit log стал paginated/bounded: backend и OpenAPI принимают
  `limit/offset`, default 50, max 100, response остаётся backward-compatible
  через поле `entries` и дополнен `limit/offset/has_more`; Admin UI, legacy
  fallback и demo-режим используют тот же bounded page contract с кнопками
  `Назад`/`Дальше`; integration/source tests проверяют pagination и cap на
  реальной PostgreSQL и в frontend-контрактах;
- Admin analytics bounded contract зафиксирован source test-ом: UI остаётся на
  пресетах `today`/`7d`/`month`, backend отклоняет custom range больше 370 дней,
  PostgreSQL и demo ограничивают top dishes десятью строками;
- Backend runtime: добавлены малые конфигурируемые pgxpool limits, bounded HTTP
  server timeouts, non-production/debug `Server-Timing` с encode timing для
  обычных и conditional JSON-ответов, и safe request logging
  с request_id/method/route/status/duration/response_bytes без query/body/token;
  `/live` не трогает DB, `/ready` и совместимый `/health` делают короткий DB
  check; local и production env templates содержат runtime knobs для pool,
  notification concurrency/backlog и Server-Timing;
- Notification worker: Telegram jobs обрабатываются с bounded concurrency до 4,
  Telegram API использует общий HTTP client с timeout/keep-alive/idle/header
  limits; cash-location/client bot prompt path тоже использует shared bounded
  Telegram client вместо client per request; regression test фиксирует, что
  один заблокированный/ошибочный job не останавливает весь batch и concurrency
  остаётся bounded; PostgreSQL integration test фиксирует, что несколько worker-ов
  не claim-ят один notification job дважды, а restart reclaim берёт только stale
  `processing` jobs; добавлен stale backlog warning и прямой ADMIN Telegram alert
  без PII, без message broker;
- Cleanup: существующий backend-процесс раз в сутки удаляет истёкшие sessions,
  calculation/idempotency rows и старые завершённые notification jobs bounded
  batch-ами; PostgreSQL integration test фиксирует, что cleanup не удаляет
  неистёкшие sessions/calculation/idempotency rows, незавершённые notification
  jobs и cash-location challenge, уже связанный с order;
- CI: добавлена проверка gzip bundle budgets, отсутствие fixture image URL в
  runtime seed data, startup asset contract для `defer`/`preconnect`/шрифтов/
  image preload, frontend media rendering contract, env/workflow contract и
  architecture guard против Redis/WebSocket/SSE/service worker/GraphQL/
  Kubernetes/Prometheus/Grafana; migration contract guard фиксирует порядок
  миграций, обязательные optimization indexes/media/revision schema и отсутствие
  destructive domain-data SQL; OpenAPI route/generated check сверяет backend
  routes, наличие component schemas и field-level совпадение object-схем с
  generated TypeScript interfaces; API compatibility guard фиксирует additive
  bootstrap/performance endpoints и сохранение legacy runtime/menu/auth/list
  endpoints для rollback; performance beacon guard фиксирует sampling <=5% и
  strip query/hash до sanitization; backend singleflight guard фиксирует coalescing
  public runtime/menu cache misses; load-smoke guard проверяет ETag/304, собирает
  `Server-Timing` p95 при наличии заголовка, требует gzip для свежих JSON
  response body от 1 KB и проверяет published menu media URLs на `2xx image/*`;
  local Markdown link guard проверяет README/docs;
  backend CI gate поднимает Go API на PostgreSQL service и запускает public
  load-smoke для 1/20/100 конкурентных чтений плюс CI-only серию repeated
  checkout calculation через development `/dev/session`; production smoke по
  умолчанию остаётся публичным, потому что `/dev/session` запрещён в production;
  performance PR workflow теперь сначала проверяет production bundle budgets и
  только затем собирает demo lab; PostgreSQL integration helpers берут общий
  advisory lock на время schema reset/migration, поэтому store и notifications
  integration suites проходят как последовательно, так и в одном combined
  `go test` command на одном test DSN; добавлен явный release-gate wrapper
  `pnpm go:test:postgres`, который требует `TK_TEST_POSTGRES_DSN` и гоняет
  полный `go test ./... -count=1`, чтобы PostgreSQL acceptance не сводился к
  одному пакету; backend GitHub Actions использует тот же full-suite
  PostgreSQL gate вместо package-specific списка, а env/workflow contract
  предотвращает возврат к узкому набору пакетов; GitHub Pages deploy теперь
  запускает root `pnpm check` и production
  `pnpm perf:deployment-diagnostics` с `PERF_EXPECTED_BUILD_SHA=${{ github.sha }}`
  до frontend build/deploy, а Performance CI отдельно гоняет root optimization
  gates (`openapi:check`, `media:check`,
  media backfill/PostgreSQL/external smoke wrapper tests), чтобы PR не обходил
  контрактные проверки;
- Performance tooling: добавлен локальный `pnpm perf:smoke` для 1/20/100
  конкурентных чтений публичных endpoints, добавлен `pnpm perf:full` для
  одной локальной команды lab build + Playwright + Lighthouse + API smoke, создан
  `docs/performance-results.md` для checkpoint-результатов; добавлены
  Playwright cold/warm startup lab с несколькими samples и p75/p95 attachment,
  release SLO-mode с app-specific p75/p95 budgets из этого ТЗ и
  `pnpm perf:release-lab`, который по умолчанию запускает 20 startup samples
  перед Lighthouse; startup lab дополнительно пишет стабильные JSON artifacts в
  `test-results/performance-startup`, чтобы p75/p95 можно было переносить в
  performance ledger без HTML report; добавлены Lighthouse CI config и GitHub
  Actions performance workflow; добавлен
  `pnpm perf:external-smoke` как отдельный
  staging/production release gate, который требует явный `PERF_BASE_URL`,
  отклоняет localhost по умолчанию и не включает dev checkout phase без явного
  override; добавлен быстрый `pnpm perf:production-contract` preflight для
  проверки, что staging/production уже отдают optimized public bootstrap,
  version body/build identity, ETag/Cache-Control и пустой 304 до запуска более
  длинного smoke; `PERF_EXPECTED_BUILD_SHA` дополнительно доказывает точный
  backend rollout; добавлен
  `pnpm perf:legacy-public-contract` preflight, который проверяет публичные
  `/runtime` и `/menu` JSON-shapes для предыдущего frontend release до удаления
  rolling-deploy fallback; добавлен `pnpm perf:cors-contract` preflight для
  staging/production проверки exact-origin CORS, preflight max-age 600,
  expose headers и запрета foreign/wildcard origin до мобильных traces; добавлен
  umbrella `pnpm perf:release-acceptance`, который запускает legacy/CORS/
  optimized-contract/external-smoke gates в release-порядке и останавливается на
  первом failure, чтобы production acceptance не собирался вручную из
  разрозненных команд; добавлен быстрый `pnpm perf:deployment-diagnostics`,
  который прогоняет legacy/CORS/optimized-contract preflights до конца и
  сообщает все deployment blockers без длинного load-smoke; media
  backfill npm wrapper очищает npm `--` separator,
  поэтому runbook-команды вида `pnpm media:backfill:dry-run -- -limit=100`
  действительно передают `-limit` в Go CLI;
- Backend CI locally launches the API and runs the same CORS preflight contract
  and optimized public `production-contract` before `load-smoke`, so exact-origin
  CORS, `/api/v1/version`, `/api/v1/bootstrap/public`, menu/runtime ETag,
  Cache-Control and empty 304 behavior plus version body are proven before
  concurrent load.
- Прямой локальный runtime smoke 2026-08-14 на свежей временной PostgreSQL 16 и
  локальном Go API подтвердил этот же CORS/optimized public contract, 1/20/100
  public load-smoke и 20x checkout calculation; worst fresh public p95 был
  52 ms, checkout calculate p95 — 37 ms. Это не заменяет staging/production
  acceptance.
- Performance beacon: добавлен sampled frontend sender и allowlisted backend
  endpoint `/api/v1/performance/beacon`; payload не содержит Telegram ID,
  session token, телефон, адрес или raw `initData`.
- Performance beacon route validation: backend accepts only known app/route enum
  pairs and rejects dynamic route strings before logging telemetry.
- Backend build identity: added public `/api/v1/version` with sanitized
  `build_sha`, `api_contract`, `Cache-Control: no-cache` and weak ETag, wired
  through Docker/Compose/CI via non-secret `APP_BUILD_SHA` for production
  rollout diagnostics.
- Runbook: добавлен `docs/optimization-runbook.md` с backend-first deploy,
  BotFather `/main/`, Nginx, cache purge/recovery, migration, media backfill и
  media rollout.
- Revisions: добавлен явный `menu_revision` в PostgreSQL; category/item/photo
  mutations и media backfill bump-ают его transactionally, а runtime revision
  меняется при settings/manual-day-off/schedule изменениях.
- Deploy media path: production templates монтируют uploads в host path
  `MEDIA_VOLUME_HOST_PATH` и отдают `/media/` напрямую через Nginx с immutable
  cache/ETag/gzip off; app container получил стабильный UID/GID для writable
  bind mount; Go `ServeContent` остаётся совместимым fallback для local/dev или
  окружений без прямого Nginx media mount.

Не закрыто полностью: production/staging результат API load-smoke ещё не
зафиксирован, production backfill старых media ещё не выполнен, финальный
production Telegram trace не снят.

## 1. Цель

Сделать интерфейсы визуально быстрыми, убрать лишнее ожидание сети и обеспечить
предсказуемую работу на одном VPS при проектной нагрузке: один ресторан, один
курьер, до примерно 50 заказов в день.

Главный пользовательский результат:

- повторный вход клиента показывает сохранённое меню практически сразу;
- холодный вход не блокируется историей заказов, контактами, шрифтами или
  несколькими одинаковыми запросами;
- кухня и курьер получают рабочий список одним стартовым запросом и продолжают
  надёжно обновляться обычным polling;
- Admin загружает только открытый раздел, а не все данные системы;
- изображения меню имеют предсказуемый размер и не создают 404;
- PostgreSQL выполняет ограниченное число запросов независимо от числа заказов
  и позиций на странице.

Это ТЗ не обещает физически невозможную одинаковую скорость при любой сети.
Оно задаёт измеримые SLO, чтобы «быстро» проверялось тестами, а не ощущениями.

## 2. Ограничения и неизменяемые правила

Оптимизация обязана сохранить `docs/00_MASTER_SPEC.md` и не должна добавлять:

- Redis или иной внешний cache;
- микросервисы, Kubernetes, отдельный data warehouse;
- WebSocket или SSE — остаётся polling;
- новые роли, статусы заказа, распределение курьеров или маршрутизацию;
- хранение session token или raw Telegram `initData` в `localStorage`;
- доверие цене, статусу, оплате или Telegram user со стороны frontend;
- логирование телефона, адреса, token, webhook secret или raw `initData`.

PostgreSQL остаётся источником истины. Допустимы только:

- короткоживущий in-process cache в одном Go-процессе;
- безопасный публичный cache меню в браузере;
- HTTP/CDN cache неизменяемых media-файлов;
- ETag/304 и сжатие транспортного ответа.

## 3. Зафиксированная базовая линия

Замеры ниже сделаны во время аудита. Production-замеры из одной внешней точки
нужны как сигнал, но не заменяют повторный тест с контролируемого хоста рядом с
VPS.

| Область | Наблюдение |
|---|---|
| Client bundle | 238.23 KB JS / 75.99 KB gzip; 34.48 KB CSS / 7.70 KB gzip |
| Admin bundle | 277.54 KB JS / 85.78 KB gzip; 29.24 KB CSS / 6.56 KB gzip |
| Kitchen bundle | 208.02 KB JS / 66.54 KB gzip; 14.99 KB CSS / 4.03 KB gzip |
| Courier bundle | 208.40 KB JS / 66.77 KB gzip; 16.86 KB CSS / 4.34 KB gzip |
| Блокировка HTML | Во всех четырёх `index.html` Telegram SDK подключён синхронно до app bundle |
| Шрифты | Во всех четырёх CSS есть блокирующий `@import` Google Fonts |
| Client startup | runtime и menu, затем auth, затем orders и contact; экран ждёт самый медленный запрос |
| Повторные запросы | На production `/main/` при одном старте замечено 3 обращения к runtime |
| Admin startup | После auth одновременно запрашиваются 8 разделов; результат ждёт все восемь |
| Admin mutation | Обычная мутация повторно загружает все разделы |
| Polling | `setInterval`; возможны наложение запросов и запросы скрытой вкладки |
| Menu API | Ответ около 3.6 KB, но без ETag, Cache-Control и Content-Encoding |
| Runtime API | Ответ около 0.4 KB, но без ETag, Cache-Control и Content-Encoding |
| Menu media | 8 seed URL `fixtures/*.webp` на production возвращали 404 |
| Upload media | Любой принятый файл декодируется и сохраняется как PNG без resize |
| Order lists | Сначала выбираются ID, затем для каждого заказа отдельно order и items: `2N+1` запросов |
| Cart calculation | Отдельный SQL-запрос на каждую уникальную позицию корзины |
| Admin date filter | `to_char(created_at ...)` делает фильтр по дате несаргируемым |
| Nginx examples | Нет согласованной production-конфигурации gzip и immutable media cache |
| 20 concurrent menu | Из текущей внешней точки: 15 успехов, 5 connect timeout; p95 успешных около 7.16 s |
| Проверки | `pnpm check` и `pnpm build` проходят; frontend/E2E/performance tests отсутствуют |
| Go tests local | Не стартуют: установлен Go 1.25.5, `go.mod` требует 1.25.12 |

Размер JS сейчас не является главным ограничением. Первые работы должны убрать
сетевые водопады, повторные запросы, media и SQL amplification. Разделение
бандлов выполняется позже и только по результатам повторного профилирования.

## 4. Целевые показатели

### 4.1. Пользовательские SLO

Измерять отдельно на холодном и повторном запуске в Telegram Android, Telegram
iOS и обычном мобильном браузере. Для лабораторного профиля использовать
mid-tier phone, CPU slowdown 4x, Fast 4G, пустой HTTP cache для cold run.

| Метрика | Цель |
|---|---|
| LCP p75 | не более 2.5 s |
| INP p75 | не более 200 ms |
| CLS p75 | не более 0.10 |
| Client: cached menu visible p75 | не более 300 ms после начала загрузки документа |
| Client: cold menu visible p75 / p95 | не более 1.2 s / 2.0 s |
| Kitchen/Courier: первый рабочий список p75 / p95 | не более 1.0 s / 1.8 s |
| Admin: dashboard p75 / p95 | не более 1.2 s / 2.0 s |
| Переключение уже открывавшейся вкладки Admin | не более 100 ms до показа cache |

LCP/INP/CLS проверяются на 75-м перцентиле, а не лучшим одиночным запуском.
Пороговые значения соответствуют официальным рекомендациям
[Core Web Vitals](https://web.dev/articles/defining-core-web-vitals-thresholds).

### 4.2. Backend SLO

Замерять server duration отдельно от DNS/TLS/network, после прогрева пула БД.

| Операция | p95 | Ошибки |
|---|---:|---:|
| warm public bootstrap/menu/runtime | <= 100 ms | < 0.1% |
| client/staff bootstrap | <= 200 ms | < 0.1% |
| kitchen/courier active list | <= 150 ms | < 0.1% |
| calculate | <= 200 ms | < 0.1% |
| create/status mutation | <= 300 ms без внешнего Telegram API | < 0.1% |
| admin orders page из 20 заказов | <= 200 ms | < 0.1% |

Обязательный smoke: 100 одновременных чтений menu/public bootstrap, 100/100
ответов 2xx/304, error rate 0, p95 не более 500 ms с контролируемого хоста.

### 4.3. Бюджеты ресурсов

- client initial JS: не увеличивать выше 80 KB gzip;
- остальные initial JS: не увеличивать выше 90 KB gzip;
- initial CSS каждого app: не более 10 KB gzip;
- thumbnail блюда: целевой размер до 80 KB;
- display image блюда: целевой размер до 180 KB;
- сумма изображений первого viewport client: до 250 KB;
- в одном цикле polling не более одного in-flight запроса одного типа;
- kitchen/courier list: постоянные 2 SQL-запроса вместо зависимости от `N`;
- admin orders page: не более 3 SQL-запросов без detail/events.

## 5. Выбранная совместимая стратегия

Нужно реализовать вместе пять уровней:

1. Мгновенный shell и cached menu, затем фоновая проверка актуальности.
2. Один role-specific bootstrap вместо стартового сетевого водопада.
3. Revisions + ETag + in-process cache + gzip/immutable media cache.
4. Не перекрывающийся visibility-aware polling вместо голого `setInterval`.
5. Batch SQL, list projections и недостающие индексы вместо N+1.

Эти способы усиливают друг друга и не меняют бизнес-логику. Например, cache
ускоряет показ меню, revision гарантирует его обновление, а backend повторно
проверяет цену/доступность при calculate и создании заказа.

## 6. Пакеты работ

### OPT-00. Воспроизводимые измерения — P0

Почему: без baseline легко «оптимизировать» код, не ускорив пользователя.

Изменения:

- добавить в репозиторий сценарий Playwright для cold/warm запуска четырёх app;
- добавить Lighthouse CI для публичного client route с mock API;
- добавить небольшой load smoke на Go, `k6` или `vegeta` для 1/20/100 клиентов;
- собирать duration, status, response bytes и SQL query count для ключевых API;
- добавить `Server-Timing` в non-production или при защищённом debug-флаге:
  `db`, `encode`, `total`;
- в CI проверять gzip budgets из раздела 4.3 и отсутствие 404 у fixture/media URL;
- хранить baseline и результат после каждого пакета в
  `docs/performance-results.md` с датой, commit, средой и 20+ прогонами;
- добавить sampled performance beacon, максимум 5% client sessions, только
  app/route/build/LCP/INP/CLS/TTFB; без Telegram ID, session token, телефона,
  адреса и raw `initData`.

Файлы/области:

- `.github/workflows/ci.yml`;
- новый `tests/performance/`;
- `backend/internal/httpapi/server.go`;
- `apps/*/src` для Web Vitals beacon.

Приёмка:

- одна команда локально запускает lab и load smoke;
- CI падает при превышении bundle budget или при 404 media;
- performance log не содержит PII/секретов;
- baseline воспроизводится с отклонением p95 не более 20% на одной среде.

### OPT-01. Убрать блокировки HTML и двойную навигацию — P0

Текущее место:

- `apps/*/index.html:8` — синхронный Telegram SDK;
- `apps/*/src/styles.css:1` — Google Fonts `@import`;
- production BotFather открывает root, после чего app переводит Telegram user на
  `/main/`, создавая второй document load.

Изменения:

- поставить production Mini App URL сразу `https://takolako.site/main/`;
- оставить `/` публичным portal и fallback для старой ссылки;
- подключить Telegram SDK с `defer` и единой `telegramReady`-обёрткой; shell и
  безопасный public/cached content не должны ждать SDK;
- не выполнять auth до readiness SDK; при недоступности SDK показывать public
  режим, а не бесконечный loader;
- добавить `preconnect` к `https://api.takolako.site` и
  `https://telegram.org`; не добавлять много speculative hints;
- убрать внешний CSS `@import` из critical path;
- основной текст перевести на system font stack; если Cormorant критичен для
  бренда — self-host только реально используемые WOFF2 начертания с
  `font-display: swap`, без блокировки первого экрана;
- добавить минимальный inline shell background/loader, совпадающий с конечной
  геометрией, чтобы не было белого flash и CLS.

Не делать:

- не копировать Telegram SDK в репозиторий;
- не ждать внешние шрифты перед render;
- не делать service worker в этом пакете.

Приёмка:

- первый app module обнаруживается браузером без ожидания Telegram SDK;
- открытие из BotFather не создаёт переход `/` -> `/main/`;
- отказ Google Fonts не влияет на работоспособность и LCP;
- SDK failure даёт понятный public/fallback экран за <= 1.2 s.

### OPT-02. Client progressive bootstrap и cache меню — P0

Текущее место: `apps/client/src/App.tsx:91-120`. UI ждёт runtime + menu, затем
auth, затем orders + contact. Изменение session повторно запускает callback, а
focus/pageshow/visibility создают дополнительные runtime requests.

API:

- добавить `GET /api/v1/bootstrap/public?locale=ru|sr`;
- добавить `POST /api/v1/bootstrap/client` с raw `initData` и locale;
- client bootstrap возвращает session, runtime, menu revision, menu при
  необходимости, verified contact и только active/latest order;
- history не входит в bootstrap;
- raw `initData` валидируется только backend и никогда не логируется;
- существующие узкие endpoints оставить для последующих обновлений.

Frontend state machine:

1. Синхронно отрисовать shell.
2. Прочитать из `localStorage` только публичный menu snapshot с ключом
   `tk.menu.v2.<locale>`: schema version, menu revision, saved_at, categories.
3. Если snapshot валиден по схеме — показать его сразу. Корзину можно показать,
   но checkout заблокирован до свежего runtime/bootstrap.
4. Выполнить ровно один public или client bootstrap.
5. Применить runtime/session/contact/active order независимо от history.
6. Если revision изменился — заменить menu и snapshot атомарно.
7. History загружать только при открытии history route, страницами по 20.

Правила cache:

- разрешено хранить только публичные category/menu fields;
- session, orders, contact, phone, address, payment data не сохранять;
- TTL snapshot — 7 дней как offline/instant fallback, но revision проверяется на
  каждом bootstrap;
- при schema mismatch или JSON error cache удаляется безопасно;
- calculate/create всегда обращаются к backend и получают актуальную сумму;
- item, ставший unavailable, может кратко отображаться из cache, но backend
  должен отказать/пересчитать, после чего UI обновляет menu.

Файлы/области:

- `apps/client/src/App.tsx` — выделить bootstrap hook/state machine;
- новый `apps/client/src/menu-cache.ts`;
- `apps/client/src/api.ts`;
- `packages/api-client/src/generated.ts`;
- `openapi/openapi.yaml`;
- `backend/internal/httpapi/server.go` и `backend/internal/store/store.go`.

Приёмка:

- warm launch показывает menu до первого network response;
- cold launch имеет один bootstrap, а не цепочку runtime/menu/auth/orders/contact;
- history failure не блокирует menu и checkout;
- один startup не делает повторный runtime/menu request;
- logout/reauth очищает только private memory state, menu cache остаётся public;
- тесты покрывают corrupt cache, old schema, changed revision и недоступный API.

### OPT-03. Единый безопасный polling engine — P0

Заменить независимые `setInterval` в client, kitchen, courier и admin на общий
hook/util без добавления WebSocket/SSE.

Алгоритм:

- recursive `setTimeout` планируется только после завершения прошлого запроса;
- hidden document не polling-ится;
- при `visibilitychange`, `focus` или `pageshow` выполняется один coalesced refresh;
- все три события в окне 500 ms считаются одним сигналом;
- повторный вызов возвращает существующий in-flight Promise;
- `AbortController` отменяет запрос при unmount, logout и смене section;
- успех: client/admin 10 s, kitchen/courier 5 s;
- ошибки: backoff 5 -> 10 -> 20 -> 30 s, после успеха reset;
- jitter +/-10%, чтобы клиенты не били VPS в одну миллисекунду;
- manual refresh использует тот же in-flight guard;
- `If-None-Match`/304 не очищает текущие данные;
- 401 вызывает одну reauth попытку, не auth storm.

Дополнительно:

- cash location challenge может иметь отдельный 2 s polling только пока modal
  открыт и challenge в `PENDING`;
- polling active order прекращается для `DELIVERED`/`CANCELLED`, кроме ручного
  refresh;
- list responses получают ETag, вычисленный из ID + status/version + updated_at.

Рекомендуемое место: новый общий пакет или `packages/api-client/src/polling.ts`.

Приёмка:

- при ответе дольше интервала остаётся ровно один request;
- за 60 s скрытой вкладки — 0 polling requests;
- возврат во вкладку — ровно 1 немедленный request;
- приложение восстанавливается после offline без reload;
- fake-timer tests покрывают overlap, visibility, backoff, abort и reauth.

### OPT-04. Admin: загрузка по разделам и точечная инвалидация — P0

Текущее место:

- `apps/admin/src/App.tsx:139-223` — `loadAdminSections` ждёт 8 requests;
- `apps/admin/src/App.tsx:317` — mutation helper;
- текущее поведение противоречит `docs/admin-ux-redesign.md:585-624`.

Изменения:

- `POST /api/v1/bootstrap/admin` возвращает session, dashboard counters,
  current runtime/settings summary и permissions активной роли;
- после auth показывается dashboard; menu/settings/schedule/orders/staff/
  analytics/audit не запрашиваются;
- каждый section получает `{data, status, loadedAt, error}` и отдельный loader;
- первый вход во вкладку загружает её данные;
- повторный вход мгновенно показывает session cache и при необходимости
  background revalidation;
- допустимый stale interval: home/orders 10 s, menu/settings/staff 60 s,
  analytics/audit 5 min до ручного refresh;
- polling только у видимой home или active orders tab;
- смена вкладки отменяет её незавершённый необязательный request;
- analytics date range перезагружает только analytics;
- order filters/page перезагружают только orders;
- убрать `load()` всех разделов из mutation helper.

Матрица точечной инвалидации:

| Мутация | Локально обновить | Фоном обновить |
|---|---|---|
| category/item/photo | menu | dashboard/menu revision |
| settings/schedule | settings или schedule | home runtime summary |
| staff add/deactivate | staff | ничего |
| order cancel/note/refund | order detail + row | dashboard counters |
| audit-producing action | затронутый section | audit только если он открыт |

Backend list API:

- orders default page уменьшить со 100 до 20;
- list отдаёт `OrderSummary` без items, events, decrypted address/phone;
- private detail загружается только при открытии заказа;
- audit и analytics обязательно paginated/bounded;
- сохранить offset pagination: при 50 заказах/день keyset пока не нужен.

Приёмка:

- dashboard first load: auth/bootstrap + максимум один дополнительный request;
- открытие Admin не запускает 8 section requests;
- menu mutation не делает запросы orders/staff/analytics/audit;
- ошибка одного section не ломает остальные;
- hidden Admin tab не polling-ится.

### OPT-05. Kitchen и Courier bootstrap — P1

Текущее поведение делает auth POST, затем list GET последовательно.

Изменения:

- добавить `POST /api/v1/bootstrap/staff` с requested active role;
- backend валидирует staff access и возвращает session + только начальный список
  этой роли;
- кухня получает только `NEW`, courier только `OUT_FOR_DELIVERY`;
- UI сразу рисует role shell/skeleton и заменяет его ответом bootstrap;
- subsequent polling использует узкий list endpoint и ETag;
- status mutation обновляет/удаляет row оптимистично только после 2xx; при
  конфликте выполняется один section refresh;
- повторное нажатие блокируется на время in-flight mutation.

Приёмка:

- cold startup: один API round trip после readiness Telegram SDK;
- недоступная роль не раскрывает данные другой роли;
- status action не вызывает полный auth/bootstrap повторно;
- notification failure не влияет на появление заказа через polling.

### OPT-06. Полный media pipeline — P0

Текущее место:

- `backend/internal/httpapi/server.go:56` — обычный FileServer без cache policy;
- `backend/internal/httpapi/server.go:952-975` — decode и PNG encode без resize;
- seed содержит несуществующие `fixtures/*.webp`.

Upload pipeline:

- проверить magic bytes и разрешить JPEG/PNG/WebP input;
- сохранить текущие лимиты 5 MB и 4096x4096; отдельно ограничить total pixels,
  чтобы не допустить image decompression bomb;
- исправить EXIF orientation и удалить metadata;
- сделать две производные версии:
  - thumbnail: максимум 480 px по длинной стороне;
  - display: максимум 960 px по длинной стороне;
- не увеличивать маленькое исходное изображение;
- выбранный основной output — JPEG quality 82 для фотографий; PNG оставить
  только если действительно нужна прозрачность;
- WebP можно добавить тем же контрактом после проверки стабильной Go-библиотеки,
  но он не должен блокировать первую оптимизацию;
- имя содержит UUID/content hash и никогда не перезаписывается;
- DB хранит URL вариантов, width, height, bytes и MIME;
- смена фото создаёт новые immutable URL; старые файлы удаляются только
  безопасной cleanup-задачей после отсутствия ссылок.

Frontend:

- `<img>` получает `src`, `srcSet`, `sizes`, `width`, `height` или `aspect-ratio`;
- первое видимое LCP image — eager и `fetchpriority="high"`;
- остальные — `loading="lazy"`, `decoding="async"`;
- placeholder занимает конечную геометрию;
- error placeholder не скрывает причину в Admin;
- Admin preview использует thumbnail, не full original.

HTTP:

- `/media/menu/<immutable-name>`: `Cache-Control: public, max-age=31536000, immutable`;
- корректный `Content-Type`, `Content-Length`, `ETag`, range support;
- media отдаёт Nginx напрямую из read-only volume либо через `X-Accel-Redirect`;
  Go не должен читать каждый файл в user space;
- изображения не gzip-ить.

Data fix:

- миграция/seed либо поставляет реальные fixture files, либо оставляет photo URL
  пустым;
- deploy smoke проверяет 2xx и image MIME для каждого непустого menu photo URL.

Приёмка:

- ни одного 404 для опубликованного блюда;
- upload 5 MB/4096 px создаёт bounded variants согласно бюджетам;
- карточки не прыгают при загрузке images;
- повторное открытие media обслуживается browser cache без body download;
- malformed/oversized file отклоняется без записи на диск.

### OPT-07. Revision, ETag, in-process cache и gzip — P1

Schema:

- добавить `menu_revision BIGINT NOT NULL DEFAULT 1`;
- использовать существующий settings version как `runtime_revision`, увеличивая
  его также при изменении schedule/manual closure;
- все category/item/photo mutations увеличивают `menu_revision` в той же DB
  transaction;
- вынести `bumpMenuRevisionTx` в одно место и покрыть каждый mutation integration
  test; скрытый trigger не использовать.

HTTP contract:

- menu ETag: `W/"menu-<locale>-<revision>"`;
- runtime ETag: `W/"runtime-<revision>-<derived-day-key>"`;
- list ETag включает только доступную роли выборку;
- поддержать `If-None-Match` и корректный 304 без body;
- public menu: `Cache-Control: public, max-age=0, must-revalidate`;
- runtime: `Cache-Control: no-cache`, чтобы manual day off не устаревал;
- authenticated orders/session/payment: `Cache-Control: no-store`;
- `Vary: Accept-Encoding` и там, где требуется, `Origin`;
- в OpenAPI документировать ETag/304/revisions.

In-process cache:

- cache menu по locale + revision, safety TTL 30 s;
- cache settings/schedule derived runtime не более 5 s;
- singleflight/coalescing для одновременного cache miss;
- invalidation выполняется сразу после successful commit;
- не cache orders, calculation result, sessions, payments или checkout truth;
- при cache bug/restart система корректно читает PostgreSQL.

Nginx:

- включить gzip для JSON/JS/CSS/SVG/text, `gzip_vary on`, разумный level 4-5;
- не gzip JPEG/PNG/WebP и уже сжатые форматы;
- сохранить keep-alive и HTTP/2 на TLS virtual host;
- согласовать `nginx.api.example.conf` и `nginx.api.host.example.conf` с реальным
  deploy: один production-ready host template, корректный upstream и TLS;
- CORS preflight получает bounded `Access-Control-Max-Age` (например 600 s),
  exact allowed origins/headers/methods; не использовать `*` с credentials.

Конфигурацию gzip сверять с официальным описанием
[`ngx_http_gzip_module`](https://nginx.org/en/docs/http/ngx_http_gzip_module.html),
включая `gzip_types`, `gzip_proxied` и `Vary: Accept-Encoding`.

Приёмка:

- неизменившийся menu/runtime возвращает 304;
- изменение Admin видно следующим bootstrap/poll;
- параллельные 100 cache miss не создают 100 одинаковых Menu SQL-запросов;
- JSON больше 1 KB приходит с gzip при поддержке клиента;
- private response не cache-ится proxy/browser.

### OPT-08. PostgreSQL: убрать N+1 и лишние данные — P1

#### 08.1. Menu/settings

- in-process cache из OPT-07 снимает повторные чтения;
- menu cold load остаётся максимум двумя SQL-запросами: categories и items;
- schedule/settings читаются одним join/CTE или двумя запросами внутри одного
  cache miss; это не критично после cache.

#### 08.2. Calculation и создание заказа

- заменить query per cart item одним `WHERE id = ANY($1)`;
- собрать map по ID и отдельно проверить missing/archived/unavailable;
- revalidation внутри transaction делает такой же один batch SELECT с нужными
  row locks/consistency;
- order item snapshots вставлять через `pgx.Batch` или один multi-row INSERT;
- порядок результата восстанавливать по входной корзине;
- все money остаются integer minimal units.

Цель: calculate — 1 menu item query вместо N; create — постоянное число запросов
плюс один batch insert, а не зависимость от числа позиций.

#### 08.3. Списки заказов

Заменить `ordersFromIDRows -> OrderByID`:

1. Один запрос выбирает полные order rows/users для page/role.
2. Один запрос выбирает все `order_items WHERE order_id = ANY($1)` с сортировкой.
3. Go группирует items по order ID.

Для Admin list применить `OrderSummary`; decrypted phone/address, items и events
загружать только detail endpoint. Client history также page 20 и detail on demand.

#### 08.4. Фильтры и индексы

Добавить миграцию после проверки `EXPLAIN (ANALYZE, BUFFERS)` на realistic seed:

```sql
CREATE INDEX idx_order_items_order_sort
    ON order_items(order_id, sort_order);
CREATE INDEX idx_order_events_order_created
    ON order_events(order_id, created_at);
CREATE INDEX idx_audit_log_created
    ON audit_log(created_at DESC);
CREATE INDEX idx_orders_created
    ON orders(created_at DESC);
```

При подтверждённом плане добавить partial index active orders; не плодить
индексы без использования.

Admin date filter обязан преобразовать local calendar day в Go в UTC half-open
range `[from, to)` и выполнять `created_at >= $from AND created_at < $to`.
Убрать `to_char(created_at ...)` из WHERE.

Добавить expiry indexes и batch cleanup для:

- sessions по `expires_at`;
- calculation_tokens по `expires_at`;
- idempotency_keys по `expires_at`;
- завершённых notification jobs по retention policy.

Cleanup запускается существующим worker/periodic loop один раз в сутки, удаляет
ограниченными batch, без отдельного сервиса.

Приёмка:

- kitchen/courier/client list query count не растёт с 1 до 50 заказов;
- Admin page 20 не decrypt-ит PII и не читает events/items до detail;
- EXPLAIN для date/order filters не показывает full scan при realistic dataset;
- integration tests подтверждают snapshot money/title и порядок items;
- очистка не удаляет незавершённые/неистёкшие данные.

### OPT-09. Go server, DB pool и безопасная наблюдаемость — P1

DB pool:

- перейти с `pgxpool.New` на `pgxpool.ParseConfig`;
- добавить env без секретов: `POSTGRES_MAX_CONNS`, `POSTGRES_MIN_CONNS`,
  `POSTGRES_MAX_CONN_IDLE_TIME`;
- начальная конфигурация для одного малого VPS: max 8, min 1, idle 5 min;
- окончательное значение выбрать по `max_connections`, CPU VPS и load test, а не
  повышать вслепую;
- startup делает Ping и один warm connection до readiness.

HTTP server:

- добавить ReadTimeout, WriteTimeout, IdleTimeout, MaxHeaderBytes;
- upload endpoint может иметь отдельный более длинный context, чем обычный API;
- использовать общий настроенный `http.Client`/Transport для Telegram API вместо
  создания client на каждый вызов;
- отделить connect/TLS timeout от общего request timeout;
- graceful shutdown перестаёт принимать запросы, ждёт активные bounded время и
  освобождает pool.

Логи:

- request ID, route template, method, status, duration, response bytes;
- slow log threshold 250 ms и отдельный DB duration;
- не писать URL query/body/header Authorization целиком;
- исключить initData, phone, address, token, webhook secret;
- health: liveness без DB, readiness с краткой DB check;
- Telegram alert оставить простым: repeated 5xx, worker backlog, backup failure,
  disk usage; не добавлять Prometheus/Grafana.

Приёмка:

- slow route находится по safe log без PII;
- зависший client не держит connection бесконечно;
- restart не обрывает корректно завершающийся короткий request;
- pool wait p95 около 0 на smoke 100; если нет — сначала оптимизировать запросы,
  затем менять размер pool.

### OPT-10. Notification worker и фоновые задачи — P2

Текущее поведение отправляет claimed notification jobs последовательно; batch 20
с timeout 8 s может обрабатываться до 160 s при проблемах Telegram.

Изменения:

- обрабатывать jobs с bounded concurrency 3-4 через semaphore;
- сохранить существующие claim/retry/idempotency semantics;
- один job не блокирует остальные;
- общий shutdown context прекращает получение новых jobs и даёт короткое время
  текущим завершиться;
- логировать queue age/count без message body/Telegram user data;
- добавить alert, если oldest pending job старше 60 s;
- daily cleanup из OPT-08 выполняется отдельным bounded tick существующего
  процесса.

Не добавлять message broker.

Приёмка:

- Telegram timeout одной отправки не задерживает весь batch;
- один notification не отправляется дважды при двух workers/restart;
- status transition остаётся успешным при падении Telegram, UI узнаёт его polling.

### OPT-11. Render и bundle после устранения bottleneck — P2

Выполнять только после повторного профиля OPT-01..09.

Изменения, если подтверждены trace:

- Admin tabs вынести в `React.lazy` chunks;
- тяжёлые analytics/audit components и библиотеки не включать в dashboard chunk;
- мемоизировать только реально дорогие derived lists/cards, подтверждённые React
  Profiler; не оборачивать всё в `useMemo`;
- стабилизировать keys и callback для длинных списков;
- debounce только search input 200-300 ms; кнопки/status actions не debounce;
- виртуализацию не добавлять для page 20;
- удалить неиспользуемые icons/locales/styles по bundle analyzer;
- не создавать общий mega-bundle для четырёх app ради формальной дедупликации.

Service worker остаётся опциональным P3. Он разрешён только если после local menu
cache и HTTP cache warm SLO не выполнен, и только с network-first для HTML,
cache-first для hashed static assets, без cache private API. Риск stale deploy
должен быть покрыт update/recovery tests.

Приёмка:

- lazy chunk действительно отсутствует в initial waterfall;
- initial gzip budgets не ухудшены;
- нет regressions первого открытия lazy tab;
- каждая memoization/lazy change имеет измеримое улучшение.

### OPT-12. CORS и число round trips — P1

GitHub Pages и API находятся на разных origins. JSON POST и Authorization могут
создавать preflight.

Выбранное решение:

- сначала сократить число endpoint startup через role bootstrap;
- включить корректный preflight cache на 600 s;
- держать exact origin allowlist;
- переиспользовать keep-alive connections;
- измерить preflight в реальных Telegram Android/iOS traces.

HttpOnly cookie как замена bearer token — не выбранное основное решение: он
снижает часть GET preflight, но меняет CSRF/session модель и усложняет текущую
надёжную reauth схему. Вернуться к нему можно отдельным security design только
если реальные traces покажут существенную долю latency после bootstrap.

Приёмка:

- startup имеет максимум один OPTIONS + один bootstrap POST;
- последующие preflight используют cache в пределах политики WebView;
- запрос с чужого Origin отклоняется;
- credentials/headers не расширены wildcard.

## 7. Изменения API и типов

Все изменения сначала описать в `openapi/openapi.yaml`, затем обновить
`packages/api-client/src/generated.ts`; CI должен проверять отсутствие diff.

Новые/изменённые контракты:

- `GET /api/v1/bootstrap/public`;
- `POST /api/v1/bootstrap/client`;
- `POST /api/v1/bootstrap/staff`;
- `POST /api/v1/bootstrap/admin`;
- menu/runtime/list: `ETag`, `If-None-Match`, response 304;
- menu item: additive `photo_variants` с thumbnail/display URL и dimensions;
- admin/client list: `OrderSummary`, paginated; detail остаётся отдельным;
- performance beacon endpoint, если включён OPT-00, принимает только allowlisted
  numeric metrics и build/route enum.

Backward compatibility:

- старые auth/menu/list endpoints не удалять в первом deploy;
- frontend deploy должен уметь fallback на старые endpoints во время rolling
  несовпадения GitHub Pages и VPS;
- удалить fallback не раньше следующего стабильного release.

## 8. Миграции

Предпочтительный порядок:

1. Additive migration: revisions, photo variant metadata, индексы.
2. Deploy backend, который понимает старые и новые media rows.
3. Backfill существующих menu photos bounded CLI-командой.
4. Deploy frontend с `srcset`/bootstrap.
5. После проверки удалить orphan media, но не историю order snapshots.

Миграции обязаны:

- применяться на чистой PostgreSQL;
- повторно проходить полный integration suite;
- не держать долгую exclusive lock на `orders`;
- создавать потенциально тяжёлые индексы `CONCURRENTLY` в production runbook,
  если таблица к моменту работ стала большой;
- иметь документированный backup/restore checkpoint.

При нынешнем размере данных обычный `CREATE INDEX` допустим в maintenance window,
но решение фиксируется после проверки размера таблиц.

## 9. Порядок реализации

### Волна A — сначала пользовательский эффект

1. OPT-00 baseline и gates.
2. OPT-01 HTML/Telegram URL/fonts.
3. OPT-06 исправление 404 и media pipeline/cache.
4. OPT-02 client progressive bootstrap/cache.
5. OPT-03 polling engine.

Release gate A: client cold/warm SLO, 0 media 404, нет duplicate startup fetch.

### Волна B — backend и staff/admin

1. OPT-04 Admin section loading.
2. OPT-05 staff bootstrap.
3. OPT-07 revisions/ETag/cache/gzip.
4. OPT-08 batch SQL/indexes/projections.
5. OPT-09 pool/timeouts/logging.
6. OPT-12 CORS round trips.

Release gate B: API/load SLO, query-count tests, roles/foreign-order tests,
clean-DB migration, OpenAPI generated types check.

### Волна C — подтверждённые остатки

1. OPT-10 worker concurrency/cleanup.
2. OPT-11 только подтверждённые bundle/render changes.
3. Повторный production trace и обновление baseline.

Каждая волна — отдельная команда пользователя/этап. Не начинать следующую
автоматически.

## 10. Общая приёмка глобальной оптимизации

Функциональная:

- автомат заказа остаётся `NEW -> OUT_FOR_DELIVERY -> DELIVERED`;
- `CANCELLED` только ADMIN с причиной;
- kitchen имеет единственную основную кнопку `ЗАКАЗ ГОТОВ`;
- online payment подтверждается только server verification;
- idempotency и unique constraint сохранены;
- чужой client order не читается;
- staff roles проверяются backend;
- menu snapshot в order items не меняется после CMS edit;
- архивирование блюда не удаляет историю.

Производительность:

- выполнены все SLO раздела 4 на cold и warm run;
- 100-client smoke без timeout/error;
- нет 404 опубликованных media;
- нет перекрывающегося или hidden polling;
- client startup не загружает history;
- Admin startup не загружает невидимые sections;
- query count остаётся bounded при росте page с 1 до 20/50.

Инженерная:

- `go test ./...` проходит на версии Go, доступной локально и в CI;
- `pnpm check`, `pnpm build`, lint/typecheck проходят;
- migrations применяются на чистой PostgreSQL;
- OpenAPI и generated types совпадают;
- новые env есть в `.env.example` без секретов;
- runbook содержит BotFather `/main/`, Nginx, cache purge/recovery, media backfill;
- rollback проверен: предыдущий frontend работает с новым backend;
- в логах и telemetry нет PII/секретов.

## 11. Что не является хорошей оптимизацией для этого проекта

Не внедрять без нового явного ТЗ и измеримого основания:

- Redis только ради menu cache;
- CDN перед API или multi-region backend;
- WebSocket/SSE вместо простого polling;
- GraphQL ради объединения bootstrap;
- Kubernetes/autoscaling;
- materialized views/data warehouse для нескольких десятков заказов;
- виртуализацию списков по 20 строк;
- preload всех изображений/вкладок;
- бессрочный cache runtime/доступности;
- service worker, который cache-ит auth/orders/payment;
- увеличение DB pool до десятков/сотен connections без pool-wait evidence;
- переписывание React или Go на другой стек.

## 12. Риски и способы отката

| Риск | Защита/откат |
|---|---|
| Stale cached menu | revision + checkout revalidation; отключить чтение local cache feature flag |
| Stale in-process cache | safety TTL + invalidation after commit; restart очищает cache |
| Bootstrap несовместим с старым frontend | additive endpoints, старые endpoints остаются на один release |
| Media backfill ошибся | оригиналы сохраняются до верификации; DB переключается transactionally |
| ETag ошибочно даёт 304 | integration tests на каждую mutation; временно отключить conditional response |
| Polling перестал восстанавливаться | manual refresh + focus test + fallback interval flag |
| Новый index ухудшил write | EXPLAIN/pg_stat до/после; удалить только конкретный подтверждённо вредный index |
| Pool исчерпан | pool-wait log, rollback env без code deploy |
| GitHub Pages/VPS разъехались | backward compatible API и deploy backend-before-frontend |

## 13. Результат аудита

Наибольший ожидаемый эффект дадут не «микрооптимизации React», а совместное
выполнение OPT-01, OPT-02, OPT-04, OPT-06, OPT-07 и OPT-08. Они убирают главные
причины пятисекундного ожидания: блокирующие внешние ресурсы, последовательные и
повторные round trips, тяжёлые/битые изображения, глобальные Admin refresh и
SQL N+1.

После этих работ дальнейшая оптимизация разрешается только по новому trace:
сначала измеряется оставшийся bottleneck, затем выбирается минимальное изменение.
