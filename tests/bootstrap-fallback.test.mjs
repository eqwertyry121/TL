import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("client bootstrap keeps old endpoint fallback for rolling deploys", () => {
  const source = readSource("apps/client/src/api.ts");

  assertIncludes(source, "/api/v1/bootstrap/client");
  assertIncludes(source, "if (!isMissingEndpoint(err)) throw err;");
  assertIncludes(source, "/api/v1/runtime");
  assertIncludes(source, "/api/v1/menu?locale=");
  assertIncludes(source, "/api/v1/auth/telegram");
  assertIncludes(source, "const session = await authenticate(locale)");
  assertMissingEndpointIs404Only(source);
});

test("staff bootstrap keeps old auth and order list fallback for rolling deploys", () => {
  const source = readSource("packages/staff-core/src/index.ts");

  assertIncludes(source, "/api/v1/bootstrap/staff");
  assertIncludes(source, "if (!isMissingEndpoint(err)) throw err;");
  assertIncludes(source, "/api/v1/auth/telegram");
  assertIncludes(source, "/api/v1/dev/session");
  assertIncludes(source, "/api/v1/kitchen/orders");
  assertIncludes(source, "/api/v1/courier/orders");
  assertIncludes(source, "const session = await authenticate(role)");
  assertMissingEndpointIs404Only(source);
});

test("admin bootstrap keeps old section fallback for rolling deploys", () => {
  const source = readSource("apps/admin/src/api.ts");

  assertIncludes(source, "/api/v1/bootstrap/admin");
  assertIncludes(source, "if (!isMissingEndpoint(err)) throw err;");
  assertIncludes(source, "/api/v1/auth/telegram");
  assertIncludes(source, "/api/v1/dev/session");
  assertIncludes(source, "/api/v1/admin/dashboard");
  assertIncludes(source, "/api/v1/admin/menu");
  assertIncludes(source, "/api/v1/admin/orders?");
  assertIncludes(source, "/api/v1/admin/settings");
  assertIncludes(source, "/api/v1/admin/schedule");
  assertIncludes(source, "/api/v1/admin/staff");
  assertIncludes(source, "/api/v1/admin/analytics?range=");
  assertIncludes(source, "/api/v1/admin/audit");
  assertIncludes(source, "return sectionFromToken(await authenticate(), tab, options)");
  assertMissingEndpointIs404Only(source);
});

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assertIncludes(source, needle) {
  assert.ok(source.includes(needle), `expected source to include ${needle}`);
}

function assertMissingEndpointIs404Only(source) {
  assert.match(
    source,
    /function isMissingEndpoint\([^)]*\)[\s\S]*?status[^=]*===\s*404/,
    "bootstrap fallback must only catch missing endpoint 404, not broad server/auth failures",
  );
}
