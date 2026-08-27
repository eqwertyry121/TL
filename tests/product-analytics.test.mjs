import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../apps/client/src/product-analytics.ts", import.meta.url), "utf8");

test("client analytics captures every interactive click through one delegated listener", () => {
  assert.match(source, /document\.addEventListener\("click", onClick, true\)/);
  assert.match(source, /closest<HTMLElement>\("button, a, \[role='button'\]"\)/);
  assert.match(source, /name: "screen_view"/);
  assert.match(source, /name: "click"/);
});

test("client analytics batches events and never reads form values", () => {
  assert.match(source, /const maxBatchSize = 25/);
  assert.doesNotMatch(source, /\.value\b/);
  assert.doesNotMatch(source, /querySelector(All)?\([^)]*(input|textarea)/i);
});
