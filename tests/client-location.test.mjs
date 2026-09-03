import assert from "node:assert/strict";
import test from "node:test";
import { requestCityLocation, cityLocationFailure, cityLocationHelpCopy, canOpenCityLocationSettings, openCityLocationSettings } from "../apps/client/src/city-location.ts";

test("settings only open on an explicit call for an initialized, denied permission", () => {
  let opened = 0;
  const manager = { isInited: true, isAccessRequested: true, isAccessGranted: false, openSettings() { opened++; } };
  assert.equal(canOpenCityLocationSettings(manager), true);
  assert.equal(opened, 0);
  assert.equal(openCityLocationSettings(manager), true);
  assert.equal(opened, 1);
  for (const unsupported of [undefined, {}, { ...manager, isInited: false }, { ...manager, isAccessRequested: false }, { ...manager, isAccessGranted: true }]) {
    assert.equal(openCityLocationSettings(unsupported), false);
  }
  assert.equal(openCityLocationSettings({ ...manager, openSettings() { throw new Error("unsupported"); } }), false);
  assert.equal(opened, 1);
});

test("failed city checks get relevant help, never permission instructions for outside area", () => {
  assert.equal(cityLocationFailure({ status: "VERIFIED" }), null);
  assert.equal(cityLocationFailure({ status: "REJECTED", rejection_reason: "OUTSIDE_CASH_AREA" }), "outside");
  for (const rejection_reason of ["LOCATION_INACCURATE", "LOCATION_ACCURACY_MISSING"]) {
    assert.equal(cityLocationFailure({ status: "REJECTED", rejection_reason }), "inaccurate");
  }
  assert.equal(cityLocationFailure({ status: "EXPIRED" }), "retry");
  for (const locale of ["ru", "sr", "en"]) {
    const copy = cityLocationHelpCopy(locale);
    assert.ok(copy.permissionButton);
    assert.ok(copy.permissionDescription);
    assert.ok(copy.permissionFailed);
    for (const reason of ["denied", "unavailable", "timeout", "inaccurate", "outside", "retry"]) {
      assert.ok(copy.messages[reason]);
    }
  }
});

test("a missing fix with granted access does not tell users permission is denied", async () => {
  assert.equal((await requestCityLocation({ isInited: true, isAccessGranted: true, init() {}, getLocation(cb) { cb(null); } })).status, "unavailable");
});

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
