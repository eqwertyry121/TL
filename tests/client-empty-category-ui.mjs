// Run against the isolated local API and client Vite server.
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const api = "http://127.0.0.1:18082";
const authResponse = await fetch(`${api}/api/v1/dev/session`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ telegram_user_id: 1048084234, role: "CLIENT", first_name: "Test", language_code: "ru" }),
});
assert.equal(authResponse.status, 200);
const auth = await authResponse.json();
const emptyCategory = { id: "90000000-0000-0000-0000-000000000001", title: "Пустая категория", sort_order: 999, items: null };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, locale: "ru-RU" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) => route.abort());
  await page.route(`${api}/api/v1/bootstrap/**`, (route) => route.fulfill({ status: 404, json: {}, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route(`${api}/api/v1/auth/telegram`, (route) => route.fulfill({ json: auth, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route(`${api}/api/v1/menu**`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.categories.push(emptyCategory);
    await route.fulfill({ response, json: body, headers: { ...response.headers(), "Access-Control-Allow-Origin": "*" } });
  });
  await page.addInitScript((empty) => {
    localStorage.setItem("tk-client-locale", "ru");
    if (!localStorage.getItem("tk.menu.v2.ru")) {
      localStorage.setItem("tk.menu.v2.ru", JSON.stringify({ version: 2, locale: "ru", menu_revision: 1, categories: [empty], savedAt: new Date().toISOString() }));
    }
    window.Telegram = { WebApp: { initData: "local-ui-test", platform: "android", ready() {}, expand() {}, onEvent() {}, offEvent() {}, initDataUnsafe: { user: { id: 1048084234, language_code: "ru" } } } };
  }, emptyCategory);
  await page.goto("http://127.0.0.1:5173/main/");
  await page.locator(".dish-card").first().waitFor();
  assert.equal(await page.getByText("Приложение не загрузилось").count(), 0);
  await page.reload();
  await page.locator(".dish-card").first().waitFor();
  assert.equal(await page.getByText("Приложение не загрузилось").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Client opens with null items in both cached and fresh menu data; real dishes remain visible after reload.");
} finally { await browser.close(); }
