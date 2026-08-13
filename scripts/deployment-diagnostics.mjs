import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateExternalSmokeEnv } from "./external-smoke.mjs";

export const deploymentDiagnosticSteps = [
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
];

if (isMain()) {
  process.exit(runDeploymentDiagnostics({
    env: process.env,
    cwd: process.cwd(),
    spawnImpl: spawnSync,
  }));
}

export function runDeploymentDiagnostics({
  env = process.env,
  cwd = process.cwd(),
  spawnImpl = spawnSync,
  steps = deploymentDiagnosticSteps,
  log = console.log,
  error = console.error,
} = {}) {
  const validationMessage = validateDeploymentDiagnosticsEnv(env);
  if (validationMessage) {
    error(validationMessage);
    return 2;
  }

  const childEnv = buildDeploymentDiagnosticsEnv(env);
  const failures = [];
  for (const step of steps) {
    log(`deployment diagnostics: ${step.name}`);
    const result = spawnImpl(process.execPath, step.args, {
      cwd,
      env: childEnv,
      shell: false,
      stdio: "inherit",
    });
    if (result.error) {
      error(`${step.name}: ${result.error.message}`);
      failures.push(step.name);
      continue;
    }
    const status = result.status ?? 1;
    if (status !== 0) failures.push(step.name);
  }

  if (failures.length > 0) {
    error(`deployment diagnostics failed: ${failures.join(", ")}`);
    return 1;
  }
  log("deployment diagnostics passed");
  return 0;
}

export function buildDeploymentDiagnosticsEnv(env) {
  return {
    ...env,
    PERF_CHECKOUT_ITERATIONS: env.PERF_CHECKOUT_ITERATIONS || "0",
  };
}

export function validateDeploymentDiagnosticsEnv(env) {
  return validateExternalSmokeEnv(env);
}

export function isMain(metaURL = import.meta.url, argv = process.argv) {
  return fileURLToPath(metaURL) === argv[1];
}
