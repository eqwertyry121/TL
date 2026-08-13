import assert from "node:assert/strict";
import test from "node:test";

import { buildGoArgs } from "../scripts/media-backfill.mjs";

test("media backfill wrapper strips npm separator before Go flags", () => {
  assert.deepEqual(buildGoArgs("true", ["--", "-limit=100"]), [
    "run",
    "./backend/cmd/mediabackfill",
    "-dry-run=true",
    "-limit=100",
  ]);
});

test("media backfill wrapper preserves direct Go flags", () => {
  assert.deepEqual(buildGoArgs("false", ["-limit=250"]), [
    "run",
    "./backend/cmd/mediabackfill",
    "-dry-run=false",
    "-limit=250",
  ]);
});
