# Изолированный dev-контур

Актуальная архитектура и порядок работы описаны в
[`DEV_SANDBOX_SPEC.md`](DEV_SANDBOX_SPEC.md).

Коротко: ветка `test` публикуется в `/testbranch/`, использует отдельные API и
PostgreSQL, а доступ разрешён только Telegram ID из
`DEV_SANDBOX_ALLOWED_TELEGRAM_IDS`. Отдельный Telegram-бот и изменение Nginx не
нужны: основной backend безопасно проксирует `/testbranch-api/`, а команды
`/dev` и `/prod` переключают владельца между средами.
