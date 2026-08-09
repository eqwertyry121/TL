# TK Delivery

Простая система заказов и доставки для одного небольшого ресторана внутри
Telegram Mini Apps.

Актуальная документация:

- [навигация](docs/README.md);
- [мастер-ТЗ](docs/00_MASTER_SPEC.md);
- [этапы реализации](docs/stages).

Временный GitHub Pages URL для Telegram Mini App preview:
`https://eqwertyry121.github.io/TL/`.

Локальный preview уже работает без сборки:

```text
D:\TK_miniapp\public\index.html
```

Это статический demo prototype на fixture-данных. В нём можно переключаться
между Client/Kitchen/Courier/Admin, оформить тестовый cash-заказ, нажать
`ЗАКАЗ ГОТОВ`, затем `ДОСТАВЛЕНО`, и проверить ручной режим `ВЫХОДНОЙ`.

`PLAN_v1.md` сохранён как исходный черновик. При противоречии приоритет имеют
мастер-ТЗ, файл текущего этапа и `AGENTS.md`.
