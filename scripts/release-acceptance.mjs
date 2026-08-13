import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateExternalSmokeEnv } from "./external-smoke.mjs";

export const releaseAcceptanceSteps = [
  {
    name: "legacy-public-contract",
    args: ["scripts/legacy-public-contract.mjs"],
  },
  {
    name: "cors-contract",
    args: ["scripts/cors-contract.mjs"],
  },
  {
    name: "production-contract",
    args: ["scripts/production-contract.mjs"],
  },
  {
    name: "external-smoke",
    args: ["scripts/external-smoke.mjs"],
  },
];

if (isMain()) {
  process.exit(runReleaseAcceptance({
    env: process.env,
    cwd: process.cwd(),
    spawnImpl: spawnSync,
  }));
}

export function runReleaseAcceptance({
  env = process.env,
  cwd = process.cwd(),
  spawnImpl = spawnSync,
  steps = releaseAcceptanceSteps,
  log = console.log,
  error = console.error,
} = {}) {
  const validationMessage = validateReleaseAcceptanceEnv(env);
  if (validationMessage) {
    error(validationMessage);
    return 2;
  }

  const childEnv = buildReleaseAcceptanceEnv(env);
  for (const step of steps) {
    log(`release gate: ${step.name}`);
    const result = spawnImpl(process.execPath, step.args, {
      cwd,
      env: childEnv,
      shell: false,
      stdio: "inherit",
    });
    if (result.error) {
      error(result.error.message);
      return 1;
    }
    const status = result.status ?? 1;
    if (status !== 0) {
      error(`release acceptance failed at ${step.name}`);
      return status;
    }
  }

  return 0;
}

export function buildReleaseAcceptanceEnv(env) {
  return {
    ...env,
    PERF_CHECKOUT_ITERATIONS: env.PERF_CHECKOUT_ITERATIONS || "0",
  };
}

export function validateReleaseAcceptanceEnv(env) {
  return validateExternalSmokeEnv(env);
}

export function isMain(metaURL = import.meta.url, argv = process.argv) {
  return fileURLToPath(metaURL) === argv[1];
}
