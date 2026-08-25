# Runbook: global optimization rollout

This runbook covers the optimization changes without changing the project
architecture: one Go backend, one PostgreSQL, one VPS, GitHub Pages frontend and
polling.

## 1. Pre-deploy checks

Run locally or in CI:

```bash
pnpm check
pnpm build
pnpm perf:budgets
pnpm go:test
pnpm go:vet
```

If a PostgreSQL test database is available:

```bash
TK_TEST_POSTGRES_DSN='postgres://postgres:postgres@localhost:5432/tk_delivery_test?sslmode=disable' \
  pnpm go:test:postgres
```

`pnpm go:test:postgres` intentionally requires `TK_TEST_POSTGRES_DSN` and runs
the full Go suite as `go test ./... -count=1`. This catches store,
notifications, HTTP/API and migration regressions in one release gate; the
PostgreSQL integration helpers serialize schema reset/migration with a shared
advisory lock, so the store and notification suites can safely run in the same
command against one test DSN.

The Go wrapper uses the system Go when it satisfies `go.mod`; otherwise it uses
an already downloaded matching Go toolchain, or fails with a clear `GO_EXE`
instruction. This avoids local failures when an older `go` binary is first in
`PATH`.

For local lab checks:

```bash
PERF_BASE_URL='http://127.0.0.1:8080' pnpm perf:full
```

`perf:full` runs the lab build, Playwright startup checks, Lighthouse and API
load smoke in one command. Start the backend first, or point `PERF_BASE_URL` to
a staging/production-like API.

For release frontend SLO evidence:

```bash
pnpm perf:release-lab
```

`perf:release-lab` builds all four apps, runs Playwright startup with
`PERF_STARTUP_RUNS=20` and `PERF_RELEASE_STARTUP_SLO=true` by default, then runs
Lighthouse. Startup JSON artifacts are written to
`test-results/performance-startup/*.json`; record the cold/warm p75/p95 values
in `docs/performance-results.md`. Do not claim frontend SLO completion from the
short default `perf:playwright` smoke alone.

For API load smoke against staging/production-like backend:

```bash
PERF_BASE_URL='https://api.takolako.site' pnpm perf:deployment-diagnostics
PERF_BASE_URL='https://api.takolako.site' pnpm perf:release-acceptance
```

`perf:deployment-diagnostics` is the fast post-deploy diagnostic pass. It runs
legacy public compatibility, CORS and optimized public contract preflights, but
continues after a failure and reports every failed preflight. Use it immediately
after a VPS/proxy rollout to see the full header/contract state before spending
time on the longer smoke.

The GitHub Pages deploy workflow also runs this diagnostic against
`https://api.takolako.site` before building and publishing the frontend. This is
intentional: optimized frontend releases must not go out while production API
still returns the old no-ETag/no-bootstrap contract. If this step fails, deploy
or fix the backend/proxy first rather than bypassing the frontend gate.

`perf:release-acceptance` is the umbrella production release gate. It requires
an explicit `PERF_BASE_URL`, rejects accidental localhost targets by default,
keeps checkout calculation disabled unless explicitly overridden, and runs the
checks below in order. It stops at the first failure so the primary blocker is
visible.

Run individual checks only when debugging or when you need a targeted preflight:

```bash
PERF_BASE_URL='https://api.takolako.site' pnpm perf:legacy-public-contract
PERF_BASE_URL='https://api.takolako.site' pnpm perf:cors-contract
PERF_BASE_URL='https://api.takolako.site' PERF_EXPECTED_BUILD_SHA='<deployed-commit-sha>' pnpm perf:production-contract
PERF_BASE_URL='https://api.takolako.site' pnpm perf:external-smoke
```

Run `perf:legacy-public-contract` first after backend deploy if frontend rollout
is not simultaneous. It is a cheap public GET preflight that checks the old
public `/runtime` and `/menu` response shapes still contain the fields required
by the previous frontend release.

Run `perf:cors-contract` to verify the cross-origin startup path before mobile
traces: exact allowed origin, required methods/headers, `Access-Control-Max-Age`
at least 600, `Vary: Origin`, exposed `ETag`/`Server-Timing`, and foreign-origin
rejection without wildcard headers.

