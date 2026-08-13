import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseAcceptanceEnv,
  releaseAcceptanceSteps,
  runReleaseAcceptance,
  validateReleaseAcceptanceEnv,
} from "../scripts/release-acceptance.mjs";

test("release acceptance wrapper requires an explicit staging or production URL", () => {
  assert.match(validateReleaseAcceptanceEnv({}), /PERF_BASE_URL is required/);
  assert.match(validateReleaseAcceptanceEnv({ PERF_BASE_URL: "http://localhost:8080" }), /not localhost/);
  assert.equal(validateReleaseAcceptanceEnv({ PERF_BASE_URL: "https://api.takolako.site" }), "");
});

test("release acceptance wrapper keeps production smoke public by default", () => {
  assert.equal(buildReleaseAcceptanceEnv({
    PERF_BASE_URL: "https://api.takolako.site",
  }).PERF_CHECKOUT_ITERATIONS, "0");

  assert.equal(buildReleaseAcceptanceEnv({
    PERF_BASE_URL: "https://api.takolako.site",
    PERF_CHECKOUT_ITERATIONS: "8",
  }).PERF_CHECKOUT_ITERATIONS, "8");
});

test("release acceptance wrapper runs gates in release order", () => {
  const calls = [];
  const status = runReleaseAcceptance({
    env: { PERF_BASE_URL: "https://api.takolako.site" },
    cwd: "D:\\TK_miniapp",
    log: () => {},
    error: () => {},
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(calls.map((call) => call.args[0]), releaseAcceptanceSteps.map((step) => step.args[0]));
  for (const call of calls) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.options.cwd, "D:\\TK_miniapp");
    assert.equal(call.options.shell, false);
    assert.equal(call.options.stdio, "inherit");
    assert.equal(call.options.env.PERF_CHECKOUT_ITERATIONS, "0");
  }
});

test("release acceptance wrapper stops at the first failing gate", () => {
  const calls = [];
  const errors = [];
  const status = runReleaseAcceptance({
    env: { PERF_BASE_URL: "https://api.takolako.site" },
    log: () => {},
    error: (message) => errors.push(message),
    spawnImpl: (_command, args) => {
      calls.push(args[0]);
      return { status: calls.length === 2 ? 7 : 0 };
    },
  });

  assert.equal(status, 7);
  assert.deepEqual(calls, [
    "scripts/legacy-public-contract.mjs",
    "scripts/cors-contract.mjs",
  ]);
  assert.deepEqual(errors, ["release acceptance failed at cors-contract"]);
});
