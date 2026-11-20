// Run against the isolated local API and the two Vite servers. Telegram auth is
// substituted with local dev sessions; all reservation operations use PostgreSQL.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const api = "http://127.0.0.1:18082";
const output = "test-results/reservation-locations";
await mkdir(output, { recursive: true });

async function session(telegramID, role = "CLIENT") {
  const response = await fetch(`${api}/api/v1/dev/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_user_id: telegramID, role, username: `uitest${telegramID}`, first_name: "Test", language_code: "ru" }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function prepare(page, telegramID) {
  const auth = await session(telegramID);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) => route.abort());
  await page.route(`${api}/api/v1/bootstrap/**`, (route) => route.fulfill({ status: 404, json: {}, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route(`${api}/api/v1/auth/telegram`, (route) => route.fulfill({ json: auth, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.addInitScript(({ telegramID }) => {
    window.Telegram = { WebApp: { initData: "local-ui-test", platform: "android", ready() {}, expand() {}, onEvent() {}, offEvent() {}, initDataUnsafe: { user: { id: telegramID, language_code: "ru" } } } };
  }, { telegramID });
  return auth.session.token;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const clientToken = await prepare(page, 1048084234);
  const previous = await fetch(`${api}/api/v1/reservations/mine?precision=15`, { headers: { Authorization: `Bearer ${clientToken}` } }).then((response) => response.json());
  if (previous.reservation) {
    const cancelled = await fetch(`${api}/api/v1/reservations/${previous.reservation.id}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${clientToken}`, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(cancelled.status, 200);
  }
  await page.goto("http://127.0.0.1:5173/#/booking");
  await page.getByText("Выберите точку", { exact: true }).first().waitFor();
  assert.match(await page.locator(".booking-location-options").innerText(), /Koste Abraševića 49/);
  assert.match(await page.locator(".booking-location-options").innerText(), /Temerinska 44/);
  await page.getByRole("radio", { name: /Подбара/ }).click();
  await page.locator(".booking-guest-select").selectOption("21");
  await page.locator(".booking-hours button").first().click();
  await page.screenshot({ path: `${output}/client-360.png`, fullPage: true });
  const creation = page.waitForResponse((response) => response.url().endsWith("/api/v1/reservations") && response.request().method() === "POST");
  await page.getByRole("button", { name: "ЗАБРОНИРОВАТЬ", exact: true }).click();
  const createdResponse = await creation;
  assert.equal(createdResponse.status(), 201);
  const created = await createdResponse.json();
  await page.getByText("Бронь подтверждена", { exact: true }).waitFor();
  assert.match(await page.locator(".booking-active-card").innerText(), /Подбара.*Temerinska 44/s);
  assert.match(await page.locator(".booking-active-card").innerText(), /21 гость/);
  await page.reload();
  await page.getByText("Бронь подтверждена", { exact: true }).waitFor();
  const forbidden = await fetch(`${api}/api/v1/admin/reservation-locations/podbara`, {
    method: "PUT", headers: { Authorization: `Bearer ${clientToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ is_open: false }),
  });
  assert.equal(forbidden.status, 403, "client must not be able to close a location");

  const admin = await context.newPage();
  admin.on("pageerror", (err) => errors.push(err.message));
  await prepare(admin, 1048084234);
  await admin.goto("http://127.0.0.1:5176/#/reservations");
  await admin.getByRole("heading", { name: "Приём брони" }).waitFor();
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const dayOffset = Math.round((Date.parse(`${created.date}T12:00:00Z`) - Date.parse(`${localToday}T12:00:00Z`)) / 86400000);
  await admin.locator(".reservation-day-select summary").click();
  await admin.locator(".reservation-day-option").nth(dayOffset).click();
  await admin.locator(".reservation-admin-row").filter({ hasText: "21 гость · Подбара" }).waitFor();
  const podbara = admin.locator(".reservation-location-row").filter({ hasText: "Подбара" });
  await podbara.getByRole("button", { name: "Закрыть", exact: true }).click();
  await podbara.getByText("Бронирование закрыто", { exact: true }).waitFor();
  await admin.reload();
  await admin.locator(".reservation-location-row").filter({ hasText: "Подбара" }).getByText("Бронирование закрыто", { exact: true }).waitFor();
  if (dayOffset > 0) {
    await admin.locator(".reservation-day-select summary").click();
    await admin.locator(".reservation-day-option").nth(dayOffset).click();
  }
  const listed = await fetch(`${api}/api/v1/reservations/mine?precision=15`, { headers: { Authorization: `Bearer ${clientToken}` } }).then((response) => response.json());
  assert.equal(listed.reservation.location_code, "podbara");
  const otherPage = await context.newPage();
  const otherToken = await prepare(otherPage, 1048084235);
  await otherPage.goto("http://127.0.0.1:5173/#/booking");
  const closedOption = otherPage.getByRole("radio", { name: /Подбара/ });
  await closedOption.waitFor();
  assert.equal(await closedOption.isDisabled(), true);
  assert.equal(await otherPage.getByRole("radio", { name: /Телеп/ }).isEnabled(), true);
  const closedRequest = await fetch(`${api}/api/v1/reservations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ location_code: "podbara", date: created.date, start_minute: created.start_minute, guests: 1, locale: "ru" }),
  });
  assert.equal(closedRequest.status, 409);
  assert.equal((await closedRequest.json()).error.code, "RESERVATION_LOCATION_CLOSED");
  await admin.screenshot({ path: `${output}/admin-360.png`, fullPage: true });
  await admin.locator(".reservation-location-row").filter({ hasText: "Подбара" }).getByRole("button", { name: "Открыть", exact: true }).click();
  await admin.locator(".reservation-location-row").filter({ hasText: "Подбара" }).getByText("Бронирование открыто", { exact: true }).waitFor();
  await admin.locator(".reservation-admin-row").filter({ hasText: "21 гость · Подбара" }).getByRole("button", { name: "Освободить" }).click();
  await admin.getByRole("button", { name: "Отменить бронь", exact: true }).click();
  await admin.locator(".reservation-admin-row").filter({ hasText: "21 гость · Подбара" }).waitFor({ state: "detached" });
  await page.reload();
  await page.getByText("Выберите точку", { exact: true }).first().waitFor();

  await otherPage.reload();
  await otherPage.getByRole("radio", { name: /Телеп/ }).click();
  await otherPage.locator(".booking-hours button").first().waitFor();
  assert.equal(await otherPage.locator(".booking-guest-options [role=radio]").count(), 5);
  await otherPage.setViewportSize({ width: 320, height: 760 });
  assert.equal(await otherPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "320 px client overflows horizontally");
  await otherPage.screenshot({ path: `${output}/client-320.png`, fullPage: true });
  for (const [locale, heading] of [["en", "Choose a location"], ["sr", "Izaberite lokaciju"]]) {
    await otherPage.evaluate((value) => localStorage.setItem("tk-client-locale", value), locale);
    await otherPage.reload();
    await otherPage.getByText(heading, { exact: true }).first().waitFor();
    await otherPage.getByRole("radio", { name: /Podbara/ }).click();
    await otherPage.waitForFunction(() => document.querySelectorAll(".booking-guest-select option").length === 21);
  }
  assert.deepEqual(errors, []);
  console.log("Reservation UI passed against isolated PostgreSQL: create 21, reload, close/reopen, existing booking and Telep independence.");
} finally {
  await browser.close();
}
