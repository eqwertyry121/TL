import assert from "node:assert/strict";
import test from "node:test";

import { buildExternalSmokeEnv, validateExternalSmokeEnv } from "../scripts/external-smoke.mjs";

test("external smoke wrapper requires an explicit base URL", () => {
  assert.match(validateExternalSmokeEnv({}), /PERF_BASE_URL is required/);
});

test("external smoke wrapper rejects accidental localhost targets", () => {
  assert.match(validateExternalSmokeEnv({ PERF_BASE_URL: "http://127.0.0.1:8080" }), /not localhost/);
  assert.match(validateExternalSmokeEnv({ PERF_BASE_URL: "http://localhost:8080" }), /not localhost/);
});

test("external smoke wrapper accepts staging or production targets", () => {
  assert.equal(validateExternalSmokeEnv({ PERF_BASE_URL: "https://api.takolako.site" }), "");
  assert.equal(validateExternalSmokeEnv({
    PERF_BASE_URL: "http://127.0.0.1:8080",
    PERF_ALLOW_LOCAL_BASE_URL: "true",
  }), "");
});

test("external smoke wrapper keeps production smoke public by default", () => {
  const env = buildExternalSmokeEnv({
    PERF_BASE_URL: "https://api.takolako.site",
  });
  assert.equal(env.PERF_CHECKOUT_ITERATIONS, "0");

  const customEnv = buildExternalSmokeEnv({
    PERF_BASE_URL: "https://api.takolako.site",
    PERF_CHECKOUT_ITERATIONS: "12",
  });
  assert.equal(customEnv.PERF_CHECKOUT_ITERATIONS, "12");
});
