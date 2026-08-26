# Performance test scaffold

Commands:

- `pnpm storage:test` - verifies the client public menu cache: per-locale keys,
  legacy cleanup, corrupt payload cleanup and TTL expiry.

- `pnpm auth:test` - verifies single-flight auth retry: concurrent 401/403
  failures share one authenticate call and non-auth failures are not retried.

- `pnpm media:rendering:test` - verifies frontend media rendering contracts:
  client menu images keep `srcSet`/`sizes`/geometry/lazy/eager/fetch priority,
  and Admin previews use thumbnail variants instead of full display images.

- `pnpm media:check` - verifies fixture/external image URLs stay out of runtime
  seed data and published menu photos are empty or optimized
  `/media/menu/*.jpg` paths.

- `pnpm env:contract:test` - verifies the optimization runtime knobs for DB
  pool, notification concurrency/backlog and server timing are present in both
  local and production env templates.

- `pnpm migrations:contract:test` - verifies migration numbering, required
  optimization indexes/media/revision schema and absence of destructive
  domain-data SQL in migrations. PostgreSQL integration tests still verify
  applying migrations on a clean database.

- `pnpm api:compatibility:test` - verifies optimization bootstrap/performance
  endpoints are additive and documented, while legacy runtime/menu/auth/list
  endpoints remain available for rollback and rolling GitHub Pages/VPS deploys.

- `pnpm performance:beacon:test` - verifies frontend performance beacon sampling
  stays clamped to 5% or lower and route/build text strips query/hash fragments
  before sanitizing.

- `pnpm architecture:guard:test` - verifies runtime code and deploy config do
  not introduce Redis, WebSocket/SSE, service workers, GraphQL, Kubernetes or
  Prometheus/Grafana, and that sensitive checkout state stays in
  `sessionStorage`.

- `pnpm docs:links:test` - verifies local Markdown links in `README.md` and
  `docs/` point to existing files or directories.

- `pnpm bootstrap:fallback:test` - verifies rolling deploy compatibility:
  client, staff and admin bootstrap calls keep 404-only fallback to the old
  auth/menu/list/section endpoints for one release.

- `pnpm startup:contract:test` - verifies startup-waterfall contracts: client
  bootstrap does not fetch history/contact, staff apps use role bootstrap, and
  Admin loads dashboard plus only the visible section.

- `pnpm startup:assets:test` - verifies startup HTML/CSS contracts: Telegram SDK
  stays `defer`, API/Telegram preconnects stay present, Google Fonts/external
  stylesheet imports stay out of the critical path, and menu/media images are
  not preloaded from the app shell.

- `pnpm load-smoke:test` - verifies the load-smoke runner itself: default public
  smoke requires ETag support, exercises concurrent `If-None-Match`/304
  responses, requires gzip for large JSON responses, reports `Server-Timing`
  p95 values when present, then checks published menu media URLs for `2xx`
  `image/*` responses.

- `pnpm polling:test` - verifies the shared polling engine with fake timers:
  overlap guard, hidden tab suppression, coalesced resume, backoff and abort.

- `pnpm perf:lab` — builds all four apps in demo mode, runs Playwright cold/warm
  startup checks, and runs API load smoke only when `PERF_BASE_URL` or
  `PERF_RUN_LOAD_SMOKE=true` is set.
- `pnpm perf:release-lab` — release-grade frontend lab. It builds all four apps,
  runs Playwright startup with `PERF_STARTUP_RUNS=20` and
  `PERF_RELEASE_STARTUP_SLO=true` by default, then runs bundle budgets. Record the
  attached p75/p95 artifacts in `docs/performance-results.md` before claiming
  frontend SLO completion.
- `pnpm perf:full` — one local full pass: builds the lab apps, runs Playwright,
  bundle budgets and API load smoke. Start the backend first or set `PERF_BASE_URL`
  to a staging/production-like API.
- `pnpm perf:smoke` — sends 1/20/100 concurrent reads to public API endpoints;
  useful for local checks because it defaults to `http://127.0.0.1:8080`.
- `pnpm perf:external-smoke` — staging/production release gate; requires
  explicit `PERF_BASE_URL`, rejects accidental localhost targets by default and
  keeps checkout calculation disabled unless explicitly overridden.
