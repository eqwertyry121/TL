import assert from "node:assert/strict";
import test from "node:test";

import { buildGoTestArgs, validatePostgresEnv } from "../scripts/go-postgres-test.mjs";

test("PostgreSQL Go test wrapper runs the full suite with fresh cache", () => {
  assert.deepEqual(buildGoTestArgs([]), ["test", "./...", "-count=1"]);
});

test("PostgreSQL Go test wrapper strips npm separator before Go flags", () => {
  assert.deepEqual(buildGoTestArgs(["--", "-run", "TestNotification"]), [
    "test",
    "./...",
    "-count=1",
    "-run",
    "TestNotification",
  ]);
});

test("PostgreSQL Go test wrapper requires explicit test DSN", () => {
  assert.match(validatePostgresEnv({}), /TK_TEST_POSTGRES_DSN is required/);
  assert.equal(validatePostgresEnv({ TK_TEST_POSTGRES_DSN: "postgres://postgres@127.0.0.1:5432/postgres?sslmode=disable" }), "");
});
