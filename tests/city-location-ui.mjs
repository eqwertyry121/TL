// Run after a DEV client build with VITE_API_BASE_URL=https://city-test.invalid.
// All API calls are intercepted; this test never creates restaurant orders.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const output = "test-results/city-location";
await mkdir(output, { recursive: true });
try {
  for (const mode of ["success", "denied"]) {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
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
        cityVerifiedAt = new Date().toISOString();
        payload = challenge();
      } else if (path.includes("/cash-location/challenges")) payload = challenge();
      await route.fulfill({ json: payload });
    });
    await page.addInitScript(({ mode, future }) => {
      window.nativeCalls = 0;
      window.botOpens = 0;
      window.Telegram = { WebApp: {
        initData: "ui-test", platform: "android", ready() {}, expand() {},
        initDataUnsafe: { user: { id: 1048084234, language_code: "ru" } },
        openTelegramLink() { window.botOpens++; },
        LocationManager: { isInited: true, isLocationAvailable: true, init(cb) { cb(); }, getLocation(cb) {
          window.nativeCalls++;
          setTimeout(() => cb(mode === "success" ? { latitude: 45.25, longitude: 19.84, horizontal_accuracy: 10 } : null), 50);
        } },
      } };
      localStorage.setItem("tk-client-cart-v1", JSON.stringify({ version: 1, lines: { "dish-test": { itemId: "dish-test", title: "Хачапури", unitPriceMinor: 100000, quantity: 1, menuVersion: 1, updatedAt: future } } }));
    }, { mode, future });
    await page.goto("http://127.0.0.1:4183/#/checkout");
    const button = page.locator(".cash-location button.primary");
    await button.waitFor();
    assert.match(await button.innerText(), /Подтвердить.*Нови/);
    assert.equal(await page.locator("button.contact-share").count(), 0);
    assert.equal(await page.locator(".checkout-phone-confirmed").count(), 1);
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
    } else {
      const fallback = page.getByRole("button", { name: "Подтвердить через бота" });
      await fallback.waitFor();
      assert.equal(await page.evaluate(() => window.botOpens), 0);
      await fallback.click();
      await page.waitForFunction(() => window.botOpens === 1);
      assert.equal(nativePosts, 0);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${mode}-after.png`, fullPage: true });
    await page.close();
    console.log(`${mode}: passed, including phone hiding and 360px layout`);
  }
} finally {
  await browser.close();
}
