# Performance results

## 2026-08-13 — local implementation checkpoint

Environment:

- Host: local Codex Windows workspace.
- API load smoke: backend CI now starts the Go API against the PostgreSQL
  service and runs public load-smoke at 1/20/100 concurrency. Direct local
  validation also passed on 2026-08-14 against an isolated temporary PostgreSQL
  16 cluster started from `D:\Postgres\bin` and local Go API
  `http://127.0.0.1:18337`; the temp cluster/processes were stopped after the
  run (`.codex-tmp/api-smoke-20260814003245`).
- Production/mobile Lighthouse/Playwright traces: not executed in this checkpoint.

Code-level gates:

| Check | Result |
|---|---|
| `pnpm check` | pass |
| `pnpm openapi:check` | pass: backend routes match OpenAPI, component schemas exist in generated TypeScript, and object schema fields/required flags/basic types match generated interfaces |
| `pnpm docs:links:test` | pass: local links in `README.md` and `docs/` resolve |
| `pnpm polling:test` | pass: overlap, hidden tab, coalesced resume, backoff, abort |
| `pnpm storage:test` | pass: public menu per-locale cache, legacy cleanup, corrupt/old/expired cleanup |
| `pnpm media:rendering:test` | pass: client menu images keep responsive geometry/fetch priority and Admin previews use thumbnail variants |
| `pnpm env:contract:test` | pass: env templates include optimization runtime knobs and production frontend workflows stamp builds with `github.sha` |
| backend CI PostgreSQL gate | pass by source contract: GitHub Actions runs `go test ./... -count=1` with `TK_TEST_POSTGRES_DSN` instead of a hard-coded package subset |
| backend CI local public API gate | pass by source contract: the locally launched backend runs `scripts/cors-contract.mjs`, then `scripts/production-contract.mjs`, then `scripts/load-smoke.mjs`, with localhost explicitly allowed only for this CI smoke, so exact-origin CORS, `/api/v1/version`, `/api/v1/bootstrap/public`, menu/runtime ETag, Cache-Control, version body and 304 behavior are proven before concurrent load |
| local runtime API smoke against isolated PostgreSQL | pass on 2026-08-14: fresh PostgreSQL 16 + local Go API proved exact-origin CORS, `/api/v1/version`, bootstrap/menu/runtime ETag/Cache-Control/empty 304, 1/20/100 public load smoke and 20x checkout calculation; worst recorded fresh public p95 was 52 ms and checkout calculate p95 was 37 ms |
| frontend deploy/performance CI gates | pass by source contract: GitHub Pages deploy runs root `pnpm check`, while Performance CI runs OpenAPI, media reference, production/legacy/CORS contract and wrapper contract gates before build/lab |
| frontend deploy production API gate | pass by source contract: GitHub Pages deploy runs `pnpm perf:deployment-diagnostics` against `https://api.takolako.site` with `PERF_EXPECTED_BUILD_SHA=${{ github.sha }}` before frontend build/deploy, preventing optimized frontend rollout while production API still exposes the old no-bootstrap/no-ETag contract or a different backend build |
| backend build identity contract | pass by source contract: `.env.example`, production env template, Dockerfile, Compose and backend CI propagate non-secret `APP_BUILD_SHA`; `/api/v1/version` exposes the sanitized build SHA for rollout diagnostics |
| `pnpm migrations:contract:test` | pass: migration numbering, required optimization indexes/media/revision schema and destructive domain-data SQL guard |
| `pnpm api:compatibility:test` | pass: additive optimization endpoints and legacy rollback endpoints stay present in backend and OpenAPI |
| `pnpm performance:beacon:test` | pass: frontend beacon sampling is clamped to <=5% and query/hash fragments are stripped before text sanitization |
| `go test ./...` performance beacon coverage | pass: backend accepts only known app/route enum pairs and rejects dynamic route strings |
| `go test ./...` public cache coverage | pass: runtime/menu concurrent cache misses are coalesced to one backend loader call |
| `go test ./...` media pipeline coverage | pass: PNG/JPEG/WebP inputs decode, JPEG EXIF orientation is applied, oversize bytes/dimensions reject before full bitmap decode, resize bounds hold |
| `go test ./...` Telegram client coverage | pass: client bot prompt path uses the shared bounded HTTP client instead of constructing a client per request |
| `go test ./...` notification worker coverage | pass: bounded worker concurrency continues processing when one Telegram job is blocked or fails |
| `go test ./backend/internal/notifications` with PostgreSQL | pass: concurrent workers do not double-claim notification jobs, restart reclaim only picks stale processing jobs, and cleanup preserves unexpired/unfinished rows |
| combined PostgreSQL integration suite | pass: store and notifications integration packages can run in one `go test` command against the same test DSN; helpers serialize schema reset/migration with a PostgreSQL advisory lock |
| `pnpm architecture:guard:test` | pass: runtime/deploy code does not introduce forbidden optimization infrastructure; sensitive checkout state stays out of `localStorage` |
| `pnpm auth:test` | pass: single-flight reauth, no retry for non-auth errors, at-most-one retry |
| `pnpm bootstrap:fallback:test` | pass: client/staff/admin keep 404-only fallback to old endpoints for rolling deploys |
| `pnpm startup:contract:test` | pass: client startup skips history/contact, staff uses bootstrap, Admin loads only visible section, Admin orders default page size stays 20 with max 50 |
| `pnpm startup:assets:test` | pass: Telegram SDK is deferred, API/Telegram preconnects are present, external font CSS and image preloads stay out of startup HTML/CSS |
| `pnpm load-smoke:test` | pass: smoke runner requires public ETag, verifies concurrent 304 responses, requires gzip for large JSON, aggregates `Server-Timing` p95 when present, validates published menu media URLs, and supports CI-only repeated checkout calculation |
| `pnpm build` | pass |
| `pnpm perf:budgets` | pass |
| `pnpm perf:lab:build` | pass |
| `pnpm perf:playwright` | pass: 4 startup tests; each test collects multiple cold/warm startup samples and records p75/p95 in the attached JSON artifact |
| `pnpm perf:lighthouse` | pass: 3 client runs, assertions processed |
| `pnpm perf:full` | command added; requires running API or `PERF_BASE_URL` |
| `pnpm media:backfill:cli:test` | pass: npm `--` separator is stripped before Go flags, so `-limit` reaches the backfill binary |
| `pnpm go:test:postgres:cli:test` | pass: PostgreSQL release-gate wrapper strips npm `--`, requires `TK_TEST_POSTGRES_DSN` and expands to the full `go test ./... -count=1` command |
| `pnpm perf:external-smoke:cli:test` | pass: staging/production smoke wrapper requires explicit `PERF_BASE_URL`, rejects localhost by default and keeps checkout calculation off unless overridden |
| `pnpm perf:production-contract:cli:test` | pass: staging/production contract preflight requires explicit non-local `PERF_BASE_URL`, verifies public version body/build identity plus bootstrap/menu/runtime ETag, Cache-Control and empty 304 behavior; optional `PERF_EXPECTED_BUILD_SHA` detects wrong backend rollout |
| `pnpm perf:legacy-public-contract:cli:test` | pass: staging/production rollback preflight requires explicit non-local `PERF_BASE_URL` and verifies old public `/runtime` and `/menu` JSON shapes |
| `pnpm perf:cors-contract:cli:test` | pass: staging/production CORS preflight requires explicit non-local `PERF_BASE_URL`, verifies exact origin, required methods/headers, max-age 600, exposed headers and foreign-origin rejection |
| `pnpm perf:release-acceptance:cli:test` | pass: staging/production umbrella release gate requires explicit non-local `PERF_BASE_URL`, runs legacy/CORS/optimized-contract/external-smoke checks in order, keeps production checkout disabled by default and stops at the first failing gate |
| `pnpm perf:deployment-diagnostics:cli:test` | pass: staging/production diagnostic preflight requires explicit non-local `PERF_BASE_URL`, runs legacy/CORS/optimized-contract checks to completion and reports all failed preflights without starting load smoke |
| `pnpm perf:release-lab:cli:test` | pass: frontend release lab wrapper defaults to 20 startup samples, enables release startup SLO mode, runs build/Playwright/Lighthouse in order and stops at the first failing lab phase |
| [`docs/optimization-completion-audit.md`](optimization-completion-audit.md) | added: current requirement-by-requirement audit distinguishes locally proven optimization work from external production/staging evidence still required before the goal can be marked complete |
| `pnpm media:backfill:dry-run -- -limit=100` | pass against isolated PostgreSQL: command runs through the wrapper with current migrations; local seed has 0 backfill candidates |
| `go test ./...` with Go 1.25.12 toolchain | pass |
| `go test ./... -count=1` with `TK_TEST_POSTGRES_DSN` | pass against isolated PostgreSQL: all Go packages plus PostgreSQL integration tests complete in one command |
| `pnpm go:test:postgres` with `TK_TEST_POSTGRES_DSN` | pass against isolated PostgreSQL: wrapper runs the full Go suite and prevents accidental PostgreSQL acceptance without a DSN |
| `go vet ./...` with Go 1.25.12 toolchain | pass |
| CORS/preflight regression tests | pass: exact allowlist origin, 600 s preflight cache, no wildcard headers for foreign origins |
| `git diff --check` | pass |
| media reference gate | pass: no fixture/external image URLs in runtime seed data; published menu photos are empty or `/media/menu/*.jpg` |
| query-count integration tests | pass against isolated PostgreSQL: calculate is bounded by cart size, create order is bounded by cart size, kitchen/courier active lists use 2 SQL queries at 20 orders, Admin/client `OrderSummary` list checks stay bounded |
| Admin date filter regression tests | pass: Belgrade local-day boundaries are filtered with UTC half-open range; source guard blocks `to_char`/`created_at::date` in `AdminOrders` |
| Admin orders EXPLAIN regression test | pass: realistic 4,000-row dataset uses `idx_orders_created_desc` for date filter and avoids `Seq Scan` on `orders` |
| Admin audit pagination tests | pass: audit log supports `limit`/`offset`, caps limit at 100 and reports `has_more` on PostgreSQL; frontend/fallback/demo contracts stay bounded |
| Admin analytics bounded contract | pass: UI/API range stays on fixed presets, backend custom range is capped, top dishes are limited to 10 in PostgreSQL and demo |
| Nginx direct media template | pass: production deploy templates mount uploads on a host path and serve `/media/` directly with immutable cache and gzip off |
| Order summary PII isolation tests | pass: Admin/client summary pages survive corrupt encrypted PII and source guard blocks PII/detail-table reads before detail endpoints |
| Client foreign-order isolation tests | pass: optimized client summary/bootstrap/detail paths stay scoped to `client_user_id` and reject another client's order |
| Staff role isolation tests | pass: a staff user assigned only `KITCHEN` can create a kitchen session but cannot obtain a `COURIER` session |
| `MarkReady` notification queue integration test | pass: `OUT_FOR_DELIVERY` is persisted before Telegram delivery and idempotency replay does not duplicate jobs |
| Order item snapshot integration test | pass: order item title/price/quantity/line total and input order survive Admin CMS edit plus delete/archive of a used menu item |
| Create cash order query-count integration test | pass: order item snapshots are inserted through one PostgreSQL `COPY` operation and create-order query count stays bounded from 1 to 8 cart items |
| `pnpm perf:smoke` against local API/PostgreSQL | pass |

