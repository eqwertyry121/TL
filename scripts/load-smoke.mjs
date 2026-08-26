import { performance } from "node:perf_hooks";

const baseURL = (process.env.PERF_BASE_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const concurrencies = (process.env.PERF_CONCURRENCY || "1,20,100")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const endpoints = (process.env.PERF_ENDPOINTS || "/api/v1/bootstrap/public?locale=ru,/api/v1/menu?locale=ru,/api/v1/runtime")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const timeoutMs = Number.parseInt(process.env.PERF_TIMEOUT_MS || "10000", 10);
const maxP95Ms = Number.parseInt(process.env.PERF_MAX_P95_MS || "500", 10);
const validateETag = process.env.PERF_VALIDATE_ETAG !== "false";
const requireETag = process.env.PERF_REQUIRE_ETAG !== "false";
const validateGzip = process.env.PERF_VALIDATE_GZIP !== "false";
const gzipMinBytes = Number.parseInt(process.env.PERF_GZIP_MIN_BYTES || "1024", 10);
const validateMedia = process.env.PERF_VALIDATE_MEDIA !== "false";
const mediaMenuEndpoint = process.env.PERF_MEDIA_MENU_ENDPOINT || "/api/v1/menu?locale=ru";
const mediaConcurrency = Math.max(1, Number.parseInt(process.env.PERF_MEDIA_CONCURRENCY || "6", 10) || 6);
const checkoutIterations = Number.parseInt(process.env.PERF_CHECKOUT_ITERATIONS || "0", 10);
const checkoutConcurrency = Number.parseInt(process.env.PERF_CHECKOUT_CONCURRENCY || "1", 10);
const checkoutMaxP95Ms = Number.parseInt(process.env.PERF_CHECKOUT_MAX_P95_MS || String(maxP95Ms), 10);
const checkoutItemID = process.env.PERF_CHECKOUT_ITEM_ID || "44444444-4444-4444-4444-444444444001";
const checkoutQuantity = Number.parseInt(process.env.PERF_CHECKOUT_QUANTITY || "1", 10);
const checkoutTelegramUserID = Number.parseInt(process.env.PERF_CHECKOUT_TELEGRAM_USER_ID || "9000000001", 10);

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] || 0;
}

