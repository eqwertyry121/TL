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

test("kitchen ready time uses one exact-time action and a compact bottom sheet", async () => {
  const source = await readFile(new URL("../apps/kitchen/src/App.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../apps/kitchen/src/styles.css", import.meta.url), "utf8");

  assert.match(source, /Когда будет готов\?/);
  assert.match(source, /Назначить время/);
  assert.match(source, /К какому времени будет готов\?/);
  assert.doesNotMatch(source, /<strong>Через…<\/strong>/);
  assert.doesNotMatch(source, /Другое время/);
  assert.match(source, /createPortal\(/);
  assert.match(source, /className="ready-time-sheet"/);
  assert.match(source, /className="ready-time-list"/);
  assert.match(source, /readyTimeOptions\(\)/);
  assert.match(source, /setMinutes\(Math\.floor\(first\.getMinutes\(\) \/ 5\) \* 5 \+ 5/);
  assert.match(source, /kitchen_queue_position/);
  assert.doesNotMatch(source, /<small>Кухня<\/small>/);
  assert.match(source, /onEstimateReady\(order, undefined, option\.at\)/);
  assert.match(styles, /\.ready-time-backdrop/);
  assert.match(styles, /\.ready-time-sheet/);
  assert.match(styles, /\.ready-time-list/);
});

test("delivery shows only queue position until the kitchen sets a ready time", async () => {
  const client = await readFile(new URL("../apps/client/src/App.tsx", import.meta.url), "utf8");
  const kitchen = await readFile(new URL("../apps/kitchen/src/App.tsx", import.meta.url), "utf8");

  assert.match(client, /Заказ сразу передан кухне/);
  assert.match(client, /deliverySlots\?\.asap\?\.queue_position/);
  assert.match(client, /order\.kitchen_queue_position/);
  assert.match(client, /Ваш заказ/);
  assert.doesNotMatch(client, /Ожидание увеличится примерно на/);
  assert.doesNotMatch(client, /Желаемая доставка/);
  assert.doesNotMatch(client, /deliverySlots\.asap\.wait_minutes/);
  assert.match(kitchen, /Очередь/);
  assert.match(kitchen, /order\.kitchen_queue_position/);
  assert.doesNotMatch(kitchen, /Очередь \+\{order\.delivery_queue_delay_minutes\}/);
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
