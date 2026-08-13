import { fileURLToPath } from "node:url";

import { validateExternalSmokeEnv } from "./external-smoke.mjs";

const defaultOrigin = "https://takolako.site";
const defaultForeignOrigin = "https://evil.example";
const defaultEndpoint = "/api/v1/bootstrap/client";
const defaultMethod = "POST";
const defaultHeaders = ["Authorization", "Content-Type", "Idempotency-Key", "If-None-Match"];

if (isMain()) {
  const validationMessage = validateCORSContractEnv(process.env);
  if (validationMessage) {
    console.error(validationMessage);
    process.exit(2);
  }

  const results = await inspectCORSContract({
    baseURL: process.env.PERF_BASE_URL,
    origin: process.env.PERF_CORS_ORIGIN || defaultOrigin,
    foreignOrigin: process.env.PERF_CORS_FOREIGN_ORIGIN || defaultForeignOrigin,
    endpoint: process.env.PERF_CORS_ENDPOINT || defaultEndpoint,
    method: process.env.PERF_CORS_METHOD || defaultMethod,
    requestedHeaders: parseHeaderList(process.env.PERF_CORS_HEADERS || defaultHeaders.join(",")),
    fetchImpl: fetch,
  });

  for (const result of results) {
    console.log(JSON.stringify(result));
  }

  if (results.some((result) => !result.ok)) {
    console.error("CORS contract check failed. Keep exact-origin preflight cache before final release smoke.");
    process.exit(1);
  }
}

export function validateCORSContractEnv(env) {
  const baseMessage = validateExternalSmokeEnv(env);
  if (baseMessage) return baseMessage;
  for (const [key, fallback] of [
    ["PERF_CORS_ORIGIN", defaultOrigin],
    ["PERF_CORS_FOREIGN_ORIGIN", defaultForeignOrigin],
  ]) {
    const value = env[key] || fallback;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return `${key} must use http or https: ${value}`;
      }
    } catch {
      return `${key} must be a valid URL: ${value}`;
    }
  }
  return "";
}

export async function inspectCORSContract({
  baseURL,
  origin = defaultOrigin,
  foreignOrigin = defaultForeignOrigin,
  endpoint = defaultEndpoint,
  method = defaultMethod,
  requestedHeaders = defaultHeaders,
  fetchImpl = fetch,
}) {
  const allowed = await inspectPreflight({
    baseURL,
    endpoint,
    origin,
    method,
    requestedHeaders,
    fetchImpl,
    mode: "allowed-preflight",
  });
  const foreign = await inspectPreflight({
    baseURL,
    endpoint,
    origin: foreignOrigin,
    method,
    requestedHeaders,
    fetchImpl,
    mode: "foreign-preflight",
  });
  validateAllowedPreflight(allowed, { origin, method, requestedHeaders });
  validateForeignPreflight(foreign);
  return [allowed, foreign];
}

export async function inspectPreflight({ baseURL, endpoint, origin, method, requestedHeaders, fetchImpl, mode }) {
  const url = new URL(endpoint, baseURL).toString();
  const result = {
    endpoint,
    phase: mode,
    ok: true,
    status: 0,
    origin,
    allow_origin: "",
    allow_methods: "",
    allow_headers: "",
    expose_headers: "",
    max_age: "",
    vary: "",
    reasons: [],
  };

  let response;
  try {
    response = await fetchImpl(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": requestedHeaders.join(","),
      },
      redirect: "manual",
    });
  } catch (error) {
    result.ok = false;
    result.reasons.push(`request_failed:${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  result.status = response.status;
  result.allow_origin = headerValue(response.headers, "access-control-allow-origin");
  result.allow_methods = headerValue(response.headers, "access-control-allow-methods");
  result.allow_headers = headerValue(response.headers, "access-control-allow-headers");
  result.expose_headers = headerValue(response.headers, "access-control-expose-headers");
  result.max_age = headerValue(response.headers, "access-control-max-age");
  result.vary = headerValue(response.headers, "vary");
  return result;
}

function validateAllowedPreflight(result, { origin, method, requestedHeaders }) {
  if (result.status !== 204) result.reasons.push(`status_${result.status}`);
  if (result.allow_origin !== origin) result.reasons.push("missing_exact_allow_origin");
  if (result.allow_origin === "*") result.reasons.push("wildcard_allow_origin");
  if (!headerListIncludes(result.allow_methods, method)) result.reasons.push(`missing_method_${method}`);
  for (const header of requestedHeaders) {
    if (!headerListIncludes(result.allow_headers, header)) {
      result.reasons.push(`missing_header_${header}`);
    }
  }
  if (!headerListIncludes(result.expose_headers, "ETag")) result.reasons.push("missing_expose_ETag");
  if (!headerListIncludes(result.expose_headers, "Server-Timing")) result.reasons.push("missing_expose_Server-Timing");
  if (!headerListIncludes(result.vary, "Origin")) result.reasons.push("missing_vary_origin");
  const maxAge = Number.parseInt(result.max_age, 10);
  if (!Number.isFinite(maxAge) || maxAge < 600) result.reasons.push("max_age_below_600");
  result.ok = result.reasons.length === 0;
}

function validateForeignPreflight(result) {
  if (result.status < 400) result.reasons.push(`status_${result.status}`);
  if (result.allow_origin !== "") result.reasons.push("foreign_origin_allowed");
  if (result.allow_origin === "*") result.reasons.push("wildcard_allow_origin");
  if (result.allow_headers !== "") result.reasons.push("foreign_headers_allowed");
  result.ok = result.reasons.length === 0;
}

function parseHeaderList(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function headerListIncludes(value, expected) {
  const expectedLower = expected.toLowerCase();
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(expectedLower);
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
