import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (isMain()) {
  const missingEnvMessage = validatePostgresEnv(process.env);
  if (missingEnvMessage) {
    console.error(missingEnvMessage);
    process.exit(2);
  }

  const result = spawnSync(process.execPath, ["scripts/go-toolchain.mjs", ...buildGoTestArgs(process.argv.slice(2))], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

export function buildGoTestArgs(rawArgs) {
  const args = stripNpmSeparator(rawArgs);
  return ["test", "./...", "-count=1", ...args];
}

export function validatePostgresEnv(env) {
  return env.TK_TEST_POSTGRES_DSN
    ? ""
    : "TK_TEST_POSTGRES_DSN is required for PostgreSQL integration acceptance tests.";
}

function stripNpmSeparator(args) {
  if (args[0] === "--") return args.slice(1);
  return args;
}

export function isMain(metaURL = import.meta.url, argv = process.argv) {
  return fileURLToPath(metaURL) === argv[1];
}
