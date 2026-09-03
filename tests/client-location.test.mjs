import assert from "node:assert/strict";
import test from "node:test";
import { requestCityLocation } from "../apps/client/src/city-location.ts";

test("native location initializes and requests once", async () => {
  let requests = 0;
  const result = await requestCityLocation({
    init(callback) { callback(); },
    getLocation(callback) { requests++; callback({ latitude: 45.25, longitude: 19.84 }); },
  });
  assert.equal(result.status, "success");
  assert.equal(requests, 1);
});

test("unsupported, denied and hanging devices finish without opening a bot", async () => {
  assert.equal((await requestCityLocation(undefined)).status, "unavailable");
  assert.equal((await requestCityLocation({ isInited: true, init() {}, getLocation(cb) { cb(null); } })).status, "denied");
  assert.equal((await requestCityLocation({ init() {}, getLocation() {} }, 10)).status, "timeout");
});

test("invalid coordinates and exceptions do not become successful verification", async () => {
  const manager = { isInited: true, init() {}, getLocation(cb) { cb({ latitude: NaN, longitude: 19 }); } };
  assert.equal((await requestCityLocation(manager)).status, "unavailable");
  manager.getLocation = () => { throw new Error("not supported"); };
  assert.equal((await requestCityLocation(manager)).status, "unavailable");
});

test("late native callback cannot change a timed-out result", async () => {
  let callback;
  const result = await requestCityLocation({ isInited: true, init() {}, getLocation(cb) { callback = cb; } }, 10);
  callback({ latitude: 45.25, longitude: 19.84 });
  assert.equal(result.status, "timeout");
});

test("Telegram altitude and speed fields never reach the strict verification API", async () => {
  const result = await requestCityLocation({ isInited: true, init() {}, getLocation(cb) {
    cb({ latitude: 45.25, longitude: 19.84, horizontal_accuracy: 10, altitude: null, speed: 0, course: null, vertical_accuracy: null });
  } });
  assert.deepEqual(result, { status: "success", location: { latitude: 45.25, longitude: 19.84, horizontal_accuracy: 10 } });
});
