# Этап 6 — production, тестирование и запуск

## Цель

Развернуть простую систему на одном VPS, проверить backup/roles/devices и
провести контролируемый запуск ресторана.

## Критерии входа

- Этапы 1–4 приняты.
- Cash fiscal process принят.
- Каждый enabled online payment прошёл этап 5.
- Есть VPS/domain/client+staff production bots.
- Staff прошёл staging flow.

## 1. Production topology

```text
Internet
  → GitHub Pages HTTPS
      → frontend static files on takolako.site
  → VPS Nginx HTTPS on api.takolako.site
      → Go app API/webhooks/media
  → private Docker network
      → PostgreSQL

Persistent host/volume:
  → uploads

External backup:
  → pg_dump + uploads archive
```

Docker Compose:

- `app`;
- `postgres`;
- `nginx` on VPS for `api.takolako.site`.

Больше services не добавлять без измеренной причины.

## 2. VPS

- supported Linux;
- firewall default deny;
- public 80/443;
- SSH keys only, root/password login off;
- PostgreSQL port not public;
- automatic security updates according to owner policy;
- NTP/time correct;
- enough disk with alert threshold;
- TLS certificate and renewal test.

## 3. Images/runtime

- multi-stage builds;
- pinned base images;
- non-root app;
- production image has no dev mock/secret;
- immutable git SHA tag;
- healthcheck;
- graceful shutdown;
- app restart policy;
- persistent upload mount;
- frontend hashed assets.

## 4. Nginx

- HTTP→HTTPS;
- exact hosts;
- TLS;
- API/body upload limits;
- security headers/CSP/CORS for exact origins;
- media cache;
- no public metrics/debug/pprof;
- webhook routes with correct limits;
- access logs do not include sensitive query/body.

## 5. CI/CD

Pull request:

- format/lint/typecheck;
- Go/frontend tests;
- OpenAPI generation diff;
- build four apps/backend;
- dependency vulnerability scan;
- Docker build.

Main:

- publish immutable image;
- deploy staging;
- smoke.

Production:

- manual approval;
- backup;
- migration;
- deploy same tested image;
- health/smoke;
- easy rollback previous image.

Не делать build/git pull прямо на VPS.

## 6. Logs и alerts

Structured JSON logs:

- level/time/service/version;
- request ID/order ID/payment ID;
- no phone/address/token/initData.

Alerts в private ADMIN/developer Telegram chat:

- app/DB unavailable;
- repeated 5xx;
- notification queue stuck;
- paid order not becoming NEW;
- payment/fiscal webhook failure;
- disk low;
- backup old/failed.

Alert содержит safe summary/request ID, не stack с PII.

Prometheus/Grafana не нужны. Для старта достаточно health monitor, logs,
Telegram alerts и Admin problem counters.

## 7. Backup

Daily:

- `pg_dump` custom/compressed;
- archive uploads;
- encryption;
- copy outside VPS;
- retention, например daily+weekly, approved by owner;
- checksum/status alert.

До launch:

1. взять backup;
2. развернуть отдельную test PostgreSQL;
3. restore;
4. проверить counts/menu/orders/settings;
5. восстановить несколько images;
6. запустить smoke без внешних production messages;
7. записать фактическое время.

Backup без restore test не считается готовым.

## 8. Security release check

- Telegram forged/stale/wrong bot;
- CLIENT чужой order;
- KITCHEN address/phone absent;
- COURIER/Admin roles;
- revoked staff;
- SQL/input/XSS/upload;
- secret scan;
- CORS/CSP/TLS;
- payment webhook signature/amount;
- logs/storage no secrets;
- admin audit;
- DB port closed.

Исправить все критические/high findings.

## 9. Functional UAT

Участники: owner/ADMIN, Kitchen/официант, Courier.

Сценарий:

1. ADMIN проверяет menu/schedule/flat fee.
2. Client создаёт cash order.
3. Order сам появляется Kitchen.
4. Kitchen нажимает только `ЗАКАЗ ГОТОВ`.
5. Client и Courier получают message.
6. Courier видит address/phone и нажимает `ДОСТАВЛЕНО`.
7. Cash/payment/fiscal records сверяются.
8. ADMIN скрывает dish; Client больше его не заказывает.
9. ADMIN включает `ВЫХОДНОЙ`; Client видит red banner и не оформляет.
10. ADMIN выключает; schedule снова действует.
11. Проверить after 21 и Monday.
12. Проверить accidental ready → Admin return to NEW.
13. Repeat enabled card/crypto flows if any.

## 10. Device matrix

- Telegram Android;
- Telegram iOS;
- Telegram Desktop на фактическом компьютере Admin/Kitchen;
- фактический Kitchen tablet;
- фактический Courier phone;
- light/dark;
- keyboard/address input;
- slow/unstable network;
- close/reopen apps.

Зафиксировать OS/Telegram version/result.

## 11. Concurrency/reliability smoke

- 100 clients read menu at once;
- repeated/double checkout same key;
- two Kitchen sessions press ready;
- two Courier sessions press delivered;
- app restart during polling;
- notification Bot API unavailable then restored;
- DB restart;
- payment duplicate webhook;
- full 4-hour staff app soak if practical.

Ожидание: no duplicate order/status/message, UI recovers polling.

## 12. Go/no-go

Обязательно:

- menu/prices/translations correct;
- initial staff roles correct;
- Monday/13/21/22/manual day off correct;
- cash/change/fiscal process known;
- enabled payment tested;
- support contact available;
- backup restored;
- rollback tested;
- no critical defects;
- staff understands the two buttons.

Если payment/fiscal not ready, method hidden. Если cash fiscal not ready,
production sales no-go.

## 13. Запуск

1. Deploy approved image/migrations.
2. Healthcheck.
3. Keep manual `ВЫХОДНОЙ` on.
4. Internal smoke.
5. Turn off manual day off during order hours.
6. One controlled real cash order end-to-end.
7. Reconcile payment/receipt.
8. Enable card separately and test small payment/refund, if ready.
9. Crypto separately, if approved.
10. Monitor first shift.

При дублях, неверной сумме, unauthorized access или потерянном paid order:
включить `ВЫХОДНОЙ`, остановить new checkout и действовать по runbook.

## 14. Первые 7 дней

Каждый день:

- orders/cancellations;
- cash/card/crypto totals;
- fiscal receipts;
- notification failures;
- staff feedback;
- backup status.

Изменения — только fixes действительно мешающих проблем. Не добавлять новые
features в первую неделю.

## Артефакты этапа

- production Compose/Nginx;
- CI/CD;
- HTTPS/firewall;
- logs/alerts;
- backup + restore evidence;
- security/device/UAT reports;
- staff instruction;
- launch/rollback runbook.

## Acceptance criteria

- Production flow от Client до Courier проходит.
- Kitchen/Courier интерфейсы остаются одно-кнопочными.
- Red `ВЫХОДНОЙ` switch работает мгновенно.
- DB/media восстановлены из offsite backup.
- PostgreSQL/secrets not public.
- Device matrix passed.
- No open critical/high issue.
- First real orders/payment/fiscal totals match.

## Не входит

- High availability/multiple VPS.
- Kubernetes/monitoring stack.
- New product features.

## Критерий выхода

Приложение работает в ресторане, staff понимает его без обучения сложным
процессам, а owner может остановить orders одной кнопкой и восстановить данные
из backup.