- `pnpm perf:production-contract` — fast staging/production preflight for the
  optimized public API contract. It verifies `/version`, `/bootstrap/public`,
  `/menu` and `/runtime` return JSON with required ETag/Cache-Control headers
  and 304 on `If-None-Match` before running a longer load smoke. `/version`
  must expose `service=tk-delivery`, `api_contract=global-optimization-v1` and a
  non-placeholder `build_sha`; set `PERF_EXPECTED_BUILD_SHA=<deployed-sha>` when
  the release must prove an exact backend build.
  Backend CI also runs `perf:cors-contract` and this check against the locally
  launched API with `PERF_ALLOW_LOCAL_BASE_URL=true` before `pnpm perf:smoke`, so
  the same CORS and public contracts are proven before local concurrent load.
- `pnpm perf:legacy-public-contract` — fast staging/production rollback
  compatibility preflight for the old public frontend contract. It verifies the
  legacy public `/runtime` and `/menu` JSON shapes still contain the fields a
  previous frontend release expects.
- `pnpm perf:cors-contract` — fast staging/production CORS preflight check. It
  verifies exact allowed origin, required methods/headers, `Max-Age >= 600`,
  `Vary: Origin`, exposed `ETag`/`Server-Timing`, and rejection of a foreign
  origin without wildcard headers.
- `pnpm perf:release-acceptance` — staging/production umbrella release gate. It
  requires explicit `PERF_BASE_URL`, runs legacy public compatibility, CORS,
  optimized public contract and the longer external smoke in order, and stops
  at the first failing gate.
- `pnpm perf:deployment-diagnostics` — staging/production fast diagnostic pass.
  It requires explicit `PERF_BASE_URL`, runs legacy public compatibility, CORS
  and optimized public contract preflights, continues after failures, and
  reports all failing preflights without running the longer load smoke.

Useful env:

- `PERF_LAB_MAX_STARTUP_MS=4000` — local Playwright marker visibility budget.
- `PERF_STARTUP_RUNS=3` — number of cold/warm startup samples per app in the
  Playwright lab; raise to `20` for release profiling before recording p75/p95
  in `docs/performance-results.md`.
- `PERF_RELEASE_STARTUP_SLO=true` — enables app-specific Playwright p75/p95
  startup budgets from the optimization spec. `perf:release-lab` sets this by
  default; normal CI lab keeps the broader smoke budget unless this is enabled.
- `PERF_STARTUP_OUTPUT_DIR=test-results/performance-startup` — directory where
  Playwright writes stable per-app startup JSON artifacts in addition to test
  attachments.
- `PERF_BASE_URL=https://api.example.test` — API target for load smoke.
- `PERF_MAX_P95_MS=500` — API smoke p95 budget.
- `PERF_VALIDATE_ETAG=false` — skip the default ETag/304 validation phase for
  custom non-cacheable endpoints.
- `PERF_REQUIRE_ETAG=false` — allow endpoints without ETag while still measuring
  fresh requests.
- `PERF_VALIDATE_GZIP=false` — skip the default gzip validation phase for custom
  endpoint experiments; do not disable for release acceptance.
- `PERF_GZIP_MIN_BYTES=1024` — decoded JSON response size from which fresh
  smoke responses must include `Content-Encoding: gzip`.
- `PERF_VALIDATE_MEDIA=false` — skip menu media validation for intentionally
  non-menu endpoint smoke tests.
- `PERF_MEDIA_MENU_ENDPOINT=/api/v1/menu?locale=ru` — menu endpoint used to
  discover published media URLs during load smoke.
- `PERF_MEDIA_CONCURRENCY=6` — maximum number of menu images validated at once;
  this avoids creating an artificial connection storm during release smoke.
- `PERF_ALLOW_LOCAL_BASE_URL=true` — allows localhost for the external-smoke and
  release-acceptance wrappers only in wrapper tests or deliberate local dry-runs.
- `PERF_CORS_ORIGIN=https://takolako.site` — allowed frontend origin for
  `perf:cors-contract`.
- `PERF_CORS_FOREIGN_ORIGIN=https://evil.example` — disallowed origin used by
  `perf:cors-contract` to verify no wildcard/foreign origin leak.

This scaffold is intentionally small. Real completion still requires production
Telegram Android/iOS traces and controlled-host API load runs recorded in
`docs/performance-results.md`.