Run `perf:production-contract` next. It is a cheap public GET/conditional GET
preflight that proves the optimized API contract is live. It checks
`/api/v1/version`, `/api/v1/bootstrap/public`, public menu and runtime. Version
metadata confirms which non-secret backend build identity is live, while
runtime/menu/bootstrap prove the optimized ETag/Cache-Control contract. Every
checked endpoint must return the expected headers and an empty 304 for
`If-None-Match`. In staging/production the version body must expose
`service=tk-delivery`, `api_contract=global-optimization-v1` and a non-placeholder
`build_sha`; set `PERF_EXPECTED_BUILD_SHA` to the deployed commit SHA when you
need to prove that a specific backend build is serving traffic.

`perf:external-smoke` is the longer load-smoke phase used by the umbrella
release gate. Use `perf:smoke` for local API checks where the default
`http://127.0.0.1:8080` target is intentional.

The default smoke also reads `/api/v1/menu?locale=ru` and verifies every
published `photo_path`/`photo_variants.*.url` with a `2xx` `image/*` response.
Use `PERF_VALIDATE_MEDIA=false` only for custom non-menu endpoint experiments,
not for release acceptance.
Media checks use a bounded pool of six requests by default. Override it with
`PERF_MEDIA_CONCURRENCY` only when deliberately testing another network profile.

The default smoke sends `Accept-Encoding: gzip` and requires
`Content-Encoding: gzip` for fresh JSON responses whose decoded body is at least
1 KB. Use `PERF_VALIDATE_GZIP=false` only for custom endpoint experiments, not
for release acceptance.

When the backend exposes `Server-Timing`, the smoke output includes
`server_timing_p95_ms` per endpoint/phase. Use it to separate backend/db/encode
time from DNS/TLS/mobile network latency in staging or production traces.

Backend CI also starts the Go API against its PostgreSQL service and runs the
same runtime CORS preflight, optimized public contract and public load-smoke
gates before `go vet`.

Do not claim final SLO completion without recording the environment and results
in `docs/performance-results.md`.

## 2. Backend-first deployment

Deploy backend before frontend. The backend keeps old endpoints and adds:

- `/api/v1/bootstrap/public`;
- `/api/v1/bootstrap/client`;
- `/api/v1/bootstrap/staff`;
- `/api/v1/bootstrap/admin`;
- `/api/v1/performance/beacon`.

New public cache is short-lived and in-process. A backend restart is a safe cache
purge. Successful Admin menu/settings/schedule mutations invalidate public cache
in-process.

New non-secret env:

```dotenv
APP_BUILD_SHA=unknown
POSTGRES_MAX_CONNS=8
POSTGRES_MIN_CONNS=1
POSTGRES_MAX_CONN_IDLE_TIME=5m
NOTIFICATION_CONCURRENCY=4
NOTIFICATION_BACKLOG_ALERT_AFTER=60s
SERVER_TIMING_ENABLED=false
MEDIA_VOLUME_HOST_PATH=/srv/tk-delivery/uploads
```

Use `SERVER_TIMING_ENABLED=true` only for development or a protected diagnostic
window. It does not log PII, but it exposes timing headers.

Set `APP_BUILD_SHA` to the deployed commit SHA in the VPS environment or Docker
build args. The public `/api/v1/version` endpoint exposes only
`service`, `build_sha` and `api_contract`, so release diagnostics can prove
whether the optimized backend build is actually serving production traffic.
`APP_BUILD_SHA=dev` or `APP_BUILD_SHA=unknown` is acceptable only for local
developer smoke; staging/production `perf:production-contract` rejects those
placeholder values unless the run explicitly enables a local-only override.

## 3. Database migration

Migration `011_optimization_indexes.sql` adds indexes and clears obsolete
fixture media references. Migration `012_menu_media_metadata.sql` adds
PostgreSQL storage for immutable menu media variant metadata. Migration
`013_menu_revisions.sql` adds explicit `menu_revision` for revision-backed
public ETags.

For the current small dataset a normal migration is acceptable during a
maintenance window. If production tables have grown materially, create heavy
indexes manually with `CONCURRENTLY` before applying the migration logic.