async function request(endpoint, etag = "") {
  const started = performance.now();
  const headers = { Accept: "application/json", "Accept-Encoding": "gzip" };
  if (etag) headers["If-None-Match"] = etag;
  const response = await fetch(`${baseURL}${endpoint}`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  return {
    durationMs: performance.now() - started,
    status: response.status,
    bytes,
    etag: response.headers.get("ETag") || "",
    contentEncoding: response.headers.get("Content-Encoding") || "",
    contentType: response.headers.get("Content-Type") || "",
    serverTimingMs: parseServerTiming(response.headers.get("Server-Timing") || ""),
  };
}

let failed = false;
for (const endpoint of endpoints) {
  let etag = "";
  if (validateETag) {
    const validation = await validateConditionalRequest(endpoint);
    etag = validation.etag;
    failed ||= !validation.ok;
  }
  for (const concurrency of concurrencies) {
    const fresh = await runBatch(endpoint, concurrency, "", "fresh");
    failed = !fresh.ok || failed;
    if (etag) {
      const conditional = await runBatch(endpoint, concurrency, etag, "conditional");
      failed = !conditional.ok || failed;
    }
  }
}
if (validateMedia) {
  const media = await validateMenuMedia();
  failed = !media.ok || failed;
}
if (checkoutIterations > 0) {
  const checkout = await validateCheckoutCalculation();
  failed = !checkout.ok || failed;
}

if (failed) {
  console.error(`Load smoke failed. Base URL: ${baseURL}; p95 budget: ${maxP95Ms} ms.`);
  process.exit(1);
}

async function validateConditionalRequest(endpoint) {
  try {
    const fresh = await request(endpoint);
    const freshOK = fresh.status >= 200 && fresh.status < 300;
    const hasETag = fresh.etag !== "";
    if (!freshOK || (requireETag && !hasETag)) {
      console.log(JSON.stringify({
        endpoint,
        phase: "etag-validation",
        ok: false,
        status: fresh.status,
        etag: fresh.etag,
        reason: freshOK ? "missing_etag" : "fresh_request_failed",
      }));
      return { ok: false, etag: fresh.etag };
    }
    if (!hasETag) {
      console.log(JSON.stringify({
        endpoint,
        phase: "etag-validation",
        ok: true,
        status: fresh.status,
        etag: "",
        skipped_conditional: true,
      }));
      return { ok: true, etag: "" };
    }

    const conditional = await request(endpoint, fresh.etag);
    const ok = conditional.status === 304 && conditional.bytes === 0;
    console.log(JSON.stringify({
      endpoint,
      phase: "etag-validation",
      ok,
      status: conditional.status,
      etag: fresh.etag,
      bytes: conditional.bytes,
    }));
    return { ok, etag: fresh.etag };
  } catch (error) {
    console.log(JSON.stringify({
      endpoint,
      phase: "etag-validation",
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return { ok: false, etag: "" };
  }
}

async function runBatch(endpoint, concurrency, etag, phase) {
  const results = await Promise.allSettled(Array.from({ length: concurrency }, () => request(endpoint, etag)));
  const fulfilled = results.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  const rejected = results.length - fulfilled.length;
  const badStatus = fulfilled.filter((entry) => {
    if (phase === "conditional") return entry.status !== 304 || entry.bytes !== 0;
    return entry.status < 200 || entry.status >= 300;
  }).length;
  const badCompression = phase === "fresh" && validateGzip
    ? fulfilled.filter((entry) => requiresGzip(entry) && !hasGzipEncoding(entry)).length
    : 0;
  const durations = fulfilled.map((entry) => entry.durationMs);
  const p95 = percentile(durations, 95);
  const bytes = fulfilled.reduce((sum, entry) => sum + entry.bytes, 0);
  const serverTimingP95 = serverTimingPercentiles(fulfilled);
  const ok = rejected === 0 && badStatus === 0 && badCompression === 0 && p95 <= maxP95Ms;
  const output = {
    endpoint,
    concurrency,
    phase,
    ok,
    fulfilled: fulfilled.length,
    rejected,
    bad_status: badStatus,
    bad_compression: badCompression,
    p95_ms: Math.round(p95),
    total_bytes: bytes,
  };
  if (Object.keys(serverTimingP95).length > 0) {
    output.server_timing_p95_ms = serverTimingP95;
  }
  console.log(JSON.stringify(output));
  return { ok };
}

function requiresGzip(entry) {
  return entry.status >= 200 &&
    entry.status < 300 &&
    entry.bytes >= gzipMinBytes &&
    entry.contentType.toLowerCase().includes("application/json");
}

function hasGzipEncoding(entry) {
  return entry.contentEncoding
    .toLowerCase()
    .split(",")
    .map((value) => value.trim())
    .includes("gzip");
}

function parseServerTiming(value) {
  const timings = {};
  for (const part of value.split(",")) {
    const segments = part.split(";").map((segment) => segment.trim()).filter(Boolean);
    const name = segments[0];
    if (!name || /[^a-zA-Z0-9_-]/.test(name)) continue;
    const durSegment = segments.find((segment) => segment.toLowerCase().startsWith("dur="));
    if (!durSegment) continue;
    const duration = Number.parseFloat(durSegment.slice(4));
    if (Number.isFinite(duration) && duration >= 0) {
      timings[name] = duration;
    }
  }
  return timings;
}

function serverTimingPercentiles(entries) {
  const byMetric = new Map();
  for (const entry of entries) {
    for (const [name, value] of Object.entries(entry.serverTimingMs || {})) {
      if (!byMetric.has(name)) byMetric.set(name, []);
      byMetric.get(name).push(value);
    }
  }
  const result = {};
  for (const [name, values] of byMetric) {
    result[name] = Math.round(percentile(values, 95) * 10) / 10;
  }
  return result;
}

async function validateMenuMedia() {
  try {
    const response = await fetch(`${baseURL}${mediaMenuEndpoint}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status < 200 || response.status >= 300) {
      console.log(JSON.stringify({
        endpoint: mediaMenuEndpoint,
        phase: "media-validation",
        ok: false,
        status: response.status,
        reason: "menu_request_failed",
      }));
      return { ok: false };
    }
    const payload = await response.json();
    const media = collectMenuMediaURLs(payload);
    if (media.invalid.length > 0) {
      console.log(JSON.stringify({
        endpoint: mediaMenuEndpoint,
        phase: "media-validation",
        ok: false,
        checked: media.urls.length,
        invalid: media.invalid.slice(0, 5),
        reason: "invalid_media_url",
      }));
      return { ok: false };
    }
    if (media.urls.length === 0) {
      console.log(JSON.stringify({
        endpoint: mediaMenuEndpoint,
        phase: "media-validation",
        ok: true,
        checked: 0,
        skipped: true,
      }));
      return { ok: true };
    }
    const results = await mapWithConcurrency(media.urls, mediaConcurrency, validateMediaURL);
    const checked = results.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
    const failedChecks = [
      ...checked.filter((entry) => !entry.ok),
      ...results.filter((entry) => entry.status === "rejected").map((entry) => ({
        ok: false,
        reason: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
      })),
    ];
    const ok = failedChecks.length === 0;
    console.log(JSON.stringify({
      endpoint: mediaMenuEndpoint,
      phase: "media-validation",
      ok,
      checked: media.urls.length,
      failed: failedChecks.length,
      failures: failedChecks.slice(0, 5),
    }));
    return { ok };
  } catch (error) {
    console.log(JSON.stringify({
      endpoint: mediaMenuEndpoint,
      phase: "media-validation",
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return { ok: false };
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await mapper(values[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

async function validateCheckoutCalculation() {
  const sessionResult = await createDevClientSession();
  if (!sessionResult.ok) return { ok: false };
  const concurrency = Math.max(1, Math.min(checkoutConcurrency, checkoutIterations));
  const results = await runLimited(checkoutIterations, concurrency, () => requestCheckoutCalculation(sessionResult.token));
  const fulfilled = results.filter((entry) => entry.status === "fulfilled").map((entry) => entry.value);
  const rejected = results.length - fulfilled.length;
  const badStatus = fulfilled.filter((entry) => entry.status < 200 || entry.status >= 300).length;
  const durations = fulfilled.map((entry) => entry.durationMs);
  const p95 = percentile(durations, 95);
  const bytes = fulfilled.reduce((sum, entry) => sum + entry.bytes, 0);
  const ok = rejected === 0 && badStatus === 0 && p95 <= checkoutMaxP95Ms;
  console.log(JSON.stringify({
    endpoint: "/api/v1/orders/calculate",
    phase: "checkout-calculate",
    ok,
    iterations: checkoutIterations,
    concurrency,
    fulfilled: fulfilled.length,
    rejected,
    bad_status: badStatus,
    p95_ms: Math.round(p95),
    total_bytes: bytes,
  }));
  return { ok };
}

async function createDevClientSession() {
  try {
    const response = await fetch(`${baseURL}/api/v1/dev/session`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        telegram_user_id: checkoutTelegramUserID,
        role: "CLIENT",
        username: "perf_client",
        first_name: "Perf",
        language_code: "ru",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    const token = payload?.session?.token;
    const ok = response.status >= 200 && response.status < 300 && typeof token === "string" && token !== "";
    console.log(JSON.stringify({
      endpoint: "/api/v1/dev/session",
      phase: "checkout-session",
      ok,
      status: response.status,
      reason: ok ? undefined : "missing_dev_session_token",
    }));
    return { ok, token: token || "" };
  } catch (error) {
    console.log(JSON.stringify({
      endpoint: "/api/v1/dev/session",
      phase: "checkout-session",
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
    return { ok: false, token: "" };
  }
}

async function requestCheckoutCalculation(token) {
  const started = performance.now();
  const response = await fetch(`${baseURL}/api/v1/orders/calculate`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ item_id: checkoutItemID, quantity: checkoutQuantity }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  return {
    durationMs: performance.now() - started,
    status: response.status,
    bytes,
  };
}

async function runLimited(count, concurrency, task) {
  const results = new Array(count);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < count) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: "fulfilled", value: await task(index) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(count, concurrency) }, worker));
  return results;
}

function collectMenuMediaURLs(payload) {
  const urls = new Set();
  const invalid = [];
  const categories = Array.isArray(payload?.categories) ? payload.categories : [];
  for (const category of categories) {
    const items = Array.isArray(category?.items) ? category.items : [];
    for (const item of items) {
      addMediaURL(urls, invalid, item?.photo_path);
      const variants = item?.photo_variants && typeof item.photo_variants === "object" ? item.photo_variants : {};
      for (const variant of Object.values(variants)) {
        addMediaURL(urls, invalid, variant?.url);
      }
    }
  }
  return { urls: [...urls], invalid };
}

function addMediaURL(urls, invalid, value) {
  if (typeof value !== "string" || value.trim() === "") return;
  try {
    const url = new URL(value.trim(), `${baseURL}/`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      invalid.push(value);
      return;
    }
    urls.add(url.toString());
  } catch {
    invalid.push(value);
  }
}

async function validateMediaURL(url) {
  const response = await fetch(url, {
    headers: { Accept: "image/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const bytes = (await response.arrayBuffer()).byteLength;
  const contentType = response.headers.get("Content-Type") || "";
  return {
    url: redactBaseURL(url),
    status: response.status,
    content_type: contentType,
    bytes,
    ok: response.status >= 200 && response.status < 300 && contentType.toLowerCase().startsWith("image/") && bytes > 0,
  };
}

function redactBaseURL(url) {
  return url.startsWith(baseURL) ? url.slice(baseURL.length) || "/" : url;
}
