import { fileURLToPath } from "node:url";

import { validateExternalSmokeEnv } from "./external-smoke.mjs";

export const productionContractEndpoints = [
  {
    name: "version",
    path: "/api/v1/version",
    cacheControlIncludes: ["no-cache"],
    validateVersionBody: true,
  },
  {
    name: "public_bootstrap",
    path: "/api/v1/bootstrap/public?locale=ru",
    cacheControlIncludes: ["public", "max-age=0", "must-revalidate"],
  },
  {
    name: "menu",
    path: "/api/v1/menu?locale=ru",
    cacheControlIncludes: ["public", "max-age=0", "must-revalidate"],
  },
  {
    name: "runtime",
    path: "/api/v1/runtime",
    cacheControlIncludes: ["no-cache"],
  },
];

if (isMain()) {
  const validationMessage = validateProductionContractEnv(process.env);
  if (validationMessage) {
    console.error(validationMessage);
    process.exit(2);
  }

  const results = await inspectProductionContract({
    baseURL: process.env.PERF_BASE_URL,
    fetchImpl: fetch,
    expectedBuildSHA: process.env.PERF_EXPECTED_BUILD_SHA || "",
    allowPlaceholderBuildSHA: process.env.PERF_ALLOW_LOCAL_BASE_URL === "true",
  });

  for (const result of results) {
    console.log(JSON.stringify(result));
  }

  if (results.some((result) => !result.ok)) {
    console.error("Production contract check failed. Deploy the optimized backend before running final release smoke.");
    process.exit(1);
  }
}

export function validateProductionContractEnv(env) {
  return validateExternalSmokeEnv(env);
}

export async function inspectProductionContract({
  baseURL,
  fetchImpl = fetch,
  endpoints = productionContractEndpoints,
  expectedBuildSHA = "",
  allowPlaceholderBuildSHA = false,
}) {
  const results = [];
  for (const endpoint of endpoints) {
    results.push(await inspectEndpoint({
      baseURL,
      endpoint,
      fetchImpl,
      expectedBuildSHA,
      allowPlaceholderBuildSHA,
    }));
  }
  return results;
}

export async function inspectEndpoint({
  baseURL,
  endpoint,
  fetchImpl,
  expectedBuildSHA = "",
  allowPlaceholderBuildSHA = false,
}) {
  const url = new URL(endpoint.path, baseURL).toString();
  const result = {
    endpoint: endpoint.path,
    name: endpoint.name,
    ok: true,
    status: 0,
    etag: "",
    cache_control: "",
    conditional_status: 0,
    reasons: [],
  };

  let fresh;
  try {
    fresh = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
  } catch (error) {
    result.ok = false;
    result.reasons.push(`fresh_request_failed:${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  result.status = fresh.status;
  result.etag = headerValue(fresh.headers, "etag");
  result.cache_control = headerValue(fresh.headers, "cache-control");
  const contentType = headerValue(fresh.headers, "content-type");

  if (fresh.status < 200 || fresh.status >= 300) {
    result.reasons.push(`fresh_status_${fresh.status}`);
  }
  if (!contentType.toLowerCase().includes("application/json")) {
    result.reasons.push("missing_json_content_type");
  }
  if (!result.etag) {
    result.reasons.push("missing_etag");
  }
  for (const token of endpoint.cacheControlIncludes || []) {
    if (!result.cache_control.toLowerCase().includes(token)) {
      result.reasons.push(`missing_cache_control_${token}`);
    }
  }

  if (endpoint.validateVersionBody && fresh.status >= 200 && fresh.status < 300) {
    await inspectVersionBody({
      response: fresh,
      result,
      expectedBuildSHA,
      allowPlaceholderBuildSHA,
    });
  }

  if (result.etag && fresh.status >= 200 && fresh.status < 300) {
    await inspectConditional({ url, etag: result.etag, fetchImpl, result });
  }

  result.ok = result.reasons.length === 0;
  return result;
}

async function inspectConditional({ url, etag, fetchImpl, result }) {
  let conditional;
  try {
    conditional = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "If-None-Match": etag,
      },
      redirect: "manual",
    });
  } catch (error) {
    result.reasons.push(`conditional_request_failed:${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  result.conditional_status = conditional.status;
  if (conditional.status !== 304) {
    result.reasons.push(`conditional_status_${conditional.status}`);
    return;
  }

  const body = await safeText(conditional);
  if (body.length > 0) {
    result.reasons.push("conditional_body_not_empty");
  }
}

async function inspectVersionBody({ response, result, expectedBuildSHA, allowPlaceholderBuildSHA }) {
  let payload;
  try {
    payload = JSON.parse(await safeText(response));
  } catch (error) {
    result.reasons.push(`invalid_version_json:${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const service = stringField(payload, "service");
  const buildSHA = stringField(payload, "build_sha");
  const apiContract = stringField(payload, "api_contract");
  const expected = normalizeBuildSHA(expectedBuildSHA);

  result.build_sha = buildSHA;
  result.api_contract = apiContract;
  if (expected) result.expected_build_sha = expected;

  if (service !== "tk-delivery") {
    result.reasons.push(service ? "unexpected_version_service" : "missing_version_service");
  }
  if (!buildSHA) {
    result.reasons.push("missing_build_sha");
  } else if (!allowPlaceholderBuildSHA && (buildSHA === "dev" || buildSHA === "unknown")) {
    result.reasons.push("placeholder_build_sha");
  }
  if (apiContract !== "global-optimization-v1") {
    result.reasons.push(apiContract ? "unexpected_api_contract" : "missing_api_contract");
  }
  if (expected && buildSHA !== expected) {
    result.reasons.push("build_sha_mismatch");
  }
}

async function safeText(response) {
  if (typeof response.text !== "function") return "";
  return response.text();
}

function stringField(payload, key) {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeBuildSHA(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-");
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
