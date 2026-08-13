import assert from "node:assert/strict";
import test from "node:test";

import { loadCachedPublicData, saveCachedPublicData } from "../apps/client/src/storage.ts";

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
