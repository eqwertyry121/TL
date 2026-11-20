// Local API + PostgreSQL; Telegram identity is substituted with a dev session.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const api = "http://127.0.0.1:18082";
const output = "test-results/reservation-management";
await mkdir(output, { recursive: true });

async function session(id, role = "CLIENT") {
  const response = await fetch(`${api}/api/v1/dev/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_user_id: id, role, username: `uitest${id}`, first_name: "Test", language_code: "ru" }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function prepare(page, id) {
  const auth = await session(id);
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) => route.abort());
  await page.route(`${api}/api/v1/bootstrap/**`, (route) => route.fulfill({ status: 404, json: {}, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.route(`${api}/api/v1/auth/telegram`, (route) => route.fulfill({ json: auth, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.addInitScript((telegramID) => {
    window.Telegram = { WebApp: { initData: "local-ui-test", platform: "android", ready() {}, expand() {}, onEvent() {}, offEvent() {}, initDataUnsafe: { user: { id: telegramID, language_code: "ru" } } } };
  }, id);
  return auth.session.token;
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const target = new Date(`${today}T12:00:00Z`);
target.setUTCDate(target.getUTCDate() + 10);
const targetDate = target.toISOString().slice(0, 10);
const weekday = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"][target.getUTCDay()];
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });
  const admin = await context.newPage();
  const errors = [];
  admin.on("pageerror", (error) => errors.push(error.message));
  await prepare(admin, 1048084234);
  await admin.goto("http://127.0.0.1:5176/#/reservations");
  await admin.getByRole("heading", { name: "Приём брони" }).waitFor();
  await admin.locator(".reservation-location-row").filter({ hasText: "Подбара" }).getByRole("button", { name: "Настроить" }).click();
  const settings = admin.getByRole("region", { name: "Настройки точки" });
  await settings.getByLabel("На сколько дней вперёд").fill("20");
  await settings.getByLabel("Длительность брони").selectOption("90");
  await settings.getByLabel("Шаг времени").selectOption("15");
  const schedule = settings.locator(".reservation-schedule-row").filter({ hasText: weekday });
  await schedule.getByLabel(weekday).check();
  await schedule.getByLabel("Первый старт").fill("13:15");
  await schedule.getByLabel("Последний старт").fill("15:15");
  const update = admin.waitForResponse((response) => response.url().endsWith("/admin/reservation-locations/podbara/settings") && response.request().method() === "PUT");
  await settings.getByRole("button", { name: "Сохранить настройки" }).click();
  assert.equal((await update).status(), 200);
  await admin.screenshot({ path: `${output}/settings-360.png`, fullPage: true });
  await settings.getByRole("button", { name: "Готово" }).click();

  await admin.getByLabel("Выбрать дату").fill(targetDate);
  await admin.getByRole("button", { name: "Добавить бронь" }).click();
  const editor = admin.getByRole("region", { name: "Новая бронь" });
  await editor.getByLabel("Имя гостя").fill("Тест ручной брони");
  await editor.getByLabel("Точка").selectOption("podbara");
  await editor.getByLabel("Начало").fill("13:15");
  await editor.getByLabel("Количество гостей").fill("7");
  const create = admin.waitForResponse((response) => response.url().endsWith("/admin/reservations") && response.request().method() === "POST");
  await editor.getByRole("button", { name: "Сохранить бронь" }).click();
  const createdResponse = await create;
  assert.equal(createdResponse.status(), 201);
  const created = await createdResponse.json();
  assert.equal(created.start_minute, 795);
  assert.equal(created.end_minute, 885);
  assert.equal(created.manual, true);
  let row = admin.locator(".reservation-admin-row").filter({ hasText: "Тест ручной брони" });
  await row.getByText("13:15", { exact: true }).waitFor();
  await admin.reload();
  await admin.getByLabel("Выбрать дату").fill(targetDate);
  row = admin.locator(".reservation-admin-row").filter({ hasText: "Тест ручной брони" });
  await row.getByText("13:15", { exact: true }).waitFor();

  await row.getByRole("button", { name: "Изменить" }).click();
  const edit = admin.getByRole("region", { name: "Изменить бронь" });
  await edit.getByLabel("Начало").fill("14:45");
  await edit.getByLabel("Количество гостей").fill("10");
  const move = admin.waitForResponse((response) => response.url().endsWith(`/admin/reservations/${created.id}`) && response.request().method() === "PUT");
  await edit.getByRole("button", { name: "Сохранить бронь" }).click();
  assert.equal((await move).status(), 200);
  await row.getByText("14:45", { exact: true }).waitFor();
  await admin.setViewportSize({ width: 320, height: 760 });
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "320px admin overflows horizontally");
  await admin.screenshot({ path: `${output}/bookings-320.png`, fullPage: true });

  const client = await context.newPage();
  client.on("pageerror", (error) => errors.push(error.message));
  const clientToken = await prepare(client, 1048084288);
  const availability = await fetch(`${api}/api/v1/reservations/availability?location=podbara&guests=21`, { headers: { Authorization: `Bearer ${clientToken}` } }).then((response) => response.json());
  const targetAvailability = availability.days.find((day) => day.date === targetDate);
  assert(targetAvailability.minutes.includes(795), "13:15 should become available after moving the manual reservation");
  assert(!targetAvailability.minutes.includes(810), "13:30 should overlap the moved reservation");
  await client.goto("http://127.0.0.1:5173/#/booking");
  await client.getByRole("radio", { name: /Подбара/ }).click();
  const visibleDays = availability.days.filter((day) => day.minutes.length);
  // Select 21 guests before choosing a date so both API and UI use the same availability.
  await client.locator(".booking-guest-select").selectOption("21");
  await client.locator(".booking-date-list button").nth(visibleDays.findIndex((day) => day.date === targetDate)).click();
  await client.locator(".booking-hours button").getByText("13:15", { exact: true }).waitFor();

  await row.getByRole("button", { name: "Освободить" }).click();
  await admin.getByRole("button", { name: "Отменить бронь", exact: true }).click();
  await row.waitFor({ state: "detached" });
  await admin.reload();
  await admin.getByLabel("Выбрать дату").fill(targetDate);
  assert.equal(await admin.locator(".reservation-admin-row").filter({ hasText: "Тест ручной брони" }).count(), 0);

  // A guest already on the screen must recover when an admin lowers the limit.
  await admin.locator(".reservation-location-row").filter({ hasText: "Подбара" }).getByRole("button", { name: "Настроить" }).click();
  const podbaraSettings = admin.getByRole("region", { name: "Настройки точки" });
  await podbaraSettings.getByLabel("Гостей в одной брони, максимум").fill("1");
  const limitUpdate = admin.waitForResponse((response) => response.url().endsWith("/admin/reservation-locations/podbara/settings") && response.request().method() === "PUT");
  await podbaraSettings.getByRole("button", { name: "Сохранить настройки" }).click();
  assert.equal((await limitUpdate).status(), 200);
  await client.waitForFunction(() => document.querySelectorAll(".booking-guest-options [role=radio]").length === 1, null, { timeout: 20000 });
  await client.locator(".booking-hours button").first().waitFor();
  assert.equal(await client.locator(".booking-guest-options [role=radio]").first().getAttribute("aria-checked"), "true");
  await client.getByRole("radio", { name: /Телеп/ }).click();
  await client.getByRole("radio", { name: /Подбара/ }).click();
  await client.waitForFunction(() => document.querySelectorAll(".booking-guest-options [role=radio]").length === 1);
  await client.locator(".booking-hours button").first().waitFor();
  assert.equal(await client.locator(".booking-guest-options [role=radio]").first().getAttribute("aria-checked"), "true");
  await podbaraSettings.getByRole("button", { name: "Готово" }).click();

  await admin.locator(".reservation-location-row").filter({ hasText: "Телеп" }).getByRole("button", { name: "Настроить" }).click();
  const telep = admin.getByRole("region", { name: "Настройки точки" });
  const tableName = `Тестовый стол ${Date.now()}`;
  const newTable = telep.locator(".reservation-table-row").filter({ has: admin.getByLabel("Новый стол") });
  await newTable.getByLabel("Новый стол").fill(tableName);
  await newTable.getByLabel("Мест", { exact: true }).fill("8");
  const tableCreate = admin.waitForResponse((response) => response.url().endsWith("/admin/reservation-tables") && response.request().method() === "POST");
  await newTable.getByRole("button", { name: "Добавить стол" }).click();
  assert.equal((await tableCreate).status(), 201);
  const table = telep.locator(".reservation-table-row").filter({ has: admin.locator(`input[value="${tableName}"]`) });
  await table.getByLabel("Доступен").uncheck();
  const tableUpdate = admin.waitForResponse((response) => response.url().includes("/admin/reservation-tables/") && response.request().method() === "PUT");
  await table.getByRole("button", { name: "Сохранить стол" }).click();
  assert.equal((await tableUpdate).status(), 200);
  await admin.reload();
  await admin.locator(".reservation-location-row").filter({ hasText: "Телеп" }).getByRole("button", { name: "Настроить" }).click();
  const savedTable = admin.locator(".reservation-table-row").filter({ has: admin.locator(`input[value="${tableName}"]`) });
  assert.equal(await savedTable.getByLabel("Доступен").isChecked(), false);
  assert.deepEqual(errors, []);
  console.log("Reservation management UI passed: settings, live limit changes, 15-minute times, create, reload, move, capacity, cancellation and tables.");
} finally {
  await browser.close();
}
