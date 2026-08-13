import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectProductionContract,
  validateProductionContractEnv,
} from "../scripts/production-contract.mjs";

test("production contract wrapper requires an explicit staging or production URL", () => {
  assert.match(validateProductionContractEnv({}), /PERF_BASE_URL is required/);
  assert.match(validateProductionContractEnv({ PERF_BASE_URL: "http://127.0.0.1:8080" }), /not localhost/);
  assert.equal(validateProductionContractEnv({ PERF_BASE_URL: "https://api.takolako.site" }), "");
});

test("production contract passes for deployed optimized public endpoints", async () => {
  const fetchImpl = routeFetch({
    "/api/v1/version": endpointPair({
      etag: 'W/"version-test-sha"',
      cacheControl: "no-cache",
      body: versionBody({ build_sha: "test-sha" }),
    }),
    "/api/v1/bootstrap/public?locale=ru": endpointPair({
      etag: 'W/"bootstrap-ru-1-1-runtime"',
      cacheControl: "public, max-age=0, must-revalidate",
    }),
    "/api/v1/menu?locale=ru": endpointPair({
      etag: 'W/"menu-ru-1"',
      cacheControl: "public, max-age=0, must-revalidate",
    }),
    "/api/v1/runtime": endpointPair({
      etag: 'W/"runtime-1-open"',
      cacheControl: "no-cache",
    }),
  });

  const results = await inspectProductionContract({
    baseURL: "https://api.takolako.site",
    fetchImpl,
  });

  assert.equal(results.length, 4);
  for (const result of results) {
    assert.equal(result.ok, true, `${result.endpoint}: ${result.reasons.join(", ")}`);
    assert.equal(result.conditional_status, 304);
  }
});

test("production contract verifies the expected backend build sha when provided", async () => {
  const fetchImpl = optimizedFetch({
    versionBuildSHA: "other-sha",
  });

  const results = await inspectProductionContract({
    baseURL: "https://api.takolako.site",
    fetchImpl,
    expectedBuildSHA: "expected-sha",
  });

  assert.equal(results[0].ok, false);
  assert.equal(results[0].build_sha, "other-sha");
  assert.equal(results[0].expected_build_sha, "expected-sha");
  assert.ok(results[0].reasons.includes("build_sha_mismatch"));
});

test("production contract rejects placeholder build identities outside local API smoke", async () => {
  const fetchImpl = optimizedFetch({
    versionBuildSHA: "dev",
  });

  const productionResults = await inspectProductionContract({
    baseURL: "https://api.takolako.site",
    fetchImpl,
  });

  assert.equal(productionResults[0].ok, false);
  assert.ok(productionResults[0].reasons.includes("placeholder_build_sha"));

  const localResults = await inspectProductionContract({
    baseURL: "http://127.0.0.1:18080",
    fetchImpl,
    allowPlaceholderBuildSHA: true,
  });

  assert.equal(localResults[0].ok, true, localResults[0].reasons.join(", "));
});

test("production contract reports a pre-optimization API deployment", async () => {
  const fetchImpl = routeFetch({
    "/api/v1/version": {
      fresh: response({ status: 404, headers: { "content-type": "application/json" }, body: "{}" }),
    },
    "/api/v1/bootstrap/public?locale=ru": {
      fresh: response({ status: 404, headers: { "content-type": "application/json" }, body: "{}" }),
    },
    "/api/v1/menu?locale=ru": {
      fresh: response({ status: 200, headers: { "content-type": "application/json" }, body: "{}" }),
    },
    "/api/v1/runtime": {
      fresh: response({ status: 200, headers: { "content-type": "application/json" }, body: "{}" }),
    },
  });

  const results = await inspectProductionContract({
    baseURL: "https://api.takolako.site",
    fetchImpl,
  });

  assert.equal(results.some((result) => !result.ok), true);
  assert.deepEqual(results[1].reasons, [
    "fresh_status_404",
    "missing_etag",
    "missing_cache_control_public",
    "missing_cache_control_max-age=0",
    "missing_cache_control_must-revalidate",
  ]);
  assert.ok(results[2].reasons.includes("missing_etag"));
  assert.ok(results[3].reasons.includes("missing_etag"));
});

function optimizedFetch({ versionBuildSHA = "test-sha" } = {}) {
  return routeFetch({
    "/api/v1/version": endpointPair({
      etag: `W/"version-${versionBuildSHA}"`,
      cacheControl: "no-cache",
      body: versionBody({ build_sha: versionBuildSHA }),
    }),
    "/api/v1/bootstrap/public?locale=ru": endpointPair({
      etag: 'W/"bootstrap-ru-1-1-runtime"',
      cacheControl: "public, max-age=0, must-revalidate",
    }),
    "/api/v1/menu?locale=ru": endpointPair({
      etag: 'W/"menu-ru-1"',
      cacheControl: "public, max-age=0, must-revalidate",
    }),
    "/api/v1/runtime": endpointPair({
      etag: 'W/"runtime-1-open"',
      cacheControl: "no-cache",
    }),
  });
}

function versionBody(overrides = {}) {
  return JSON.stringify({
    service: "tk-delivery",
    build_sha: "test-sha",
    api_contract: "global-optimization-v1",
    ...overrides,
  });
}

function endpointPair({ etag, cacheControl, body = "{}" }) {
  return {
    fresh: response({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        etag,
        "cache-control": cacheControl,
      },
      body,
    }),
    conditional: response({
      status: 304,
      headers: {
        etag,
        "cache-control": cacheControl,
      },
      body: "",
    }),
  };
}

function routeFetch(routes) {
  return async (url, options = {}) => {
    const parsed = new URL(url);
    const route = routes[`${parsed.pathname}${parsed.search}`];
    assert.ok(route, `unexpected fetch route: ${parsed.pathname}${parsed.search}`);
    const headers = options.headers || {};
    const isConditional = Object.hasOwn(headers, "If-None-Match");
    const output = isConditional ? route.conditional : route.fresh;
    assert.ok(output, `missing ${isConditional ? "conditional" : "fresh"} response`);
    return output;
  };
}

function response({ status, headers = {}, body = "" }) {
  return {
    status,
    headers: new Headers(headers),
    text: async () => body,
  };
}
