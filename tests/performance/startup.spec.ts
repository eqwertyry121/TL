import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const maxStartupMs = Number.parseInt(process.env.PERF_LAB_MAX_STARTUP_MS || "4000", 10);
const startupRuns = clampInteger(Number.parseInt(process.env.PERF_STARTUP_RUNS || "3", 10), 1, 20);
const releaseStartupSLO = process.env.PERF_RELEASE_STARTUP_SLO === "true";
const startupOutputDir = process.env.PERF_STARTUP_OUTPUT_DIR || "test-results/performance-startup";

const apps = [
  {
    name: "client",
    url: "http://127.0.0.1:4173/main/#/",
    marker: "Tako Lako",
    releaseBudgets: {
      coldP75: 1200,
      coldP95: 2000,
      warmP75: 300,
      warmP95: 1200,
    },
  },
  {
    name: "kitchen",
    url: "http://127.0.0.1:4174/",
    marker: "Кухня",
    releaseBudgets: {
      coldP75: 1000,
      coldP95: 1800,
      warmP75: 1000,
      warmP95: 1800,
    },
  },
  {
    name: "courier",
    url: "http://127.0.0.1:4175/",
    marker: "Курьер",
    releaseBudgets: {
      coldP75: 1000,
      coldP95: 1800,
      warmP75: 1000,
      warmP95: 1800,
    },
  },
  {
    name: "admin",
    url: "http://127.0.0.1:4176/",
    marker: "Главная",
    releaseBudgets: {
      coldP75: 1200,
      coldP95: 2000,
      warmP75: 1200,
      warmP95: 2000,
    },
  },
];

for (const app of apps) {
  test(`${app.name} cold and warm startup p75 render`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    const samples = [];
    for (let run = 0; run < startupRuns; run += 1) {
      await page.context().clearCookies();
      await page.goto(app.url, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });

      const cold = await measureStartup(page, app.url, app.marker);
      const warm = await measureStartup(page, app.url, app.marker);
      samples.push({ run: run + 1, cold, warm });
    }

    const coldVisibleMs = samples.map((sample) => sample.cold.visible_ms);
    const warmVisibleMs = samples.map((sample) => sample.warm.visible_ms);
    const coldP75 = percentile(coldVisibleMs, 75);
    const warmP75 = percentile(warmVisibleMs, 75);
    const coldP95 = percentile(coldVisibleMs, 95);
    const warmP95 = percentile(warmVisibleMs, 95);

    const startupReport = {
      app: app.name,
      runs: startupRuns,
      release_slo_mode: releaseStartupSLO,
      budgets_ms: startupBudgets(app.releaseBudgets),
      samples,
      cold_p75_ms: coldP75,
      warm_p75_ms: warmP75,
      cold_p95_ms: coldP95,
      warm_p95_ms: warmP95,
      consoleErrors,
    };
    const startupReportJSON = JSON.stringify(startupReport, null, 2);
    await persistStartupReport(app.name, startupReportJSON);
    await testInfo.attach(`${app.name}-startup.json`, {
      contentType: "application/json",
      body: Buffer.from(startupReportJSON),
    });

    const budgets = startupBudgets(app.releaseBudgets);
    expect(coldP75, `${app.name} cold marker visible p75`).toBeLessThanOrEqual(budgets.coldP75);
    expect(warmP75, `${app.name} warm marker visible p75`).toBeLessThanOrEqual(budgets.warmP75);
    expect(coldP95, `${app.name} cold marker visible p95`).toBeLessThanOrEqual(budgets.coldP95);
    expect(warmP95, `${app.name} warm marker visible p95`).toBeLessThanOrEqual(budgets.warmP95);
    expect(consoleErrors, `${app.name} console errors`).toEqual([]);
  });
}

async function measureStartup(page: import("@playwright/test").Page, url: string, marker: string) {
  const started = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toContainText(marker, { timeout: maxStartupMs });
  const visibleMs = Date.now() - started;
  const navigation = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return null;
    return {
      dom_content_loaded_ms: Math.round(nav.domContentLoadedEventEnd),
      load_ms: Math.round(nav.loadEventEnd),
      transfer_size: nav.transferSize,
      encoded_body_size: nav.encodedBodySize,
    };
  });
  return { visible_ms: visibleMs, navigation };
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] || 0;
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function startupBudgets(releaseBudgets: {
  coldP75: number;
  coldP95: number;
  warmP75: number;
  warmP95: number;
}) {
  if (releaseStartupSLO) return releaseBudgets;
  return {
    coldP75: maxStartupMs,
    coldP95: maxStartupMs,
    warmP75: maxStartupMs,
    warmP95: maxStartupMs,
  };
}

async function persistStartupReport(appName: string, startupReportJSON: string) {
  await mkdir(startupOutputDir, { recursive: true });
  await writeFile(path.join(startupOutputDir, `${appName}-startup.json`), startupReportJSON);
}
