import assert from "node:assert/strict";
import test from "node:test";

test("production role links retain the Mini App cache-busting query", async () => {
  globalThis.window = {
    location: {
      protocol: "https:",
      hostname: "takolako.site",
      origin: "https://takolako.site",
      search: "?v=release-123",
    },
  };
  const { roleUrl } = await import("../packages/api-client/src/role-switch.ts");
  assert.equal(roleUrl("KITCHEN"), "https://takolako.site/kitchen/?v=release-123");
  assert.equal(roleUrl("COURIER"), "https://takolako.site/courier/?v=release-123");
  delete globalThis.window;
});
