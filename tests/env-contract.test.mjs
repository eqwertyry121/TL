import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const optimizationEnvKeys = [
  "POSTGRES_MAX_CONNS",
  "POSTGRES_MIN_CONNS",
  "POSTGRES_MAX_CONN_IDLE_TIME",
  "NOTIFICATION_CONCURRENCY",
  "NOTIFICATION_BACKLOG_ALERT_AFTER",
  "SERVER_TIMING_ENABLED",
  "PII_RETENTION_DAYS",
  "FISCAL_PROCESS_ACCEPTED",
];


const publicLegalEnvKeys = [
  "VITE_LEGAL_BUSINESS_NAME",
  "VITE_LEGAL_REGISTRATION_NUMBER",
  "VITE_LEGAL_TAX_ID",
  "VITE_LEGAL_VAT_STATUS",
  "VITE_LEGAL_REGISTERED_ADDRESS",
  "VITE_LEGAL_RESTAURANT_ADDRESS",
  "VITE_LEGAL_EMAIL",
  "VITE_LEGAL_PHONE",
];

const ownerBootstrapEnvKeys = [
  "BOOTSTRAP_OWNER_TELEGRAM_IDS",
  "BOOTSTRAP_OWNER_TELEGRAM_ID",
];

test("optimization runtime knobs are documented in env templates", () => {
  const rootExample = readSource(".env.example");
  const productionExample = readSource("deploy/env.production.example");

  for (const key of optimizationEnvKeys) {
    assertEnvKey(rootExample, key, ".env.example");
    assertEnvKey(productionExample, key, "deploy/env.production.example");
  }
});

test("owner bootstrap ids are documented in env templates", () => {
  const rootExample = readSource(".env.example");
  const productionExample = readSource("deploy/env.production.example");

  for (const key of ownerBootstrapEnvKeys) {
    assertEnvKey(rootExample, key, ".env.example");
    assertEnvKey(productionExample, key, "deploy/env.production.example");
  }
});

test("backend deployment exposes a non-secret build sha", () => {
  const rootExample = readSource(".env.example");
  const productionExample = readSource("deploy/env.production.example");
  const compose = readSource("deploy/docker-compose.api.yml");
  const dockerfile = readSource("deploy/Dockerfile");
  const backendWorkflow = readSource(".github/workflows/backend.yml");

  assertEnvKey(rootExample, "APP_BUILD_SHA", ".env.example");
  assertEnvKey(productionExample, "APP_BUILD_SHA", "deploy/env.production.example");
  assert.match(dockerfile, /^ARG APP_BUILD_SHA=unknown$/m);
  assert.match(dockerfile, /go build -ldflags="-X main\.buildSHA=\$\{APP_BUILD_SHA\}"/);
  assert.match(compose, /APP_BUILD_SHA: \$\{APP_BUILD_SHA:-unknown\}/);
  assert.match(backendWorkflow, /docker build --build-arg APP_BUILD_SHA=\$\{\{ github\.sha \}\}/);
});

