# TK Delivery

Простая система заказов и доставки для одного небольшого ресторана внутри
Telegram Mini Apps.

Актуальная документация:

- [навигация](docs/README.md);
- [мастер-ТЗ](docs/00_MASTER_SPEC.md);
- [этапы реализации](docs/stages).

Production Mini App URL:
`https://takolako.site/`.

Production API/webhook host:
`https://api.takolako.site/`.

Client Mini App локально:

```text
http://127.0.0.1:5173/
```

Команда запуска:

```powershell
pnpm client:dev
```

GitHub Pages собирает frontend под custom domain. Frontend в production ходит
в backend `https://api.takolako.site`.

Staff Mini Apps для этапа 3:

```text
https://takolako.site/kitchen/
https://takolako.site/courier/
```

Локально:

```powershell
pnpm kitchen:dev
pnpm courier:dev
```

Admin Mini App для этапа 4:

```text
https://takolako.site/admin/
```

Локально:

```powershell
pnpm admin:dev
```

Admin управляет меню, графиком, ручным `ВЫХОДНОЙ`, заказами, staff,
настройками и простой аналитикой. GitHub Pages хранит только статический
frontend; база, Telegram webhooks и business logic работают на backend.

`PLAN_v1.md` сохранён как исходный черновик. При противоречии приоритет имеют
мастер-ТЗ, файл текущего этапа и `AGENTS.md`.
