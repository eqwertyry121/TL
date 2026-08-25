import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePerformanceBeaconSampleRate,
  sanitizePerformanceBeaconText,
} from "../packages/api-client/src/performance.ts";

test("performance beacon sample rate is clamped to at most five percent", () => {
  assert.equal(normalizePerformanceBeaconSampleRate(undefined), 1);
  assert.equal(normalizePerformanceBeaconSampleRate("not-a-number"), 1);
  assert.equal(normalizePerformanceBeaconSampleRate("1"), 1);
  assert.equal(normalizePerformanceBeaconSampleRate("0.10"), 0.1);
  assert.equal(normalizePerformanceBeaconSampleRate("0.025"), 0.025);
  assert.equal(normalizePerformanceBeaconSampleRate("0"), 0);
  assert.equal(normalizePerformanceBeaconSampleRate("-1"), 0);
});

test("performance beacon text strips query and hash fragments before sanitizing", () => {
  assert.equal(sanitizePerformanceBeaconText("order?phone=+38160111222&token=secret", 64), "order");
  assert.equal(sanitizePerformanceBeaconText("menu#initData=secret", 64), "menu");
  assert.equal(sanitizePerformanceBeaconText("?phone=+38160111222", 64), "unknown");
  assert.equal(sanitizePerformanceBeaconText("admin/orders active", 64), "admin/orders_active");
  assert.equal(sanitizePerformanceBeaconText("a".repeat(100), 12), "a".repeat(12));
});
