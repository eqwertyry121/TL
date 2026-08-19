import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const runtimeRoots = ["apps", "packages", "backend", "deploy", "scripts", ".github/workflows"];
const runtimeExtensions = new Set([
  ".cjs",
  ".conf",
  ".go",
  ".js",
  ".json",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const forbiddenRuntimePatterns = [
  { name: "Redis dependency/runtime cache", pattern: /\b(ioredis|redis)\b/i },
  { name: "WebSocket runtime", pattern: /\b(WebSocket|socket\.io)\b/i },
  { name: "SSE/EventSource runtime", pattern: /\bEventSource\b|\btext\/event-stream\b/i },
  { name: "service worker runtime", pattern: /\bnavigator\.serviceWorker\b|\bserviceWorker\.register\b|\bworkbox\b/i },
  { name: "GraphQL/Apollo runtime", pattern: /\b(graphql|@apollo|apollo-client)\b/i },
  { name: "Kubernetes/autoscaling configs", pattern: /\b(kubernetes|k8s|HorizontalPodAutoscaler|autoscaling\/v)\b/i },
  { name: "Prometheus/Grafana runtime", pattern: /\b(prometheus|grafana)\b/i },
];

test("runtime code and deployment config do not introduce forbidden optimization infrastructure", () => {
  const files = runtimeRoots.flatMap((root) => listTextFiles(root));
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const { name, pattern } of forbiddenRuntimePatterns) {
      if (pattern.test(source)) violations.push(`${file}: ${name}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("client sensitive checkout state stays out of localStorage", () => {
  const source = readFileSync(new URL("../apps/client/src/storage.ts", import.meta.url), "utf8");

  assert.match(source, /sessionStorage\.setItem\(CHECKOUT_KEY/);
  assert.match(source, /sessionStorage\.setItem\(CHECKOUT_PROGRESS_KEY/);
  assert.match(source, /sessionStorage\.setItem\(IDEMPOTENCY_KEY/);
  assert.doesNotMatch(source, /localStorage\.setItem\(CHECKOUT_KEY/);
  assert.doesNotMatch(source, /localStorage\.setItem\(CHECKOUT_PROGRESS_KEY/);
  assert.doesNotMatch(source, /localStorage\.setItem\(IDEMPOTENCY_KEY/);
});

test("mini apps do not use blocking browser prompt/alert/confirm dialogs", () => {
  const files = [
    "apps/admin/src/App.tsx",
    "apps/client/src/App.tsx",
    "apps/kitchen/src/App.tsx",
    "apps/courier/src/App.tsx",
  ];
  const violations = files.flatMap((file) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    return [
      /\bwindow\.confirm\s*\(/,
      /\bwindow\.prompt\s*\(/,
      /\bwindow\.alert\s*\(/,
      /\bconfirm\s*\(/,
      /\bprompt\s*\(/,
      /\balert\s*\(/,
    ].filter((pattern) => pattern.test(source)).map((pattern) => `${file}: ${pattern}`);
  });

  assert.deepEqual(violations, []);
});

test("frontend conditional GET caches are bounded", () => {
  const files = [
    "apps/admin/src/api.ts",
    "apps/client/src/api.ts",
    "packages/staff-core/src/index.ts",
  ];

  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /const getCacheLimit = 64/);
    assert.match(source, /while \(getCache\.size > getCacheLimit\)/);
    assert.match(source, /getCache\.delete\(oldestKey\)/);
  }
});

function listTextFiles(root) {
  const out = [];
  walk(root, out);
  return out;
}

function walk(path, out) {
  let info;
  try {
    info = statSync(path);
  } catch {
    return;
  }

  if (info.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git" || entry === "test-results") continue;
      walk(join(path, entry), out);
    }
    return;
  }

  if (isTextFile(path)) out.push(path);
}

function isTextFile(path) {
  if (path.endsWith("Dockerfile")) return true;
  const dot = path.lastIndexOf(".");
  const extension = dot === -1 ? "" : path.slice(dot);
  return runtimeExtensions.has(extension);
}
