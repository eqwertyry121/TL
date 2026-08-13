import { spawn } from "node:child_process";

const apps = [
  ["@tk-delivery/client", "/"],
  ["@tk-delivery/kitchen", "/"],
  ["@tk-delivery/courier", "/"],
  ["@tk-delivery/admin", "/"],
];

for (const [filter, basePath] of apps) {
  await run("pnpm", ["--filter", filter, "build"], {
    VITE_APP_ENV: "development",
    VITE_DEMO_MODE: "true",
    VITE_API_BASE_URL: "",
    VITE_BASE_PATH: basePath,
    VITE_PERF_BEACON_SAMPLE: "0",
    VITE_BUILD_SHA: process.env.GITHUB_SHA || "local-lab",
  });
}

function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
