# Global optimization completion audit

Дата: 2026-08-14
Статус: локальная реализация и локальные gates зелёные; полная цель
`выполни ТЗ` ещё не доказана, потому что production/staging приёмка зависит от
внешнего rollout и сейчас не проходит.

Этот документ фиксирует, какие требования из
[`GLOBAL_OPTIMIZATION_SPEC.md`](GLOBAL_OPTIMIZATION_SPEC.md) уже подтверждены
текущим состоянием репозитория, а какие требуют внешнего действия или нового
production trace. Он не заменяет сам runbook:
[`optimization-runbook.md`](optimization-runbook.md).

## 1. Текущее решение по завершённости

Цель нельзя считать полностью закрытой, пока не будут выполнены и записаны:

1. backend-first deploy оптимизированного API/proxy на staging/production;
2. `PERF_BASE_URL=... pnpm perf:deployment-diagnostics` без failures;
3. `PERF_BASE_URL=... pnpm perf:release-acceptance` без failures;
4. production media backfill dry-run/apply и проверка опубликованных media URL;
5. Telegram Android/iOS или эквивалентные production mobile traces с p75/p95;
6. обновление [`performance-results.md`](performance-results.md) фактическими
   production/staging результатами.

До этих пунктов статус корректный: **локально реализовано, production-приёмка
не доказана**.

## 2. Последняя локальная доказательная база

Проверки, выполненные на текущем worktree:

| Требование | Доказательство |
|---|---|
| Typecheck, contracts, docs links, wrapper tests | `pnpm check` проходит |
| Production frontend build | `pnpm build` проходит |
| Bundle budgets из ТЗ | `pnpm perf:budgets` проходит |
| Frontend deploy cannot bypass stale API contract | GitHub Pages workflow runs `pnpm perf:deployment-diagnostics` against `https://api.takolako.site` with `PERF_EXPECTED_BUILD_SHA=${{ github.sha }}` before frontend build/deploy |
| Backend CI proves optimized public/CORS contract locally | Backend workflow runs `scripts/cors-contract.mjs`, then `scripts/production-contract.mjs`, then `scripts/load-smoke.mjs` against the locally launched API, including `/api/v1/version` body validation |
| Direct local runtime API smoke | 2026-08-14 fresh PostgreSQL 16 + local Go API passed CORS contract, optimized public contract, 1/20/100 public load-smoke and 20x checkout calculation; worst fresh public p95 was 52 ms and checkout p95 was 37 ms |
| Go unit/integration без внешнего DSN | `pnpm go:test` проходит |
| Go vet | `pnpm go:vet` проходит |
| Формат Go | `gofmt -l backend` без вывода |
| Whitespace diff | `git diff --check` проходит |
| Clean PostgreSQL integration gate | временный PostgreSQL 16 cluster под `.codex-tmp`, затем `pnpm go:test:postgres` проходит |
| Production diagnostic state | `PERF_BASE_URL=https://api.takolako.site pnpm perf:deployment-diagnostics` сейчас падает на `cors-contract` и `production-contract` |

Текущий production diagnostic результат:

- legacy `/api/v1/runtime` и `/api/v1/menu?locale=ru` возвращают совместимый
  `200` JSON;
- allowed CORS preflight возвращает `204`, exact origin, methods,
  `Authorization,Content-Type,Idempotency-Key`, `Max-Age: 600`, `Vary: Origin`;
- production CORS всё ещё не разрешает `If-None-Match` и не expose-ит
  `ETag`/`Server-Timing`;
- `/api/v1/version` возвращает `404`; после backend rollout он должен
  возвращать deployed `build_sha`, `service=tk-delivery` и
  `api_contract=global-optimization-v1`; final release evidence should run
  `PERF_EXPECTED_BUILD_SHA=<deployed-sha> pnpm perf:production-contract`;
- `/api/v1/bootstrap/public?locale=ru` возвращает `404`;
- `/api/v1/menu?locale=ru` и `/api/v1/runtime` возвращают `200`, но без нужных
  `ETag` и `Cache-Control`.

Локальный backend уже содержит требуемый CORS/header contract в
[`backend/internal/httpapi/server.go`](../backend/internal/httpapi/server.go),
а regression tests закреплены в
[`backend/internal/httpapi/server_test.go`](../backend/internal/httpapi/server_test.go).
Прямой локальный runtime smoke на свежей PostgreSQL 16 2026-08-14 дополнительно
доказал этот же contract на реально запущенном Go API:
`/api/v1/version`, `/api/v1/bootstrap/public`, menu/runtime ETag,
Cache-Control, empty 304, exact-origin CORS и repeated checkout calculation.
Следовательно, текущий внешний blocker — rollout/proxy state, а не отсутствие
локального кода.

## 3. Requirement-by-requirement audit

