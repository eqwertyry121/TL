import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (isMain()) {
  const missingEnvMessage = validateExternalSmokeEnv(process.env);
  if (missingEnvMessage) {
    console.error(missingEnvMessage);
    process.exit(2);
  }

  const result = spawnSync(process.execPath, ["scripts/load-smoke.mjs"], {
    cwd: process.cwd(),
    env: buildExternalSmokeEnv(process.env),
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

export function buildExternalSmokeEnv(env) {
  return {
    ...env,
    PERF_CHECKOUT_ITERATIONS: env.PERF_CHECKOUT_ITERATIONS || "0",
  };
}

export function validateExternalSmokeEnv(env) {
  if (!env.PERF_BASE_URL) {
    return "PERF_BASE_URL is required for staging/production API smoke.";
  }

  let parsed;
  try {
    parsed = new URL(env.PERF_BASE_URL);
  } catch {
    return `PERF_BASE_URL must be a valid URL: ${env.PERF_BASE_URL}`;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `PERF_BASE_URL must use http or https: ${env.PERF_BASE_URL}`;
  }

  if (env.PERF_ALLOW_LOCAL_BASE_URL === "true") return "";
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (localHosts.has(parsed.hostname) || parsed.hostname.endsWith(".localhost")) {
    return "PERF_BASE_URL must point to staging/production, not localhost. Set PERF_ALLOW_LOCAL_BASE_URL=true only for wrapper tests.";
  }

  return "";
}

export function isMain(metaURL = import.meta.url, argv = process.argv) {
  return fileURLToPath(metaURL) === argv[1];
}