Local API load-smoke against isolated PostgreSQL:

Same 2026-08-14 runtime pass first validated exact-origin CORS and the optimized
public contract: `If-None-Match` is allowed, `ETag`/`Server-Timing` are exposed,
foreign preflight is rejected, `/api/v1/version` returns
`service=tk-delivery`, `api_contract=global-optimization-v1` and local
`build_sha=dev` only under the explicit local override, and public
bootstrap/menu/runtime support ETag, Cache-Control and empty 304 responses.

| Endpoint | Mode | Concurrency | p95 |
|---|---|---:|---:|
| `/api/v1/bootstrap/public?locale=ru` | fresh | 1 | 3 ms |
| `/api/v1/bootstrap/public?locale=ru` | fresh | 20 | 19 ms |
| `/api/v1/bootstrap/public?locale=ru` | fresh | 100 | 52 ms |
| `/api/v1/bootstrap/public?locale=ru` | conditional 304 | 1 | 1 ms |
| `/api/v1/bootstrap/public?locale=ru` | conditional 304 | 20 | 2 ms |
| `/api/v1/bootstrap/public?locale=ru` | conditional 304 | 100 | 12 ms |
| `/api/v1/menu?locale=ru` | fresh | 1 | 1 ms |
| `/api/v1/menu?locale=ru` | fresh | 20 | 8 ms |
| `/api/v1/menu?locale=ru` | fresh | 100 | 28 ms |
| `/api/v1/menu?locale=ru` | conditional 304 | 1 | 1 ms |
| `/api/v1/menu?locale=ru` | conditional 304 | 20 | 2 ms |
| `/api/v1/menu?locale=ru` | conditional 304 | 100 | 7 ms |
| `/api/v1/runtime` | fresh | 1 | 1 ms |
| `/api/v1/runtime` | fresh | 20 | 7 ms |
| `/api/v1/runtime` | fresh | 100 | 23 ms |
| `/api/v1/runtime` | conditional 304 | 1 | 0 ms |
| `/api/v1/runtime` | conditional 304 | 20 | 2 ms |
| `/api/v1/runtime` | conditional 304 | 100 | 8 ms |
| `/api/v1/orders/calculate` | dev checkout calculation | 20 iterations / 5 concurrency | 37 ms |