Take a PostgreSQL backup before migration and verify restore in a test database
before production launch.

## 4. Nginx/API host

Use the updated examples:

- `deploy/nginx.api.example.conf`;
- `deploy/nginx.api.host.example.conf`.

Required behavior:

- gzip for JSON/JS/CSS/SVG/text, not for media;
- `Vary: Accept-Encoding`;
- immutable cache for `/media/`;
- `/media/` is served directly by Nginx from `MEDIA_VOLUME_HOST_PATH`, not
  proxied through Go on the production path;
- HTTP keep-alive to backend;
- exact origin CORS allowlist;
- bounded preflight cache.
- `/live` returns process liveness without DB;
- `/ready` returns readiness with a short PostgreSQL check;
- `/health` stays as a backward-compatible readiness alias for existing alerts.

Before switching an existing VPS from a Docker named uploads volume to the host
path used by the templates, copy the current files into
`MEDIA_VOLUME_HOST_PATH` during the maintenance window and verify ownership is
readable by Nginx and writable by the app container. Do not start the new
compose mount over an empty host directory until the copy is verified, because
that would hide old uploaded files from the container.

For a fresh VPS using the default container UID/GID from `deploy/Dockerfile`:

```bash
sudo install -d -o 10001 -g 10001 -m 0755 /srv/tk-delivery/uploads
```

If the Docker image is built with different `APP_UID`/`APP_GID`, use those
values instead.

## 5. GitHub Pages and BotFather

Build frontend after backend is live.

The Pages workflow enforces this order with the `API deployment diagnostics`
step. It passes `PERF_EXPECTED_BUILD_SHA=${{ github.sha }}`, so Pages deploy is
blocked unless production API both exposes the optimized contract and reports the
same backend build identity as the frontend commit. Locally the equivalent
command is:

```bash
PERF_BASE_URL='https://api.takolako.site' PERF_EXPECTED_BUILD_SHA='<deployed-commit-sha>' pnpm perf:deployment-diagnostics
```

Production Mini App URL in BotFather should point directly to:

```text
https://takolako.site/main/
```

Keep root `/` as public portal/fallback for older links. Avoid a production
startup path that loads `/` and then redirects to `/main/`.

## 6. Media rollout and backfill

New uploads create:

- display JPEG: `/media/menu/<id>.jpg`;
- thumbnail JPEG: `/media/menu/<id>_thumb.jpg`.

`photo_path` remains the display image fallback. `photo_variants` is additive and
safe for old frontend.

Backfill old menu photos with the CLI. Run dry-run first:

```bash
pnpm media:backfill:dry-run -- -limit=100
```

The npm script uses `scripts/media-backfill.mjs`, which removes the npm
argument separator before invoking Go, so `-limit=100` is passed to the
`mediabackfill` binary.

Apply only after checking the dry-run output:

```bash
pnpm media:backfill -- -limit=100
```

The command creates new immutable JPEG display/thumbnail files and updates
`menu_items.photo_path` plus `menu_media` metadata in one DB transaction. It
also bumps `menu_revision` in the same transaction. It does not remove
originals. Keep originals until visual verification succeeds and only then
remove orphan media with a separate safe cleanup.

## 7. Notification backlog alert

`NOTIFICATION_BACKLOG_ALERT_AFTER` controls the stale due-job threshold. In
non-dry-run mode the worker logs `pending_count`/`oldest_age_seconds` and sends
a direct ADMIN Telegram alert with only those aggregate values. The alert does
not include order body, phone, address, Telegram token or raw `initData`.

## 8. Rollback

Safe rollback paths:

- previous frontend works with new backend because old endpoints remain;
- new frontend falls back to old auth/list endpoints where implemented;
- restart backend to purge in-process public cache;
- disable `SERVER_TIMING_ENABLED`;
- lower `POSTGRES_MAX_CONNS`/`NOTIFICATION_CONCURRENCY` through env if VPS is
  constrained;
- disable performance beacon by setting `VITE_PERF_BEACON_SAMPLE=0`.

Do not roll back by deleting order, payment, session or notification data.
