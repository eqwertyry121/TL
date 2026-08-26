import assert from "node:assert/strict";
import test from "node:test";

import {
  clearCart,
  loadCachedPublicData,
  loadCart,
  loadCheckoutDraft,
  loadLocale,
  pendingIdempotencyKey,
  saveCachedPublicData,
  saveCart,
  saveCheckoutDraft,
  saveCheckoutProgress,
  saveLocale,
} from "../apps/client/src/storage.ts";

test("public menu cache is isolated per locale and clears the legacy shared key", () => {
  const env = installLocalStorage();
  try {
    localStorage.setItem("tk-client-public-menu-v2", JSON.stringify({ version: 2 }));
    saveCachedPublicData("ru", 11, [{ id: "ru-menu" }]);
    saveCachedPublicData("sr", 22, [{ id: "sr-menu" }]);

    assert.equal(localStorage.getItem("tk-client-public-menu-v2"), null);
    assert.equal(loadCachedPublicData("ru")?.menu_revision, 11);
    assert.equal(loadCachedPublicData("ru")?.categories[0]?.id, "ru-menu");
    assert.equal(loadCachedPublicData("sr")?.menu_revision, 22);
    assert.equal(loadCachedPublicData("sr")?.categories[0]?.id, "sr-menu");
  } finally {
    env.restore();
  }
});

test("public menu cache safely removes corrupt, old-schema and expired entries", () => {
  const env = installLocalStorage();
  try {
    localStorage.setItem("tk.menu.v2.ru", "{not json");
    assert.equal(loadCachedPublicData("ru"), null);
    assert.equal(localStorage.getItem("tk.menu.v2.ru"), null);

    localStorage.setItem("tk.menu.v2.ru", JSON.stringify({
      version: 1,
      locale: "ru",
      menu_revision: 1,
      categories: [],
      savedAt: new Date().toISOString(),
    }));
    assert.equal(loadCachedPublicData("ru"), null);
    assert.equal(localStorage.getItem("tk.menu.v2.ru"), null);

    localStorage.setItem("tk.menu.v2.ru", JSON.stringify({
      version: 2,
      locale: "ru",
      menu_revision: 1,
      categories: [],
      savedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    }));
    assert.equal(loadCachedPublicData("ru"), null);
    assert.equal(localStorage.getItem("tk.menu.v2.ru"), null);
  } finally {
    env.restore();
  }
});

test("client storage helpers survive unavailable browser storage", () => {
  const env = installThrowingStorage();
  try {
    assert.deepEqual(loadCart(), { version: 1, lines: {} });
    assert.doesNotThrow(() => saveCart({ version: 1, lines: {} }));
    assert.doesNotThrow(() => clearCart());
    assert.deepEqual(loadCheckoutDraft(), {
      phone: "",
      street: "",
      houseNumber: "",
      entrance: "",
      comment: "",
      fulfillmentType: "delivery",
      pickupAt: "",
      deliveryTimeMode: "ASAP",
      deliveryRequestedAt: "",
    });
    assert.doesNotThrow(() => saveCheckoutDraft({
      phone: "",
      street: "",
      houseNumber: "",
      entrance: "",
      comment: "",
      fulfillmentType: "delivery",
      pickupAt: "",
      deliveryTimeMode: "ASAP",
      deliveryRequestedAt: "",
    }));
    assert.doesNotThrow(() => saveCheckoutProgress("", null, null));
    assert.equal(loadLocale("ru"), "ru");
    assert.doesNotThrow(() => saveLocale("sr"));
    assert.equal(loadCachedPublicData("ru"), null);
    assert.match(pendingIdempotencyKey(), /^[0-9a-f-]{36}$/i);
  } finally {
    env.restore();
  }
});

function installLocalStorage() {
  const previous = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
  return {
    restore() {
      if (previous === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previous;
      }
    },
  };
}

function installThrowingStorage() {
  const previousLocal = globalThis.localStorage;
  const previousSession = globalThis.sessionStorage;
  const throwingStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("storage unavailable");
    },
    removeItem() {
      throw new Error("storage unavailable");
    },
    key() {
      throw new Error("storage unavailable");
    },
    get length() {
      throw new Error("storage unavailable");
    },
  };
  globalThis.localStorage = throwingStorage;
  globalThis.sessionStorage = throwingStorage;
  return {
    restore() {
      if (previousLocal === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previousLocal;
      }
      if (previousSession === undefined) {
        delete globalThis.sessionStorage;
      } else {
        globalThis.sessionStorage = previousSession;
      }
    },
  };
}
