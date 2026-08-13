import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeploymentDiagnosticsEnv,
  deploymentDiagnosticSteps,
  runDeploymentDiagnostics,
  validateDeploymentDiagnosticsEnv,
} from "../scripts/deployment-diagnostics.mjs";

test("deployment diagnostics requires an explicit staging or production URL", () => {
  assert.match(validateDeploymentDiagnosticsEnv({}), /PERF_BASE_URL is required/);
  assert.match(validateDeploymentDiagnosticsEnv({ PERF_BASE_URL: "http://localhost:8080" }), /not localhost/);
  assert.equal(validateDeploymentDiagnosticsEnv({ PERF_BASE_URL: "https://api.takolako.site" }), "");
});

test("deployment diagnostics keeps checkout disabled by default", () => {
  assert.equal(buildDeploymentDiagnosticsEnv({
    PERF_BASE_URL: "https://api.takolako.site",
  }).PERF_CHECKOUT_ITERATIONS, "0");
  assert.equal(buildDeploymentDiagnosticsEnv({
    PERF_BASE_URL: "https://api.takolako.site",
    PERF_CHECKOUT_ITERATIONS: "4",
  }).PERF_CHECKOUT_ITERATIONS, "4");
});

test("deployment diagnostics runs all fast preflight checks in order", () => {
  const calls = [];
  const logs = [];
  const status = runDeploymentDiagnostics({
    env: { PERF_BASE_URL: "https://api.takolako.site" },
    cwd: "D:\\TK_miniapp",
    log: (message) => logs.push(message),
    error: () => {},
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(calls.map((call) => call.args[0]), deploymentDiagnosticSteps.map((step) => step.args[0]));
  assert.equal(logs.at(-1), "deployment diagnostics passed");
  for (const call of calls) {
    assert.equal(call.command, process.execPath);
    assert.equal(call.options.cwd, "D:\\TK_miniapp");
    assert.equal(call.options.shell, false);
    assert.equal(call.options.stdio, "inherit");
    assert.equal(call.options.env.PERF_CHECKOUT_ITERATIONS, "0");
  }
});

test("deployment diagnostics continues after failures and reports all failed preflights", () => {
  const calls = [];
  const errors = [];
  const status = runDeploymentDiagnostics({
    env: { PERF_BASE_URL: "https://api.takolako.site" },
    log: () => {},
    error: (message) => errors.push(message),
    spawnImpl: (_command, args) => {
      calls.push(args[0]);
      return { status: calls.length === 1 ? 0 : calls.length + 4 };
    },
  });

  assert.equal(status, 1);
  assert.deepEqual(calls, [
    "scripts/legacy-public-contract.mjs",
    "scripts/cors-contract.mjs",
    "scripts/production-contract.mjs",
  ]);
  assert.deepEqual(errors, ["deployment diagnostics failed: cors-contract, production-contract"]);
});