| Область ТЗ | Статус | Авторитетное доказательство / недостающий факт |
|---|---|---|
| OPT-00 reproducible measurements, budgets, smoke, beacon | Локально доказано; production SLO не доказан | `tests/performance/`, `scripts/load-smoke.mjs`, `pnpm perf:release-lab`, `pnpm perf:smoke`, `performance-results.md`; нужны production traces |
| OPT-01 HTML/Telegram/fonts/root fallback | Локально доказано; BotFather setting внешнее | `pnpm startup:assets:test`, `pnpm startup:contract:test`; BotFather URL должен быть проверен вручную |
| OPT-02 client progressive bootstrap/menu cache | Локально доказано | `pnpm storage:test`, `pnpm bootstrap:fallback:test`, `pnpm startup:contract:test` |
| OPT-03 visibility-aware polling | Локально доказано | `pnpm polling:test` покрывает overlap, hidden tab, resume, backoff, abort |
| OPT-04 Admin lazy sections/invalidation | Локально доказано | `pnpm startup:contract:test`, frontend source contracts |
| OPT-05 Kitchen/Courier bootstrap | Локально доказано | `pnpm startup:contract:test`, staff role isolation integration tests |
| OPT-06 media pipeline/cache | Локально доказано; production backfill не выполнен | `pnpm media:check`, `pnpm media:rendering:test`, Go media tests, Nginx template tests; нужен VPS backfill |
| OPT-07 revisions/ETag/cache/gzip/CORS | Локально доказано; production сейчас не соответствует | Go HTTP/cache tests, `pnpm load-smoke:test`, direct local runtime smoke against fresh PostgreSQL, `pnpm perf:production-contract:cli:test`, `pnpm perf:cors-contract:cli:test`; внешний `perf:deployment-diagnostics` падает |
| Public backend build identity | Локально доказано; production требует rollout evidence | `/api/v1/version`, OpenAPI/generated `VersionInfo`, Docker/Compose `APP_BUILD_SHA`, backend CI local `production-contract`, staging/production `PERF_EXPECTED_BUILD_SHA=<deployed-sha> pnpm perf:production-contract` |
| OPT-08 PostgreSQL N+1/indexes/projections/cleanup | Локально доказано на clean PostgreSQL | `pnpm go:test:postgres` на временном PostgreSQL 16 cluster проходит |
| OPT-09 pool/timeouts/safe observability | Локально доказано | Go tests, `.env.example`, `deploy/env.production.example`, safe logging/source guards |
| OPT-10 notification concurrency/cleanup | Локально доказано | Go notification unit + PostgreSQL integration tests |
| OPT-11 render/bundle after trace | Выполнено в разрешённом минимальном объёме | `pnpm perf:budgets` и local release lab проходят; дальнейшие lazy/memo changes требуют нового trace |
| OPT-12 CORS/round trips | Локально доказано; production сейчас не соответствует | `server.go` + `server_test.go`, backend CI local `cors-contract`, direct local runtime CORS smoke; external diagnostic показывает старый CORS header set |
| API/OpenAPI/generated types | Локально доказано | `pnpm openapi:check`, `docs/openapi.yaml`, `packages/api-client/src/generated.ts` |
| Миграции на чистой PostgreSQL | Локально доказано | `pnpm go:test:postgres` на fresh cluster проходит |
| Rollback compatibility with old frontend | Локально доказано | `pnpm bootstrap:fallback:test`, `pnpm perf:legacy-public-contract`/CLI contracts |
| Frontend deploy waits for optimized API contract | Локально доказано как CI source contract; production сейчас будет заблокирован | `.github/workflows/pages.yml` runs `pnpm perf:deployment-diagnostics` with exact `github.sha` build identity before app builds; current external diagnostic still fails until backend/proxy rollout |
| No forbidden infrastructure | Локально доказано | `pnpm architecture:guard:test` |
| No PII/secrets in perf/log telemetry | Локально доказано | `pnpm performance:beacon:test`, Go backend beacon tests, safe logging guards |
| Final production acceptance | Не доказано | требуется успешный staging/production deploy, smoke, media backfill и Telegram/mobile traces |

## 4. Нельзя использовать как доказательство завершения

- Один локальный `pnpm check` не доказывает production SLO.
- Локальный Vite/Playwright/Lighthouse lab не заменяет Telegram Android/iOS
  traces.
- Passing `legacy-public-contract` доказывает только rollback compatibility, но
  не доказывает оптимизированный API contract.
- Production `/menu` и `/runtime` с `200` без ETag/Cache-Control не считаются
  выполнением OPT-07.
- Документация runbook не доказывает, что BotFather, VPS, Nginx и media backfill
  реально применены.

## 5. Следующий порядок действий

1. Deploy backend/proxy по [`optimization-runbook.md`](optimization-runbook.md).
2. Сразу выполнить:

   ```bash
   PERF_BASE_URL='https://api.takolako.site' pnpm perf:deployment-diagnostics
   ```

3. Если diagnostics зелёный, выполнить:

   ```bash
   PERF_BASE_URL='https://api.takolako.site' pnpm perf:release-acceptance
   ```

4. Выполнить production media backfill dry-run, затем apply:

   ```bash
   pnpm media:backfill:dry-run -- -limit=100
   pnpm media:backfill -- -limit=100
   ```

5. Снять Telegram Android/iOS traces и записать p75/p95 в
   [`performance-results.md`](performance-results.md).
