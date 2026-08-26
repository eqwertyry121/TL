import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseNumberDraft } from "../apps/admin/src/number-draft.ts";

test("number draft stays empty while the admin replaces a price", () => {
  assert.equal(parseNumberDraft(""), undefined);
  assert.equal(parseNumberDraft("-"), undefined);
  assert.equal(parseNumberDraft("750"), 750);
});

test("admin active order rows render cached address and item composition", async () => {
  const source = await readFile(new URL("../apps/admin/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /function OrderRow\(\{ order, selected, onSelect \}/);
  assert.match(source, /order\.address \|\| "Адрес не указан"/);
  assert.match(source, /order\.items\.map/);
});

test("kitchen keeps a native Telegram link fallback", async () => {
  const source = await readFile(new URL("../apps/kitchen/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(openTelegramLink\(href\)\) event\.preventDefault\(\)/);
});

test("kitchen ready time uses two clear actions and a compact bottom sheet", async () => {
  const source = await readFile(new URL("../apps/kitchen/src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../apps/kitchen/src/styles.css", import.meta.url), "utf8");

  assert.match(source, /Когда будет готов\?/);
  assert.match(source, /<strong>Через…<\/strong><small>5–60 минут<\/small>/);
  assert.match(source, /<strong>Ко времени…<\/strong><small>например 14:45<\/small>/);
  assert.match(source, /timePicker === "minutes"/);
  assert.match(source, /createPortal\(/);
  assert.match(source, /className="ready-time-sheet"/);
  assert.match(source, /className="ready-time-list"/);
  assert.match(source, /readyTimeOptions\(\)/);
  assert.match(source, /setMinutes\(Math\.floor\(first\.getMinutes\(\) \/ 5\) \* 5 \+ 5/);
  assert.match(source, /Заказ нужен как можно скорее/);
  assert.doesNotMatch(source, /<small>Кухня<\/small>/);
  assert.match(source, /onEstimateReady\(order, undefined, option\.at\)/);
  assert.match(styles, /\.ready-time-backdrop/);
  assert.match(styles, /\.ready-time-sheet/);
  assert.match(styles, /\.ready-time-list/);
});

test("ASAP delivery never exposes the internal capacity slot as a kitchen promise", async () => {
  const client = await readFile(new URL("../apps/client/src/App.tsx", import.meta.url), "utf8");
  const kitchen = await readFile(new URL("../apps/kitchen/src/App.tsx", import.meta.url), "utf8");

  assert.match(client, /Сразу передадим заказ кухне/);
  assert.match(client, /Заказ сразу передан кухне/);
  assert.match(client, /Сейчас на кухне очередь/);
  assert.match(client, /deliverySlots\?\.asap\?\.queue_delay_minutes/);
  assert.match(client, /calculation\.delivery_queue_delay_minutes/);
  assert.match(client, /Ожидание увеличится примерно на/);
  assert.match(client, /order\.delivery_time_mode === "SCHEDULED" && \(order\.delivery_requested_at \|\| order\.delivery_target_at\)/);
  assert.doesNotMatch(client, /deliverySlots\.asap\.wait_minutes/);
  assert.match(kitchen, /order\.delivery_time_mode === "SCHEDULED"/);
  assert.match(kitchen, /Приоритет/);
  assert.match(kitchen, /как можно скорее/);
});

test("checkout readiness includes required delivery address before enabling submit", async () => {
  const source = await readFile(new URL("../apps/client/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /const addressReady = !deliverySelected \|\| Boolean\(draft\.street\.trim\(\) && draft\.houseNumber\.trim\(\)\)/);
  assert.match(source, /disabled=\{!canSubmit\}/);
});

test("checkout summary prefers the current server calculation snapshot", async () => {
  const source = await readFile(new URL("../apps/client/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /calculation\?\.items\.length/);
  assert.match(source, /line_total_minor/);
});

test("checkout keeps all compact sections in one vertical flow", async () => {
  const source = await readFile(new URL("../apps/client/src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../apps/client/src/styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(source, /checkoutStep|setCheckoutStep/);
  assert.doesNotMatch(source, /className="checkout-progress"/);
  assert.doesNotMatch(source, /className="checkout-step-summary"/);
  assert.equal(source.match(/checkout-section[^\"]*checkout-stage/g)?.length, 3);
  assert.match(styles, /\.checkout-stage-title/);
  assert.doesNotMatch(styles, /\.checkout-progress/);
  assert.doesNotMatch(styles, /\.checkout-step-summary/);
});

test("admin home ready queue matches the combined ready filter", async () => {
  const source = await readFile(new URL("../apps/admin/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /<span>Готово<\/span>/);
  assert.match(source, /Доставка \{dashboard\.out_for_delivery\} · Самовывоз \{dashboard\.ready_for_pickup\}/);
  assert.doesNotMatch(source, /<span>Самовывоз готов<\/span>/);
});
