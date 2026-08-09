# TK Delivery

Простая система заказов и доставки для одного небольшого ресторана внутри
Telegram Mini Apps.

Актуальная документация:

- [навигация](docs/README.md);
- [мастер-ТЗ](docs/00_MASTER_SPEC.md);
- [этапы реализации](docs/stages).

Временный GitHub Pages URL для Telegram Mini App preview:
`https://eqwertyry121.github.io/TL/`.

Client Mini App локально:

```text
http://127.0.0.1:5173/
```

Команда запуска:

```powershell
pnpm client:dev
```

GitHub Pages собирает `apps/client` в staging demo mode, пока production backend
не перенесён на сервер.

Staff Mini Apps для этапа 3:

```text
https://eqwertyry121.github.io/TL/kitchen/
https://eqwertyry121.github.io/TL/courier/
```

Локально:

```powershell
pnpm kitchen:dev
pnpm courier:dev
```

`PLAN_v1.md` сохранён как исходный черновик. При противоречии приоритет имеют
мастер-ТЗ, файл текущего этапа и `AGENTS.md`.
