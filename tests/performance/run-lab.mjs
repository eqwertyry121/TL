import { spawn } from "node:child_process";

await run("node", ["tests/performance/build-lab.mjs"]);
await run("pnpm", ["exec", "playwright", "test", "-c", "tests/performance/playwright.config.ts"]);

if (process.env.PERF_BASE_URL || process.env.PERF_RUN_LOAD_SMOKE === "true") {
  await run("node", ["scripts/load-smoke.mjs"]);
} else {
  console.log("Skipping API load smoke: set PERF_BASE_URL or PERF_RUN_LOAD_SMOKE=true to include it.");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
