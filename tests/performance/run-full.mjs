import { spawn } from "node:child_process";

await run("node", ["tests/performance/build-lab.mjs"]);
await run("pnpm", ["exec", "playwright", "test", "-c", "tests/performance/playwright.config.ts"]);
await run("pnpm", ["perf:budgets"]);
await run("node", ["scripts/load-smoke.mjs"]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(" ")}`);
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
