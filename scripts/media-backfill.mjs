import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (isMain()) {
  const defaultDryRun = process.argv[2];
  const userArgs = process.argv.slice(3);

  if (defaultDryRun !== "true" && defaultDryRun !== "false") {
    console.error("Usage: node scripts/media-backfill.mjs <true|false> [mediabackfill args...]");
    process.exit(2);
  }

  const goArgs = buildGoArgs(defaultDryRun, userArgs);
  const result = spawnSync(process.execPath, ["scripts/go-toolchain.mjs", ...goArgs], {
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

export function buildGoArgs(defaultDryRun, rawArgs) {
  const args = stripNpmSeparator(rawArgs);
  return [
    "run",
    "./backend/cmd/mediabackfill",
    `-dry-run=${defaultDryRun}`,
    ...args,
  ];
}

function stripNpmSeparator(args) {
  if (args[0] === "--") return args.slice(1);
  return args;
}

export function isMain(metaURL = import.meta.url, argv = process.argv) {
  return fileURLToPath(metaURL) === argv[1];
}