Latest local bundle budget gate:

| App | JS gzip | Budget | CSS gzip | Budget |
|---|---:|---:|---:|---:|
| client | 75.77 KB | 80 KB | 7.38 KB | 10 KB |
| admin | 85.96 KB | 90 KB | 6.30 KB | 10 KB |
| kitchen | 66.15 KB | 90 KB | 3.83 KB | 10 KB |
| courier | 66.43 KB | 90 KB | 4.13 KB | 10 KB |

Latest local lab observations:

- Playwright startup lab passed for client, kitchen, courier and admin after
  cold and warm marker visibility checks.
- Full local `pnpm perf:release-lab` passed: it built all four apps, ran
  Playwright startup with `PERF_STARTUP_RUNS=20` and
  `PERF_RELEASE_STARTUP_SLO=true`, then ran three Lighthouse client preview
  passes. Stable startup artifacts were written to
  `test-results/performance-startup/*.json`; Lighthouse reports were written to
  `test-results/lighthouse/`. This is local Vite preview evidence, not a
  replacement for Telegram Android/iOS traces.

| App | Runs | Cold p75 | Cold p95 | Warm p75 | Warm p95 |
|---|---:|---:|---:|---:|---:|
| client | 20 | 8 ms | 10 ms | 9 ms | 13 ms |
| kitchen | 20 | 42 ms | 44 ms | 41 ms | 43 ms |
| courier | 20 | 39 ms | 41 ms | 37 ms | 39 ms |
| admin | 20 | 54 ms | 57 ms | 52 ms | 54 ms |

