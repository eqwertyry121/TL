// Run after a DEV client build with VITE_API_BASE_URL=https://city-test.invalid.
// All API calls are intercepted; this test never creates restaurant orders.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const output = "test-results/city-location";
await mkdir(output, { recursive: true });
try {
  for (const mode of ["success", "denied", "inaccurate", "outside", "unavailable", "timeout", "network", "denied-retry", "denied-en", "denied-sr", "denied-no-settings", "denied-settings-error", "denied-tablet", "denied-resume", "denied-close"]) {
    const locale = mode === "denied-en" ? "en" : mode === "denied-sr" ? "sr" : "ru";
    const page = await browser.newPage({ viewport: { width: mode === "denied-retry" ? 320 : mode === "denied-tablet" ? 768 : 360, height: 800 } });
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
      window.settingsOpens = 0;
      const handlers = new Map();
      window.emitTelegram = (event) => [...(handlers.get(event) || [])].forEach((fn) => fn());
      window.Telegram = { WebApp: {
        onEvent(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); },
        offEvent(event, fn) { handlers.get(event)?.delete(fn); },
        initData: "ui-test", platform: "android", ready() {}, expand() {},
        initDataUnsafe: { user: { id: 1048084234, language_code: locale } },
        openTelegramLink() { window.botOpens++; },
        LocationManager: { isInited: true, isAccessRequested: true, isAccessGranted: false, isLocationAvailable: mode !== "unavailable",
          openSettings: mode === "denied-no-settings" ? undefined : function () {
            if (mode === "denied-settings-error") throw new Error("unsupported settings");
            window.settingsOpens++;
          }, init(cb) { cb(); }, getLocation(cb) {
          window.nativeCalls++;
          if (mode === "timeout") return;
          const denied = mode.startsWith("denied") && !this.isAccessGranted;
          setTimeout(() => cb(denied ? null : { latitude: 45.25, longitude: 19.84, horizontal_accuracy: 10 }), 50);
        } },
      } };
      localStorage.setItem("tk-client-cart-v1", JSON.stringify({ version: 1, lines: { "dish-test": { itemId: "dish-test", title: "Хачапури", unitPriceMinor: 100000, quantity: 1, menuVersion: 1, updatedAt: future } } }));
    }, { mode, future, locale });
    await page.goto("http://127.0.0.1:4183/#/checkout");
    const button = page.locator("[data-location-confirm]");
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
      const permissionFailure = mode.startsWith("denied");
      const fallback = page.getByRole("button", { name: locale === "en" ? "Confirm through the bot" : locale === "sr" ? "Potvrdi preko bota" : "Подтвердить через бота" });
      if (!permissionFailure) {
        await fallback.waitFor();
        assert.equal(await page.locator(".city-permission-dialog").count(), 0);
      } else {
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        assert.equal(await fallback.count(), 0);
        assert.equal(await dialog.locator("img, video, .city-guide-stage").count(), 0);
        assert.equal(await dialog.locator("button").count(), 2, "one action plus close");
        assert.equal(await page.evaluate(() => window.settingsOpens), 0, "never open settings on mount");
        assert.equal(await page.evaluate(() => window.nativeCalls), 1);
        const allow = dialog.locator(".city-permission-allow");
        await dialog.screenshot({ path: `${output}/${mode}-permission.png` });
        assert.equal(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), true);
        const bounds = await allow.boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 800, "action must fit the viewport");
        await allow.click();
        assert.equal(nativePosts, 0, "settings permission is not city verification");
        if (mode === "denied-no-settings") {
          await page.waitForFunction(() => window.nativeCalls === 2);
          await page.getByRole("dialog").waitFor();
          assert.equal(await page.evaluate(() => window.settingsOpens), 0);
        } else if (mode === "denied-settings-error") {
          await dialog.getByText(/Telegram не подтвердил/).waitFor();
          assert.equal(await allow.isEnabled(), true);
          assert.equal(await page.evaluate(() => window.settingsOpens), 0);
        } else {
          assert.equal(await page.evaluate(() => window.settingsOpens), 1);
          assert.equal(await allow.isDisabled(), true);
          if (mode === "denied-retry" || mode === "denied-resume") {
            await page.evaluate((mode) => {
              window.Telegram.WebApp.LocationManager.isAccessGranted = true;
              if (mode === "denied-resume") window.dispatchEvent(new Event("focus"));
              else {
                window.emitTelegram("locationManagerUpdated");
                window.emitTelegram("locationManagerUpdated");
                window.emitTelegram("activated");
              }
            }, mode);
            await page.locator(".cash-location").waitFor({ state: "detached" });
            assert.equal(await dialog.count(), 0);
            assert.equal(nativePosts, 1);
            assert.equal(await page.evaluate(() => window.nativeCalls), 2, "one automatic retry only");
          } else {
            await dialog.locator(".city-permission-close").click();
            await dialog.waitFor({ state: "detached" });
            assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
            if (mode === "denied-close") {
              await page.evaluate(() => {
                window.Telegram.WebApp.LocationManager.isAccessGranted = true;
                window.emitTelegram("locationManagerUpdated");
                window.dispatchEvent(new Event("focus"));
              });
              await page.waitForTimeout(650);
              assert.equal(nativePosts, 0, "closed flow must not resume");
              assert.equal(await page.evaluate(() => window.nativeCalls), 1);
            }
          }
        }
      }
      assert.equal(await page.evaluate(() => window.botOpens), 0);
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
