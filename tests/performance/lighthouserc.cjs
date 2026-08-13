module.exports = {
  ci: {
    collect: {
      url: ["http://127.0.0.1:4173/main/#/"],
      numberOfRuns: 3,
      startServerCommand: "pnpm --filter @tk-delivery/client exec vite preview --host 127.0.0.1 --port 4173",
      startServerReadyPattern: "4173",
      startServerReadyTimeout: 120000,
      settings: {
        preset: "desktop",
        throttlingMethod: "simulate",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.7 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
        "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
        "total-blocking-time": ["warn", { maxNumericValue: 300 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "test-results/lighthouse",
    },
  },
};