Representative Lighthouse run from the same local release lab:

| Metric | Result |
|---|---:|
| Performance score | 1.00 |
| First Contentful Paint | 0.3 s |
| Largest Contentful Paint | 0.6 s |
| Cumulative Layout Shift | 0.045 |
| Total Blocking Time | 0 ms |
| Speed Index | 0.4 s |

- Backend CI API load-smoke gate was added for public bootstrap/menu/runtime.
  The smoke now validates ETag/304 behavior before running fresh and conditional
  concurrency phases, aggregates `Server-Timing` p95 values when the backend
  exposes them, then verifies every published menu media URL returns a non-empty
  `image/*` response. A local result was recorded against isolated PostgreSQL.
- Performance CI now runs the lightweight regression gates before lab build:
  polling, storage, media rendering, env contract, architecture guard, auth
  retry, bootstrap fallback, documentation links, startup-waterfall contract,
  startup asset contract, production/legacy/CORS contract preflight tests and
  load-smoke runner tests.
- Migration contract guard now runs in `pnpm check` and Performance CI, so
  missing/reordered optimization migrations, dropped required indexes/media
  schema/revisions, and destructive domain-data SQL are caught before database
  integration tests.
- API compatibility guard now runs in `pnpm check` and Performance CI, so new
  bootstrap/performance endpoints stay additive and legacy runtime/menu/auth/list
  endpoints remain present for rollback and rolling GitHub Pages/VPS deploys.
- Performance beacon frontend guard now runs in `pnpm check` and Performance CI,
  so sampling stays capped at 5% and route/build strings strip query/hash
  fragments before sanitization.
- Backend performance beacon validation now accepts only known app/route enum
  pairs, so dynamic paths such as order IDs cannot enter telemetry even if a
  future frontend caller passes a sanitized string.
- Public runtime/menu cache now has unit coverage for blocked concurrent cache
  misses: 50 simultaneous callers are coalesced to one loader call before the
  warm cache path is used.
- Production Pages and Performance CI builds now set `VITE_BUILD_SHA` from
  `github.sha`, so sampled startup metrics can be mapped to an exact release.
- Performance CI now runs a production `pnpm build` and `pnpm perf:budgets`
  before the demo lab build, so PRs cannot pass performance checks only through
  the larger demo bundle path.
- Playwright startup lab now samples each app multiple times instead of relying
  on one cold/warm navigation. The attached JSON includes per-run data plus
  cold/warm p75 and p95; use `PERF_STARTUP_RUNS=20` before claiming release
  p75/p95 startup SLO.
