import assert from "node:assert/strict";
import test from "node:test";

import { startVisiblePolling } from "../../packages/api-client/src/polling.ts";

test("visible polling never overlaps and keeps the regular interval after completion", async () => {
  const env = installFakeBrowser();
  const restoreRandom = fixedRandom();
  try {
    const signals = [];
    let resolveFirst;
    const stop = startVisiblePolling((signal) => {
      signals.push(signal);
      if (signals.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve();
    }, 1000, true);

    await env.advance(0);
    assert.equal(signals.length, 1);

    env.dispatch(window, "focus");
    env.dispatch(window, "pageshow");
    env.dispatch(document, "visibilitychange");
    await env.advance(5000);
    assert.equal(signals.length, 1, "focus/pageshow while in-flight must not create a duplicate request");

    resolveFirst();
    await env.flush();
    await env.advance(999);
    assert.equal(signals.length, 1);
    await env.advance(1);
    assert.equal(signals.length, 2);

    stop();
  } finally {
    restoreRandom();
    env.restore();
  }
});

test("hidden document suppresses polling and visible resume is immediate but coalesced", async () => {
  const env = installFakeBrowser({ visibilityState: "hidden" });
  const restoreRandom = fixedRandom();
  try {
    let calls = 0;
    const stop = startVisiblePolling(() => {
      calls += 1;
      return Promise.resolve();
    }, 10000, true);

    await env.advance(60000);
    assert.equal(calls, 0, "hidden document must not poll");

    env.setVisibility("visible");
    env.dispatch(document, "visibilitychange");
    assert.equal(calls, 1, "resume should refresh immediately, not after the base interval");

    env.dispatch(window, "focus");
    env.dispatch(window, "pageshow");
    await env.advance(499);
    assert.equal(calls, 1, "resume/focus/pageshow within 500 ms should be coalesced");

    await env.advance(1);
    env.dispatch(window, "focus");
    assert.equal(calls, 2, "a later focus after the coalescing window may refresh again");

    stop();
  } finally {
    restoreRandom();
    env.restore();
  }
});

test("errors back off and successful polling resets to the base interval", async () => {
  const env = installFakeBrowser();
  const restoreRandom = fixedRandom();
  try {
    let calls = 0;
    const stop = startVisiblePolling(() => {
      calls += 1;
      if (calls <= 2) return Promise.reject(new Error("temporary offline"));
      return Promise.resolve();
    }, 1000, true);

    await env.advance(0);
    assert.equal(calls, 1);
    await env.flush();

    await env.advance(4999);
    assert.equal(calls, 1);
    await env.advance(1);
    assert.equal(calls, 2);
    await env.flush();

    await env.advance(9999);
    assert.equal(calls, 2);
    await env.advance(1);
    assert.equal(calls, 3);
    await env.flush();

    await env.advance(999);
    assert.equal(calls, 3);
    await env.advance(1);
    assert.equal(calls, 4, "success should reset the next delay to the base interval");

    stop();
  } finally {
    restoreRandom();
    env.restore();
  }
});

test("stop aborts the active request and removes scheduled polling", async () => {
  const env = installFakeBrowser();
  const restoreRandom = fixedRandom();
  try {
    let activeSignal;
    let calls = 0;
    const stop = startVisiblePolling((signal) => {
      calls += 1;
      activeSignal = signal;
      return new Promise(() => undefined);
    }, 1000, true);

    await env.advance(0);
    assert.equal(calls, 1);
    assert.equal(activeSignal.aborted, false);

    stop();
    assert.equal(activeSignal.aborted, true);

    await env.advance(60000);
    env.dispatch(window, "focus");
    assert.equal(calls, 1);
  } finally {
    restoreRandom();
    env.restore();
  }
});

function installFakeBrowser({ visibilityState = "visible" } = {}) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  let now = 0;
  let nextTimerId = 1;
  const timers = new Map();

  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();
  Object.defineProperty(documentTarget, "visibilityState", {
    get: () => visibilityState,
  });

  windowTarget.setTimeout = (callback, delay = 0) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { at: now + Number(delay), callback });
    return id;
  };
  windowTarget.clearTimeout = (id) => {
    timers.delete(id);
  };

  globalThis.window = windowTarget;
  globalThis.document = documentTarget;

  return {
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const next = nextDueTimer(timers, target);
        if (!next) break;
        now = next.at;
        timers.delete(next.id);
        next.callback();
        await this.flush();
      }
      now = target;
      await this.flush();
    },
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
    dispatch(target, type) {
      target.dispatchEvent({ type });
    },
    setVisibility(next) {
      visibilityState = next;
    },
    restore() {
      timers.clear();
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    },
  };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) {
        listener(event);
      }
    },
  };
}

function nextDueTimer(timers, target) {
  let next;
  for (const [id, timer] of timers) {
    if (timer.at > target) continue;
    if (!next || timer.at < next.at || (timer.at === next.at && id < next.id)) {
      next = { id, ...timer };
    }
  }
  return next;
}

function fixedRandom() {
  const previousRandom = Math.random;
  Math.random = () => 0.5;
  return () => {
    Math.random = previousRandom;
  };
}
