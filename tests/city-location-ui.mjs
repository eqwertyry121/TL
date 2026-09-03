// Run after a DEV client build with VITE_API_BASE_URL=https://city-test.invalid.
// All API calls are intercepted; this test never creates restaurant orders.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const output = "test-results/city-location";
await mkdir(output, { recursive: true });
try {
  for (const mode of ["success", "denied", "inaccurate", "outside", "unavailable", "timeout", "network", "denied-retry", "denied-en", "denied-sr"]) {
    const locale = mode === "denied-en" ? "en" : mode === "denied-sr" ? "sr" : "ru";
    const page = await browser.newPage({ viewport: { width: mode === "denied-retry" ? 320 : 360, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let cityVerifiedAt;
    let nativePosts = 0;
    const future = new Date(Date.now() + 3600000).toISOString();
    const contact = () => ({ verified: true, masked: "*******1222", phone: "+38160111222", city_verification_enabled: true, city_verified_at: cityVerifiedAt });
    const item = { id: "dish-test", category_id: "category-test", title: "Хачапури", description: "Сыр", price_minor: 100000, version: 1, min_quantity: 1, max_quantity: 20 };
    const categories = [{ id: "category-test", title: "Хачапури", items: [item] }];
    const runtime = { accepting_orders: true, reason: "open", timezone: "Europe/Belgrade", enabled_payments: ["cash"], currency: "RSD", cash_location_required: true, cash_location_radius_meters: 12000, pickup_enabled: true, supported_locales: ["ru", "sr", "en"], terms_url: "", delivery_timing_enabled: false };
    const challenge = () => ({ id: "location-test", status: cityVerifiedAt ? "VERIFIED" : "PENDING", verified_at: cityVerifiedAt, expires_at: future, bot_url: "https://t.me/TakoLako_main_bot" });
    await page.route("**/telegram-web-app.js", (route) => route.fulfill({ body: "", contentType: "application/javascript" }));
    await page.route("**/api/v1/**", async (route) => {
      assert.equal(new URL(route.request().url()).hostname, "city-test.invalid");
      const path = new URL(route.request().url()).pathname;
      let payload = {};
      if (path === "/api/v1/bootstrap/client") payload = { runtime, categories, orders: [], contact: contact(), session: { token: "ui-test-token", telegram_user_id: 1048084234, active_role: "CLIENT", expires_at: future } };
      else if (path === "/api/v1/runtime") payload = runtime;
      else if (path === "/api/v1/menu") payload = { categories };
      else if (path === "/api/v1/contact") payload = contact();
      else if (path === "/api/v1/orders") payload = { orders: [], limit: 20, offset: 0, has_more: false };
      else if (path === "/api/v1/orders/calculate") payload = { calculation_token: "calc-test", items: [{ item_id: item.id, title: item.title, unit_price_minor: 100000, quantity: 1, line_total_minor: 100000 }], subtotal_minor: 100000, total_minor: 100000, delivery_fee_minor: 0, expires_at: future, currency: "RSD", fulfillment_type: "delivery" };
      else if (path.endsWith("/telegram-webapp-location")) {
        nativePosts++;
        if (mode === "network") { await route.abort(); return; }
        if (mode === "inaccurate" || mode === "outside") {
          payload = { ...challenge(), status: "REJECTED", rejection_reason: mode === "outside" ? "OUTSIDE_CASH_AREA" : "LOCATION_INACCURATE" };
        } else {
          cityVerifiedAt = new Date().toISOString();
          payload = challenge();
        }
      } else if (path.includes("/cash-location/challenges")) payload = challenge();
      await route.fulfill({ json: payload });
    });
    await page.addInitScript(({ mode, future, locale }) => {
      window.nativeCalls = 0;
      window.botOpens = 0;
      window.Telegram = { WebApp: {
        initData: "ui-test", platform: "android", ready() {}, expand() {},
        initDataUnsafe: { user: { id: 1048084234, language_code: locale } },
        openTelegramLink() { window.botOpens++; },
        LocationManager: { isInited: true, isLocationAvailable: mode !== "unavailable", init(cb) { cb(); }, getLocation(cb) {
          window.nativeCalls++;
          if (mode === "timeout") return;
          const denied = mode.startsWith("denied") && (mode !== "denied-retry" || window.nativeCalls === 1);
          setTimeout(() => cb(denied ? null : { latitude: 45.25, longitude: 19.84, horizontal_accuracy: 10 }), 50);
        } },
      } };
      localStorage.setItem("tk-client-cart-v1", JSON.stringify({ version: 1, lines: { "dish-test": { itemId: "dish-test", title: "Хачапури", unitPriceMinor: 100000, quantity: 1, menuVersion: 1, updatedAt: future } } }));
    }, { mode, future, locale });
    await page.goto("http://127.0.0.1:4183/#/checkout");
    const button = page.locator(".cash-location button.primary");
    await button.waitFor();
    assert.match(await button.innerText(), locale === "ru" ? /Подтвердить.*Нови/ : /Novi|Novom/);
    assert.equal(await page.locator("button.contact-share").count(), 0);
    assert.equal(await page.locator(".checkout-phone-confirmed").count(), 1);
    assert.equal(await page.locator(".city-location-help").count(), 0);
    await page.screenshot({ path: `${output}/${mode}-before.png`, fullPage: true });
    await button.click();
    if (mode === "success") {
      await page.locator(".cash-location").waitFor({ state: "detached" });
      assert.equal(nativePosts, 1);
      assert.equal(await page.evaluate(() => window.nativeCalls), 1);
      assert.equal(await page.evaluate(() => window.botOpens), 0);
      await page.reload();
      await page.locator(".checkout-phone-confirmed").waitFor();
      assert.equal(await page.locator(".cash-location").count(), 0);
      assert.equal(await page.evaluate(() => window.nativeCalls), 0);
    } else if (mode === "outside") {
      await page.getByText(/Не удалось подтвердить, что вы в зоне доставки/).waitFor();
      assert.equal(await page.locator(".city-location-help").count(), 0);
      assert.equal(await page.getByRole("button", { name: "Подтвердить через бота" }).count(), 0);
    } else {
      const fallback = page.getByRole("button", { name: locale === "en" ? "Confirm through the bot" : locale === "sr" ? "Potvrdi preko bota" : "Подтвердить через бота" });
      await fallback.waitFor();
      assert.equal(await page.evaluate(() => window.botOpens), 0);
      const permissionFailure = mode.startsWith("denied");
      assert.equal(await page.locator(".city-location-help").count(), permissionFailure ? 1 : 0);
      if (permissionFailure) {
        assert.equal(await page.locator(".city-location-help li").count(), 3);
        assert.match(await page.locator(".city-location-help").innerText(), locale === "en" ? /Return to your checkout/ : locale === "sr" ? /Vratite se na porudžbinu/ : /Вернитесь к заказу/);
        await page.locator(".city-location-help").scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll(".city-location-demo img")].every((img) => img.complete && img.naturalWidth > 0));
        await page.screenshot({ path: `${output}/${mode}-help.png` });
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(await page.locator(".city-location-demo-on").evaluate((el) => getComputedStyle(el).animationName), "none");
        await page.screenshot({ path: `${output}/${mode}-help-static.png` });
      }
      if (mode === "denied-retry") {
        await button.click();
        await page.locator(".cash-location").waitFor({ state: "detached" });
        assert.equal(await page.locator(".city-location-help").count(), 0);
        assert.equal(nativePosts, 1);
      } else if (mode === "denied") {
        await fallback.click();
        await page.waitForFunction(() => window.botOpens === 1);
        assert.equal(nativePosts, 0);
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${mode}-after.png`, fullPage: true });
    await page.close();
    console.log(`${mode}: passed, including contextual help and mobile layout`);
  }
} finally {
  await browser.close();
}