- Frontend release lab wrapper was added for that evidence path:
  `pnpm perf:release-lab` builds all four apps, runs Playwright startup with
  `PERF_STARTUP_RUNS=20` and `PERF_RELEASE_STARTUP_SLO=true` by default, then
  runs Lighthouse. The short default `perf:playwright` smoke remains useful for
  PR regression checks, but is not enough to claim final frontend SLO completion.

Implemented since the audit baseline:

- Startup blockers removed: Telegram SDK `defer`, targeted `preconnect` hints
  for the API and Telegram origins, external Google Fonts import removed.
- Client root fallback with Telegram `initData` now renders the app directly
  instead of issuing a second document navigation to `/main/`; production
  BotFather should still point to `/main/`.
- Client/staff/admin bootstrap endpoints and frontend usage added.
- Client bootstrap now includes verified contact and at most one active/latest
  order summary after server-side Telegram auth; full history remains lazy and
  paginated on the history route.
- Client persistent browser cache is limited for the real app: checkout
  draft/progress/idempotency moved to `sessionStorage`, and legacy sensitive
  `localStorage` keys are removed on startup.
- Public menu browser cache and backend in-process menu/runtime
  cache/singleflight added.
- Client public menu browser cache now uses per-locale keys
  `tk.menu.v2.<locale>` and removes the old shared key, so switching languages
  does not evict another locale's warm startup snapshot.
- Visibility-aware non-overlapping polling added.
- Polling resume now refreshes immediately while coalescing duplicate
  focus/pageshow/visibility signals for 500 ms, and in-flight refreshes no
  longer create a follow-up duplicate request.
- Client order-detail polling stops after a full `DELIVERED`/`CANCELLED`
  detail is loaded; opening a terminal order from history still performs the
  initial detail fetch.
- Client, kitchen, courier and admin authenticated calls now retry once through
  the shared single-flight Telegram reauth helper on
  `401`/`403`/`AUTH_INVALID`/`FORBIDDEN`, preventing auth storms while keeping
  public menu cache intact.
- Bootstrap rolling-deploy compatibility is covered by a regression test: new
  client/staff/admin bootstrap calls fall back to old endpoints only when the
  new endpoint is missing with 404.
- Startup-waterfall regressions are covered by a source-level contract test:
  client bootstrap cannot silently start fetching history/contact again, staff
  apps must start through role bootstrap, and Admin startup must remain
  dashboard plus the visible section.
- Startup asset regressions are covered by a source-level contract test:
  Telegram SDK must remain `defer`, API/Telegram preconnects must remain in all
  app shells, Google Fonts/external stylesheet imports cannot return to the
  critical path, app shells cannot start preloading menu/media images, and the
  client root Telegram fallback cannot reintroduce a `/main/` document reload.
- API load-smoke now verifies public cache validators directly: default
  endpoints must expose ETag, a single `If-None-Match` request must return
  empty 304, and each configured concurrency is also tested in conditional
  304 mode. Fresh JSON responses with decoded body size at least 1 KB must
  include `Content-Encoding: gzip`. The smoke also reports
  `server_timing_p95_ms` when `Server-Timing` is present and checks published
  menu media URLs from `/api/v1/menu` for `2xx` `image/*` responses.
- Production contract preflight was added as a cheap release check before the
  longer smoke: it requires an explicit non-local `PERF_BASE_URL`, verifies the
  optimized public bootstrap route is live, and checks public
  bootstrap/menu/runtime ETag, Cache-Control and empty 304 behavior.
- Legacy public contract preflight was added for backend-before-frontend
  rollouts: it requires an explicit non-local `PERF_BASE_URL` and verifies the
  old public `/runtime` and `/menu` JSON shapes still contain the fields needed
  by the previous frontend release.
- `PERF_BASE_URL=https://api.takolako.site pnpm perf:legacy-public-contract`
  currently passes against production: old public `/runtime` and `/menu` return
  `200` JSON with the fields required by the previous public client frontend.
- CORS contract preflight was added for staging/production: it uses only
  `OPTIONS` requests and verifies exact allowed origin, required
  methods/headers, `Access-Control-Max-Age >= 600`, `Vary: Origin`, exposed
  `ETag`/`Server-Timing`, and rejection of a foreign origin without wildcard
  headers.
