import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectLegacyPublicContract,
  validateLegacyPublicContractEnv,
} from "../scripts/legacy-public-contract.mjs";

test("legacy public contract wrapper requires an explicit staging or production URL", () => {
  assert.match(validateLegacyPublicContractEnv({}), /PERF_BASE_URL is required/);
  assert.match(validateLegacyPublicContractEnv({ PERF_BASE_URL: "http://localhost:8080" }), /not localhost/);
  assert.equal(validateLegacyPublicContractEnv({ PERF_BASE_URL: "https://api.takolako.site" }), "");
});

test("legacy public contract passes when old public frontend endpoints stay compatible", async () => {
  const results = await inspectLegacyPublicContract({
    baseURL: "https://api.takolako.site",
    fetchImpl: routeFetch({
      "/api/v1/runtime": jsonResponse(runtimeBody()),
      "/api/v1/menu?locale=ru": jsonResponse(menuBody()),
    }),
  });

  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.ok, true, `${result.endpoint}: ${result.reasons.join(", ")}`);
  }
});

test("legacy public contract reports schema drift that would break previous frontend", async () => {
  const results = await inspectLegacyPublicContract({
    baseURL: "https://api.takolako.site",
    fetchImpl: routeFetch({
      "/api/v1/runtime": jsonResponse({
        accepting_orders: "yes",
        flat_delivery_fee_minor: 0,
        currency: "RSD",
      }),
      "/api/v1/menu?locale=ru": jsonResponse({
        categories: [{ id: "cat_1", title: "Pizza", sort_order: 1 }],
      }),
    }),
  });

  assert.equal(results.some((result) => !result.ok), true);
  assert.ok(results[0].reasons.includes("missing_server_time_string"));
  assert.ok(results[0].reasons.includes("missing_accepting_orders_boolean"));
  assert.ok(results[1].reasons.includes("category_0_missing_items_array"));
});

function routeFetch(routes) {
  return async (url) => {
    const parsed = new URL(url);
    const route = routes[`${parsed.pathname}${parsed.search}`];
    assert.ok(route, `unexpected fetch route: ${parsed.pathname}${parsed.search}`);
    return route;
  };
}

function jsonResponse(body, status = 200) {
  return {
    status,
    headers: new Headers({ "content-type": "application/json; charset=utf-8" }),
    text: async () => JSON.stringify(body),
  };
}

function runtimeBody() {
  return {
    server_time: "2026-08-13T12:00:00Z",
    accepting_orders: true,
    reason: "open",
    day_off_banner: "ВЫХОДНОЙ",
    flat_delivery_fee_minor: 0,
    currency: "RSD",
    enabled_payments: ["cash"],
    supported_locales: ["ru", "sr", "en"],
    support_text: "@Tako_Lako",
    terms_url: "https://takolako.site/terms",
  };
}

function menuBody() {
  return {
    categories: [
      {
        id: "cat_1",
        title: "Pizza",
        sort_order: 1,
        items: [
          {
            id: "item_1",
            category_id: "cat_1",
            title: "Margarita",
            price_minor: 900,
            currency: "RSD",
            photo_path: "",
            sort_order: 1,
          },
        ],
      },
    ],
  };
}