test("production media templates serve uploads directly through Nginx", () => {
  const productionExample = readSource("deploy/env.production.example");
  const compose = readSource("deploy/docker-compose.api.yml");
  const dockerfile = readSource("deploy/Dockerfile");
  const nginxAPI = readSource("deploy/nginx.api.example.conf");
  const nginxHost = readSource("deploy/nginx.api.host.example.conf");
  const nginxAPIMedia = sliceBetween(nginxAPI, "    location /media/ {", "    }\n}");
  const nginxHostMedia = sliceBetween(nginxHost, "    location /media/ {", "    }\n\n    location / {");

  assertEnvKey(productionExample, "MEDIA_VOLUME_HOST_PATH", "deploy/env.production.example");
  assert.match(compose, /\$\{MEDIA_VOLUME_HOST_PATH:-\/srv\/tk-delivery\/uploads\}:\/app\/uploads/);
  assert.match(dockerfile, /^ARG APP_UID=10001$/m);
  assert.match(dockerfile, /^ARG APP_GID=10001$/m);
  assert.match(dockerfile, /addgroup -S -g "\$\{APP_GID\}" app/);
  assert.match(dockerfile, /adduser -S -G app -u "\$\{APP_UID\}" app/);
  assert.match(dockerfile, /COPY --chown=app:app docs\/menu_assets_from_telegram\/production_media\/\*\.jpg \/app\/seed-media\/menu\//);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/entrypoint\.sh"\]/);
  for (const block of [nginxAPIMedia, nginxHostMedia]) {
    assert.match(block, /alias \/srv\/tk-delivery\/uploads\/;/);
    assert.match(block, /gzip off;/);
    assert.match(block, /etag on;/);
    assert.match(block, /Cache-Control "public, max-age=31536000, immutable"/);
    assert.doesNotMatch(block, /proxy_pass/);
  }
});

test("production frontend workflows stamp builds with the commit sha", () => {
  const pagesWorkflow = readSource(".github/workflows/pages.yml");
  const performanceWorkflow = readSource(".github/workflows/performance.yml");

  const productionBuild = sliceWorkflowStep(pagesWorkflow, "Build production Mini Apps");
  assertBuildStepHasCommitSHA(pagesWorkflow, "Build production Mini Apps", "steps.production_checkout.outputs.commit");
  for (const appName of ["client", "kitchen", "courier", "admin"]) {
    assert.match(productionBuild, new RegExp(`pnpm --filter @tk-delivery/${appName} build`));
  }
  assertBuildStepHasCommitSHA(performanceWorkflow, "Production build");
});

test("client production build exposes the public merchant identity contract", () => {
  const rootExample = readSource(".env.example");
  const pagesWorkflow = readSource(".github/workflows/pages.yml");
  const clientStep = sliceWorkflowStep(pagesWorkflow, "Build production Mini Apps");

  for (const key of publicLegalEnvKeys) {
    assertEnvKey(rootExample, key, ".env.example");
    const variableName = key.replace(/^VITE_/, "");
    assert.match(clientStep, new RegExp(`^          ${key}: \\$\\{\\{ vars\\.${variableName} \\}\\}$`, "m"));
  }
});

test("backend CI runs the full PostgreSQL integration gate", () => {
  const backendWorkflow = readSource(".github/workflows/backend.yml");
  const stepBlock = sliceWorkflowStep(backendWorkflow, "PostgreSQL integration tests");

  assert.match(stepBlock, /TK_TEST_POSTGRES_DSN:/, "PostgreSQL integration gate must set TK_TEST_POSTGRES_DSN");
  assert.match(stepBlock, /\bgo test \.\/\.\.\. -count=1\b/, "PostgreSQL integration gate must run the full Go suite with -count=1");
  assert.doesNotMatch(stepBlock, /go test \.\/backend\/internal\//, "PostgreSQL integration gate must not hard-code a package subset");
});

test("backend CI proves the optimized public API contract before load smoke", () => {
  const backendWorkflow = readSource(".github/workflows/backend.yml");
  const stepBlock = sliceWorkflowStep(backendWorkflow, "API public load smoke");

  assertWorkflowStepEnv(backendWorkflow, "API public load smoke", "PERF_ALLOW_LOCAL_BASE_URL", "\"true\"");
  assert.match(stepBlock, /node scripts\/cors-contract\.mjs/, "backend API smoke must verify exact-origin CORS at runtime");
  assert.match(stepBlock, /node scripts\/production-contract\.mjs/, "backend API smoke must verify /version, /bootstrap/public, menu and runtime contracts");
  assert.match(stepBlock, /node scripts\/load-smoke\.mjs/, "backend API smoke must still run the concurrent load smoke");
  assert.ok(
    stepBlock.indexOf("node scripts/cors-contract.mjs") < stepBlock.indexOf("node scripts/production-contract.mjs"),
    "CORS preflight contract must run before optimized public contract",
  );
  assert.ok(
    stepBlock.indexOf("node scripts/production-contract.mjs") < stepBlock.indexOf("node scripts/load-smoke.mjs"),
    "optimized public contract must run before load smoke",
  );
});

test("frontend deploy and performance CI run root optimization gates", () => {
  const pagesWorkflow = readSource(".github/workflows/pages.yml");
  const performanceWorkflow = readSource(".github/workflows/performance.yml");

  const productionCheckout = sliceWorkflowStep(pagesWorkflow, "Checkout production branch");
  const testCheckout = sliceWorkflowStep(pagesWorkflow, "Checkout test branch");
  const productionChecks = sliceWorkflowStep(pagesWorkflow, "Production contract checks");
  assert.match(productionCheckout, /^          ref: main$/m);
  assert.match(productionCheckout, /^          path: production-source$/m);
  assert.match(testCheckout, /^          ref: test$/m);
  assert.match(testCheckout, /^          path: test-source$/m);
  assert.match(productionChecks, /\bpnpm check\b/);
  assert.match(productionChecks, /\bpnpm perf:deployment-diagnostics\b/);
  assertWorkflowStepEnv(pagesWorkflow, "Production contract checks", "PERF_BASE_URL", "https://api.takolako.site");
  assert.doesNotMatch(
    productionChecks,
    /PERF_EXPECTED_BUILD_SHA/,
    "frontend deploy must allow a compatible API release with a different build sha",
  );
  assertWorkflowStepBefore(pagesWorkflow, "Production contract checks", "Build production Mini Apps");
  for (const [stepName, command] of [
    ["OpenAPI generated contract tests", "pnpm openapi:check"],
    ["Media reference check", "pnpm media:check"],
    ["Media backfill wrapper tests", "pnpm media:backfill:cli:test"],
    ["PostgreSQL wrapper tests", "pnpm go:test:postgres:cli:test"],
    ["External smoke wrapper tests", "pnpm perf:external-smoke:cli:test"],
    ["Production contract wrapper tests", "pnpm perf:production-contract:cli:test"],
    ["Legacy public contract wrapper tests", "pnpm perf:legacy-public-contract:cli:test"],
    ["CORS contract wrapper tests", "pnpm perf:cors-contract:cli:test"],
    ["Release acceptance wrapper tests", "pnpm perf:release-acceptance:cli:test"],
    ["Deployment diagnostics wrapper tests", "pnpm perf:deployment-diagnostics:cli:test"],
    ["Release lab wrapper tests", "pnpm perf:release-lab:cli:test"],
  ]) {
    assertWorkflowStepRuns(performanceWorkflow, stepName, command);
  }
});

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertEnvKey(source, key, label) {
  assert.match(source, new RegExp(`^${key}=`, "m"), `${label} must document ${key}`);
}

function assertBuildStepHasCommitSHA(source, stepName, expression = "github.sha") {
  const stepBlock = sliceWorkflowStep(source, stepName);
  assert.match(stepBlock, /^        env:$/m, `${stepName} must define env`);
  assert.match(
    stepBlock,
    new RegExp(`^          VITE_BUILD_SHA: \\$\\{\\{ ${escapeRegExp(expression)} \\}\\}$`, "m"),
    `${stepName} must set VITE_BUILD_SHA from the deployed commit sha`,
  );
}

function sliceWorkflowStep(source, stepName) {
  const marker = `      - name: ${stepName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${stepName} step is missing`);
  const next = source.indexOf("\n\n      - name:", start + marker.length);
  return source.slice(start, next === -1 ? undefined : next);
}

function assertWorkflowStepRuns(source, stepName, command) {
  const stepBlock = sliceWorkflowStep(source, stepName);
  assert.match(stepBlock, new RegExp(`^        run: ${escapeRegExp(command)}$`, "m"), `${stepName} must run ${command}`);
}

function assertWorkflowStepEnv(source, stepName, key, value) {
  const stepBlock = sliceWorkflowStep(source, stepName);
  assert.match(stepBlock, /^        env:$/m, `${stepName} must define env`);
  assert.match(stepBlock, new RegExp(`^          ${escapeRegExp(key)}: ${escapeRegExp(value)}$`, "m"), `${stepName} must set ${key}`);
}

function assertWorkflowStepBefore(source, firstStepName, secondStepName) {
  const firstMarker = `      - name: ${firstStepName}`;
  const secondMarker = `      - name: ${secondStepName}`;
  const firstIndex = source.indexOf(firstMarker);
  const secondIndex = source.indexOf(secondMarker);
  assert.notEqual(firstIndex, -1, `${firstStepName} step is missing`);
  assert.notEqual(secondIndex, -1, `${secondStepName} step is missing`);
  assert.ok(firstIndex < secondIndex, `${firstStepName} must run before ${secondStepName}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing start marker: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing end marker: ${endNeedle}`);
  return source.slice(start, end);
}
