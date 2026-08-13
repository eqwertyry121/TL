import { fileURLToPath } from "node:url";

import { validateExternalSmokeEnv } from "./external-smoke.mjs";

export const legacyPublicEndpoints = [
  {
    name: "runtime",
    path: "/api/v1/runtime",
    validateBody: validateRuntimeBody,
  },
  {
    name: "menu",
    path: "/api/v1/menu?locale=ru",
    validateBody: validateMenuBody,
  },
];

if (isMain()) {
  const validationMessage = validateLegacyPublicContractEnv(process.env);
  if (validationMessage) {
    console.error(validationMessage);
    process.exit(2);
  }

  const results = await inspectLegacyPublicContract({
    baseURL: process.env.PERF_BASE_URL,
    fetchImpl: fetch,
  });

  for (const result of results) {
    console.log(JSON.stringify(result));
  }

  if (results.some((result) => !result.ok)) {
    console.error("Legacy public contract check failed. Keep old public endpoints compatible until the rolling-deploy fallback is removed.");
    process.exit(1);
  }
}

export function validateLegacyPublicContractEnv(env) {
  return validateExternalSmokeEnv(env);
}

export async function inspectLegacyPublicContract({ baseURL, fetchImpl = fetch, endpoints = legacyPublicEndpoints }) {
  const results = [];
  for (const endpoint of endpoints) {
    results.push(await inspectLegacyEndpoint({ baseURL, endpoint, fetchImpl }));
  }
  return results;
}

export async function inspectLegacyEndpoint({ baseURL, endpoint, fetchImpl }) {
  const url = new URL(endpoint.path, baseURL).toString();
  const result = {
    endpoint: endpoint.path,
    name: endpoint.name,
    ok: true,
    status: 0,
    content_type: "",
    reasons: [],
  };

  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
  } catch (error) {
    result.ok = false;
    result.reasons.push(`request_failed:${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  result.status = response.status;
  result.content_type = headerValue(response.headers, "content-type");

  if (response.status < 200 || response.status >= 300) {
    result.reasons.push(`status_${response.status}`);
  }
  if (!result.content_type.toLowerCase().includes("application/json")) {
    result.reasons.push("missing_json_content_type");
  }

  let body;
  try {
    body = JSON.parse(await response.text());
  } catch {
    result.reasons.push("invalid_json_body");
  }

  if (body !== undefined) {
    result.reasons.push(...endpoint.validateBody(body));
  }

  result.ok = result.reasons.length === 0;
  return result;
}

export function validateRuntimeBody(body) {
  const reasons = [];
  if (!isObject(body)) return ["runtime_not_object"];

  requireString(body, "server_time", reasons);
  requireBoolean(body, "accepting_orders", reasons);
  requireString(body, "reason", reasons);
  requireString(body, "day_off_banner", reasons);
  requireInteger(body, "flat_delivery_fee_minor", reasons);
  requireString(body, "currency", reasons);
  if (!Array.isArray(body.enabled_payments)) reasons.push("runtime_missing_enabled_payments_array");
  if (!Array.isArray(body.supported_locales)) reasons.push("runtime_missing_supported_locales_array");
  requireString(body, "support_text", reasons);
  requireString(body, "terms_url", reasons);
  return reasons;
}

export function validateMenuBody(body) {
  if (!isObject(body)) return ["menu_not_object"];
  if (!Array.isArray(body.categories)) return ["menu_missing_categories_array"];

  const reasons = [];
  for (const [categoryIndex, category] of body.categories.entries()) {
    const prefix = `category_${categoryIndex}`;
    if (!isObject(category)) {
      reasons.push(`${prefix}_not_object`);
      continue;
    }
    requireString(category, "id", reasons, prefix);
    requireString(category, "title", reasons, prefix);
    requireInteger(category, "sort_order", reasons, prefix);
    if (!Array.isArray(category.items)) {
      reasons.push(`${prefix}_missing_items_array`);
      continue;
    }
    for (const [itemIndex, item] of category.items.entries()) {
      const itemPrefix = `${prefix}_item_${itemIndex}`;
      if (!isObject(item)) {
        reasons.push(`${itemPrefix}_not_object`);
        continue;
      }
      requireString(item, "id", reasons, itemPrefix);
      requireString(item, "category_id", reasons, itemPrefix);
      requireString(item, "title", reasons, itemPrefix);
      requireInteger(item, "price_minor", reasons, itemPrefix);
      requireString(item, "currency", reasons, itemPrefix);
      requireString(item, "photo_path", reasons, itemPrefix);
      requireInteger(item, "sort_order", reasons, itemPrefix);
    }
  }
  return reasons;
}

function requireString(body, field, reasons, prefix = "") {
  if (typeof body[field] !== "string") reasons.push(`${prefix ? `${prefix}_` : ""}missing_${field}_string`);
}

function requireBoolean(body, field, reasons, prefix = "") {
  if (typeof body[field] !== "boolean") reasons.push(`${prefix ? `${prefix}_` : ""}missing_${field}_boolean`);
}

function requireInteger(body, field, reasons, prefix = "") {
  if (!Number.isInteger(body[field])) reasons.push(`${prefix ? `${prefix}_` : ""}missing_${field}_integer`);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) return String(value);
  }
  return "";
}

export function isMain(metaURL = import.meta.url, argv = process.argv) {
  return fileURLToPath(metaURL) === argv[1];
}
