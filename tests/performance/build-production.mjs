import { spawn } from "node:child_process";

const apps = [
  ["@tk-delivery/client", "/"],
  ["@tk-delivery/kitchen", "/kitchen/"],
  ["@tk-delivery/courier", "/courier/"],
  ["@tk-delivery/admin", "/admin/"],
];

for (const [filter, basePath] of apps) {
  await run("pnpm", ["--filter", filter, "build"], {
    VITE_APP_ENV: "production",
    VITE_DEMO_MODE: "false",
    VITE_API_BASE_URL: "https://api.takolako.site",
    VITE_BASE_PATH: basePath,
    VITE_PERF_BEACON_SAMPLE: "0",
    VITE_BUILD_SHA: process.env.GITHUB_SHA || "local-production",
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
