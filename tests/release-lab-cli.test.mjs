import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleaseLabEnv,
  releaseLabSteps,
  runReleaseLab,
} from "../tests/performance/run-release-lab.mjs";

test("release lab wrapper defaults to twenty startup samples and SLO mode", () => {
  const env = buildReleaseLabEnv({});
  assert.equal(env.PERF_STARTUP_RUNS, "20");
  assert.equal(env.PERF_RELEASE_STARTUP_SLO, "true");
});

test("release lab wrapper preserves explicit startup sample and SLO overrides", () => {
  const env = buildReleaseLabEnv({
    PERF_STARTUP_RUNS: "12",
    PERF_RELEASE_STARTUP_SLO: "false",
  });
  assert.equal(env.PERF_STARTUP_RUNS, "12");
  assert.equal(env.PERF_RELEASE_STARTUP_SLO, "false");
});

test("release lab wrapper runs build, Playwright and bundle budgets in order", () => {
  const calls = [];
  const status = runReleaseLab({
    env: {},
    cwd: "D:\\TK_miniapp",
    log: () => {},
    error: () => {},
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(calls.map((call) => call.args), releaseLabSteps.map((step) => step.args));
  assert.deepEqual(calls.map((call) => call.command), releaseLabSteps.map((step) => step.command));
  for (const call of calls) {
    assert.equal(call.options.cwd, "D:\\TK_miniapp");
    assert.equal(call.options.stdio, "inherit");
    assert.equal(call.options.env.PERF_STARTUP_RUNS, "20");
    assert.equal(call.options.env.PERF_RELEASE_STARTUP_SLO, "true");
  }
});

test("release lab wrapper stops at the first failing lab phase", () => {
  const calls = [];
  const errors = [];
  const status = runReleaseLab({
    env: {},
    log: () => {},
    error: (message) => errors.push(message),
    spawnImpl: (_command, args) => {
      calls.push(args.join(" "));
      return { status: calls.length === 2 ? 9 : 0 };
    },
  });

  assert.equal(status, 9);
  assert.deepEqual(calls, [
    "tests/performance/build-lab.mjs",
    "exec playwright test -c tests/performance/playwright.config.ts",
  ]);
  assert.deepEqual(errors, ["release lab failed at playwright-startup-slo"]);
});
