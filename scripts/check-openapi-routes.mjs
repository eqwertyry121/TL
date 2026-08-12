import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const serverPath = resolve(root, "backend/internal/httpapi/server.go");
const openapiPath = resolve(root, "docs/openapi.yaml");

const server = readFileSync(serverPath, "utf8");
const openapi = readFileSync(openapiPath, "utf8");

const ignoredBackendRoutes = new Set([
  "GET /health",
  "GET /media/*",
]);

const backendRoutes = new Set();
const routePattern = /\br\.(Get|Post|Put|Delete)\("([^"]+)"/g;
let routeMatch;
while ((routeMatch = routePattern.exec(server)) !== null) {
  const method = routeMatch[1].toUpperCase();
  const path = routeMatch[2];
  const route = `${method} ${path}`;
  if (!ignoredBackendRoutes.has(route)) {
    backendRoutes.add(route);
  }
}

const openapiRoutes = new Set();
const lines = openapi.split(/\r?\n/);
let currentPath = "";
for (const line of lines) {
  const pathMatch = line.match(/^  (\/[^:]+):\s*$/);
  if (pathMatch) {
    currentPath = pathMatch[1];
    continue;
  }
  const methodMatch = line.match(/^    (get|post|put|delete):\s*$/i);
  if (currentPath && methodMatch) {
    openapiRoutes.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
  }
}

const missingFromOpenAPI = [...backendRoutes]
  .filter((route) => !openapiRoutes.has(route))
  .sort();
const staleInOpenAPI = [...openapiRoutes]
  .filter((route) => !backendRoutes.has(route))
  .sort();

if (missingFromOpenAPI.length || staleInOpenAPI.length) {
  if (missingFromOpenAPI.length) {
    console.error("Routes present in backend but missing in docs/openapi.yaml:");
    for (const route of missingFromOpenAPI) {
      console.error(`  - ${route}`);
    }
  }
  if (staleInOpenAPI.length) {
    console.error("Routes present in docs/openapi.yaml but not found in backend:");
    for (const route of staleInOpenAPI) {
      console.error(`  - ${route}`);
    }
  }
  process.exit(1);
}

console.log(`OpenAPI route coverage OK (${backendRoutes.size} backend routes).`);