- `PERF_BASE_URL=https://api.takolako.site pnpm perf:cors-contract` currently
  fails against production: allowed preflight returns `204` with exact
  `Access-Control-Allow-Origin`, methods, `Authorization/Content-Type/
  Idempotency-Key`, `Max-Age: 600` and `Vary: Origin`, but it misses
  `If-None-Match` in allowed headers and does not expose `ETag`/`Server-Timing`.
  Foreign origin is correctly rejected with `403` and no wildcard headers.
- `PERF_BASE_URL=https://api.takolako.site pnpm perf:release-acceptance`
  currently stops at `cors-contract` after a passing legacy public contract:
  allowed preflight returns `204` with exact origin, methods,
  `Authorization/Content-Type/Idempotency-Key`, `Max-Age: 600` and
  `Vary: Origin`, but misses `If-None-Match` in allowed headers and does not
  expose `ETag`/`Server-Timing`. Foreign origin remains correctly rejected with
  `403` and no wildcard headers.
- `PERF_BASE_URL=https://api.takolako.site pnpm perf:deployment-diagnostics`
  was added as a fast post-deploy diagnostic pass that continues after failures
  and reports all failed preflights before the longer release smoke is attempted.
  Current production result on 2026-08-14: CORS and optimized public contract
  fail. Legacy `/api/v1/runtime` and `/api/v1/menu?locale=ru` still return
  compatible `200` JSON, but the durable blockers remain: CORS misses
  `If-None-Match`/exposed `ETag`/exposed `Server-Timing`, `/api/v1/version`
  returns `404`, public bootstrap returns `404`, and public menu/runtime still
  miss ETag/Cache-Control.
- Backend CI now runs the same CORS preflight contract and optimized public API
  contract against the locally launched backend before load smoke:
  exact-origin CORS must allow `If-None-Match` and expose `ETag`/`Server-Timing`,
  `/api/v1/version` must expose the expected version body, and
  `/api/v1/bootstrap/public`, menu and runtime must expose the required
  ETag/Cache-Control/304 contract before concurrent reads start. The same
  backend CI load-smoke also enables a development-only repeated checkout
  calculation phase: the runner creates a `/api/v1/dev/session` client session
  and sends bounded `/api/v1/orders/calculate` requests. This covers the master
  spec's repeated checkout smoke without depending on production-only Telegram
  auth or cash-location flow; production/staging smoke can keep this phase off.
- Fixture/external media references are blocked from runtime seed data; menu
  item `photo_path` now accepts only empty values or optimized
  `/media/menu/*.jpg` paths, and upload is optimized to JPEG.
- Client menu images now keep responsive `srcSet`/`sizes`, explicit
  variant-derived dimensions and `fetchPriority="high"` for the hero/LCP image;
  Admin menu preview uses the thumbnail variant when available instead of
  loading the full display image.
- Gzip, ETag, Cache-Control and CORS preflight cache added; HTTP tests now
  pin exact-origin allowlist behavior, 600 s preflight cache and no wildcard
  CORS headers for foreign origins.
- Client, kitchen, courier and admin order list endpoints now return private
  ETag/304; frontend API helpers reuse 304 responses from in-memory cache only.
- Revision-backed public ETags added: `menu_revision` is bumped transactionally
  by menu CMS mutations and media backfill; runtime revision is bumped by
  settings/manual-day-off/schedule changes.
- Public runtime/menu in-process cache invalidation is limited to successful
  Admin mutations; read-only Admin settings/schedule views no longer purge the
  hot public cache, while manual-day-off and schedule updates do.
- Cart/order list SQL N+1 reductions and optimization indexes added.
- Admin orders date filtering now has two regression layers: integration coverage
  for `Europe/Belgrade` local-day boundaries, including the 2026-03-29 DST
  transition, and a source contract that prevents `to_char`/`created_at::date`
  from returning to the `AdminOrders` WHERE clause.
- Admin order date filtering now also has planner-level PostgreSQL coverage:
  after seeding a 4,000-row delivered-order history and running `ANALYZE`, the
  query plan for the bounded date page must use `idx_orders_created_desc` and
  must not use `Seq Scan` on `orders`.
- Admin and client order list endpoints now return paginated `OrderSummary`
  pages; items, events, phone and address are loaded only by detail endpoints.
  Admin orders backend/OpenAPI/frontend/demo fallbacks now default to 20 rows
  and cap at 50, avoiding the old 100-row default on manual or fallback calls.
