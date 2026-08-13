import { defineConfig, devices } from "@playwright/test";

const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: ".",
  testMatch: /startup\.spec\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-results/performance-html" }]],
  use: {
    ...devices["Pixel 7"],
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @tk-delivery/client exec vite preview --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173/main/#/",
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @tk-delivery/kitchen exec vite preview --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174/",
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @tk-delivery/courier exec vite preview --host 127.0.0.1 --port 4175",
      url: "http://127.0.0.1:4175/",
      reuseExistingServer,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @tk-delivery/admin exec vite preview --host 127.0.0.1 --port 4176",
      url: "http://127.0.0.1:4176/",
      reuseExistingServer,
      timeout: 120_000,
    },
  ],
});
