import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectCORSContract,
  validateCORSContractEnv,
} from "../scripts/cors-contract.mjs";

test("CORS contract wrapper requires explicit staging or production URL", () => {
  assert.match(validateCORSContractEnv({}), /PERF_BASE_URL is required/);
  assert.match(validateCORSContractEnv({ PERF_BASE_URL: "http://127.0.0.1:8080" }), /not localhost/);
  assert.equal(validateCORSContractEnv({ PERF_BASE_URL: "https://api.takolako.site" }), "");
});

test("CORS contract passes for exact origin preflight cache and foreign rejection", async () => {
  const results = await inspectCORSContract({
    baseURL: "https://api.takolako.site",
    fetchImpl: routeFetch({
      "https://takolako.site": response({
        status: 204,
        headers: {
          "access-control-allow-origin": "https://takolako.site",
          "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key,If-None-Match",
          "access-control-expose-headers": "ETag,Server-Timing",
          "access-control-max-age": "600",
          vary: "Origin",
        },
      }),
      "https://evil.example": response({ status: 403 }),
    }),
  });

  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.ok, true, `${result.phase}: ${result.reasons.join(", ")}`);
  }
});

test("CORS contract reports wildcard, short cache and foreign-origin leaks", async () => {
  const results = await inspectCORSContract({
    baseURL: "https://api.takolako.site",
    fetchImpl: routeFetch({
      "https://takolako.site": response({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-expose-headers": "ETag",
          "access-control-max-age": "60",
        },
      }),
      "https://evil.example": response({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "Authorization",
        },
      }),
    }),
  });

  assert.equal(results[0].ok, false);
  assert.ok(results[0].reasons.includes("missing_exact_allow_origin"));
  assert.ok(results[0].reasons.includes("wildcard_allow_origin"));
  assert.ok(results[0].reasons.includes("missing_method_POST"));
  assert.ok(results[0].reasons.includes("missing_header_Authorization"));
  assert.ok(results[0].reasons.includes("missing_expose_Server-Timing"));
  assert.ok(results[0].reasons.includes("max_age_below_600"));
  assert.equal(results[1].ok, false);
  assert.ok(results[1].reasons.includes("status_204"));
  assert.ok(results[1].reasons.includes("foreign_origin_allowed"));
});

function routeFetch(routes) {
  return async (_url, options = {}) => {
    assert.equal(options.method, "OPTIONS");
    const origin = options.headers?.Origin;
    const route = routes[origin];
    assert.ok(route, `unexpected origin: ${origin}`);
    return route;
  };
}

function response({ status, headers = {} }) {
  return {
    status,
    headers: new Headers(headers),
  };
}
