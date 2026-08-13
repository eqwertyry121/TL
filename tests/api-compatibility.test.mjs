import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("../backend/internal/httpapi/server.go", import.meta.url), "utf8");
const openapi = readFileSync(new URL("../docs/openapi.yaml", import.meta.url), "utf8");

const backendRoutes = collectBackendRoutes(server);
const openapiRoutes = collectOpenAPIRoutes(openapi);

const additiveOptimizationRoutes = [
  "GET /api/v1/bootstrap/public",
  "POST /api/v1/bootstrap/client",
  "POST /api/v1/bootstrap/staff",
  "POST /api/v1/bootstrap/admin",
  "POST /api/v1/performance/beacon",
];

const legacyRollbackRoutes = [
  "GET /api/v1/runtime",
  "GET /api/v1/menu",
  "POST /api/v1/auth/telegram",
  "GET /api/v1/me",
  "GET /api/v1/contact",
  "GET /api/v1/orders",
  "GET /api/v1/orders/{id}",
  "GET /api/v1/kitchen/orders",
  "GET /api/v1/courier/orders",
  "GET /api/v1/admin/dashboard",
  "GET /api/v1/admin/menu",
  "GET /api/v1/admin/orders",
  "GET /api/v1/admin/orders/{id}",
  "GET /api/v1/admin/settings",
  "GET /api/v1/admin/schedule",
  "GET /api/v1/admin/staff",
  "GET /api/v1/admin/analytics",
  "GET /api/v1/admin/audit",
];

test("optimization API additions are additive and documented", () => {
  assertRoutesPresent(backendRoutes, additiveOptimizationRoutes, "backend");
  assertRoutesPresent(openapiRoutes, additiveOptimizationRoutes, "OpenAPI");
});

test("legacy startup and list endpoints remain for rollback compatibility", () => {
  assertRoutesPresent(backendRoutes, legacyRollbackRoutes, "backend");
  assertRoutesPresent(openapiRoutes, legacyRollbackRoutes, "OpenAPI");
});

function assertRoutesPresent(actualRoutes, expectedRoutes, label) {
  const missing = expectedRoutes.filter((route) => !actualRoutes.has(route));
  assert.deepEqual(missing, [], `${label} is missing compatibility routes`);
}

function collectBackendRoutes(source) {
  const routes = new Set();
  const routePattern = /\br\.(Get|Post|Put|Delete)\("([^"]+)"/g;
  let match;
  while ((match = routePattern.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const path = match[2].startsWith("/api/v1") ? match[2] : `/api/v1${match[2]}`;
    if (path.startsWith("/api/v1/live") || path.startsWith("/api/v1/ready") || path.startsWith("/api/v1/health")) {
      continue;
    }
    if (path === "/api/v1/media/*") continue;
    routes.add(`${method} ${path}`);
  }
  return routes;
}

function collectOpenAPIRoutes(source) {
  const routes = new Set();
  const basePath = collectServerBasePath(source);
  const lines = source.split(/\r?\n/);
  let currentPath = "";

  for (const line of lines) {
    const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
    if (pathMatch) {
      currentPath = `${basePath}${pathMatch[1]}`;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|delete):\s*$/i);
    if (currentPath && methodMatch) {
      routes.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
    }
  }

  return routes;
}

function collectServerBasePath(source) {
  const match = source.match(/servers:\s*\n(?:\s+-\s+url:\s+.*\n)*?\s+-\s+url:\s+https?:\/\/[^\s]+(\/api\/v1)\b/);
  assert.ok(match, "OpenAPI servers must include /api/v1 base path");
  return match[1];
}
