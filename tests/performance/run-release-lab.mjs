import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const releaseLabSteps = [
  {
    name: "build-lab-apps",
    command: "node",
    args: ["tests/performance/build-lab.mjs"],
  },
  {
    name: "playwright-startup-slo",
    command: "pnpm",
    args: ["exec", "playwright", "test", "-c", "tests/performance/playwright.config.ts"],
  },
  {
    name: "lighthouse-client-lab",
    command: "pnpm",
    args: ["exec", "lhci", "autorun", "--config", "tests/performance/lighthouserc.cjs"],
  },
];

if (isMain()) {
  process.exit(runReleaseLab({
    env: process.env,
    cwd: process.cwd(),
    spawnImpl: spawnSync,
  }));
}

export function runReleaseLab({
  env = process.env,
  cwd = process.cwd(),
  spawnImpl = spawnSync,
  steps = releaseLabSteps,
  log = console.log,
  error = console.error,
} = {}) {
  const childEnv = buildReleaseLabEnv(env);
  for (const step of steps) {
    log(`release lab: ${step.name}`);
    const result = spawnImpl(step.command, step.args, {
      cwd,
      env: childEnv,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    if (result.error) {
      error(result.error.message);
      return 1;
    }
    const status = result.status ?? 1;
    if (status !== 0) {
      error(`release lab failed at ${step.name}`);
      return status;
    }
  }
  return 0;
}

export function buildReleaseLabEnv(env) {
  return {
    ...env,
    PERF_STARTUP_RUNS: env.PERF_STARTUP_RUNS || "20",
    PERF_RELEASE_STARTUP_SLO: env.PERF_RELEASE_STARTUP_SLO || "true",
  };
}

export function isMain(metaURL = import.meta.url, argv = process.argv) {
  return fileURLToPath(metaURL) === argv[1];
}