- Admin audit log is now paginated and bounded: `/api/v1/admin/audit` accepts
  `limit`/`offset`, defaults to 50, caps at 100 and returns
  `entries/limit/offset/has_more`. Admin UI now keeps audit page state and shows
  `Назад`/`Дальше`, while legacy fallback and demo mode also slice by
  `limit/offset`; integration/source coverage verifies page separation and the
  max-limit cap.
- Admin analytics bounded contract now has source coverage: Admin UI remains on
  `today`/`7d`/`month` presets, backend rejects custom ranges above 370 days,
  and top dishes are capped at 10 in both PostgreSQL and demo mode.
- Production deploy templates now make the optimized media path explicit:
  compose mounts uploads from `MEDIA_VOLUME_HOST_PATH`, and both Nginx examples
  serve `/media/` directly from that host path with immutable cache, ETag and
  gzip disabled for images. The app container uses a stable UID/GID for the
  writable bind mount; Go media serving remains a local/dev fallback.
- Order summary endpoints now have direct PII isolation coverage: corrupt
  encrypted phone/address fields do not break Admin/client summary pages, while
  detail endpoints still require decryptable PII; a source contract also blocks
  `phone_ciphertext`, `address_ciphertext`, `order_items` and `order_events`
  from summary query bodies.
- Optimized client order paths now have explicit foreign-order isolation
  coverage: `ClientOrders`, `ClientBootstrapOrders` and `ClientOrderByID` remain
  scoped to the session `client_user_id`, and another client's order detail is
  rejected with `ErrForbidden`.
- Staff bootstrap/session role isolation now has PostgreSQL integration coverage:
  a kitchen-only staff record receives `KITCHEN` in the role list and can create
  a kitchen session, while attempting to create a `COURIER` session returns
  `ErrForbidden`.
- Order item snapshots now have PostgreSQL integration coverage: after creating
  an order with two items in cart order, an Admin title/price edit and
  delete-or-archive of the used menu item leave stored snapshot title, price,
  quantity, line total, totals and item order unchanged in client/admin detail.
- `CreateCashOrder` now inserts all `order_items` snapshot rows through a single
  transaction-scoped PostgreSQL `COPY` operation instead of one `Exec` per cart
  item. The store integration suite compares one-item and eight-item creates and
  fails if query count grows with cart size.
- Safe HTTP request logging now records request_id/method/route/status/duration
  and response bytes without URL query, body, Authorization or token values.
- Debug `Server-Timing` now records JSON encode timing for both normal and
  conditional JSON responses before headers are written.
- Go-related npm scripts now use `scripts/go-toolchain.mjs`, so local
  `go:test`, `go:vet`, `api:dev` and media backfill commands can use the
  required Go 1.25.12 toolchain even when an older system `go` is first in
  `PATH`.
- Media backfill npm commands now go through `scripts/media-backfill.mjs`, which
  strips the npm argument separator before invoking Go. This makes the runbook
  command `pnpm media:backfill:dry-run -- -limit=100` actually pass `-limit=100`
  to the `mediabackfill` binary instead of leaving it behind a `--`.
- Production env template now exposes the same optimization runtime knobs for
  PostgreSQL pool, notification concurrency/backlog and Server-Timing as the
  local `.env.example`, so VPS rollback/tuning does not require a code deploy.
- Architecture guard added: runtime/deploy code cannot introduce Redis,
  WebSocket/SSE, service workers, GraphQL, Kubernetes/autoscaling or
  Prometheus/Grafana, and checkout draft/progress/idempotency persistence is
  pinned to `sessionStorage`.
- Local Markdown link guard added for `README.md` and `docs/`, preventing
  optimization reports/runbooks from pointing at missing local files after
  future moves.
- `openapi:check` now verifies backend route coverage and a stronger
  OpenAPI/generated contract: component schemas must exist in
  `packages/api-client/src/generated.ts`, and object schema fields, required
  flags and basic scalar/enum types must match generated interfaces.
- Health endpoints are split into `/live` without DB and `/ready` with a short
  DB check; `/health` remains a compatibility readiness alias.
- Bounded DB pool, HTTP timeouts, notification concurrency, Telegram HTTP client
  transport limits and cleanup added. Cash-location/client bot prompts now reuse
  the shared bounded Telegram client, so prompt sends can reuse keep-alive
  connections instead of constructing a new client per request.
- Query-count integration coverage added for cart calculation and
  kitchen/courier/admin order lists. Kitchen/courier active lists now issue one
  order/user page query plus one batch `order_items` query, and the integration
  budget was tightened from 3 to the spec target of 2 SQL queries for 20 orders.
- `MarkReady` now has explicit integration coverage that the order status is
  already `OUT_FOR_DELIVERY` after the database transaction, pending
  client/courier notification jobs are queued for the worker, and idempotency
  replay does not duplicate those jobs. This proves the UI can observe the state
  by polling even if Telegram delivery later fails.
- Shared menu media pipeline added; PNG decode is covered by unit test and
  `backend/cmd/mediabackfill` can backfill old menu photos. Media tests now
  cover PNG/JPEG/WebP input decode, JPEG EXIF orientation correction, oversized
  input bytes, oversized image headers before full bitmap decode, unsafe
  dimensions and resize bounds. Menu media variant metadata is stored in
  PostgreSQL `menu_media` and read via JOIN.
- Go `/media/*` fallback now serves immutable files through `ServeContent` with
  explicit ETag/If-None-Match handling, range support and no gzip encoding;
  Nginx can still serve media directly in production.
- Notification stale backlog warning and direct ADMIN Telegram alert added
  without PII fields. Notification worker concurrency now has a regression test:
  with one blocked Telegram job, another job still starts, failures are logged
  without stopping the batch, and max active jobs stays within the configured
  bound. PostgreSQL-backed notification tests now also verify that concurrent
  workers partition claimed jobs without duplicates and that restart recovery
  reclaims only stale `processing` jobs. Daily cleanup is covered against the
  real schema: expired disposable rows are removed, while unexpired sessions,
  calculation/idempotency rows, unfinished notification jobs and order-linked
  cash-location challenges are preserved.
- PostgreSQL integration helpers now take a shared advisory lock before schema
  reset/migration. This prevents parallel Go package tests from dropping the
  shared `public` schema while another integration test is running, so the
  store and notifications suites pass both sequentially and in one combined
  `go test` command.
- Safe sampled performance beacon added; beacon and request logs use the
  configured server logger and tests verify that query strings, Authorization
  headers and Telegram initData are not logged. Backend route validation is an
  app-specific enum allowlist, not a generic safe-text regex.

Remaining measurements required before claiming final SLO completion:

- Backend CI load-smoke result from GitHub Actions or staging/production-like
  host.
- Staging/production umbrella release gate result from
  `PERF_BASE_URL=https://api.takolako.site pnpm perf:release-acceptance` after
  backend deploy and CORS/header fixes.
- Staging/production optimized-backend deploy must keep
  `perf:legacy-public-contract` green until the old frontend fallback is removed.
- Staging/production CORS preflight result from `perf:cors-contract` after the
  optimized backend deploy fixes `If-None-Match` and exposed timing/cache
  headers.
- Production smoke attempt on `https://api.takolako.site` from this workspace
  currently fails before load phase: `/api/v1/version` and
  `/api/v1/bootstrap/public?locale=ru` return `404`, while
  `/api/v1/menu?locale=ru` and `/api/v1/runtime` return `200` without ETag.
  This proves production is still running the pre-optimization API contract and
  must be redeployed before final SLO smoke can pass.
- `PERF_BASE_URL=https://api.takolako.site pnpm perf:external-smoke` currently
  fails with the same evidence through the explicit staging/production wrapper:
  public bootstrap returns `404`, and menu/runtime miss required ETag
  validators. The newly added gzip validation is not reached on production yet
  because the optimized route/ETag contract fails first. Do not replace this
  release-acceptance result with local `perf:smoke` output.
- `PERF_BASE_URL=https://api.takolako.site pnpm perf:production-contract` is now
  the first post-deploy check. It may also be run with
  `PERF_EXPECTED_BUILD_SHA=<deployed-sha>` to prove the exact backend build.
  Current result: version returns `404`; public bootstrap returns `404` and
  misses JSON/ETag/Cache-Control; menu returns `200` but misses ETag and public
  `Cache-Control`; runtime returns `200` but misses ETag and `no-cache`.
  Production has not exposed the optimized public
  build-identity/bootstrap/ETag/304 contract.
- Production/staging media backfill dry-run and apply result.
- Production/mobile cold/warm Playwright/Lighthouse-equivalent traces for
  client/kitchen/courier/admin.
- Staging/production `pnpm perf:release-lab` or equivalent mobile-browser
  frontend lab from the intended release environment. The full local release lab
  has been recorded, but it is not production network/device evidence.
- Real Telegram Android/iOS traces and final production p75/p95 comparison.
