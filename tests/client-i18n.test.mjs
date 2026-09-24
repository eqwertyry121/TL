import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { clientCopy, localizedWeightText } from "../apps/client/src/client-copy.ts";

test("client copy covers the primary customer flow in every locale", () => {
  const expected = {
    ru: ["В корзину", "Корзина пуста", "Дозаказ", "Показать ещё"],
    sr: ["U korpu", "Korpa je prazna", "Dodatna porudžbina", "Prikaži još"],
    en: ["Add to cart", "Cart is empty", "Add to order", "Show more"],
  };

  for (const [locale, values] of Object.entries(expected)) {
    const copy = clientCopy(locale);
    assert.deepEqual(
      [copy.addToCart, copy.emptyCart, copy.addition, copy.showMore],
      values,
      `${locale} must have customer-facing copy`,
    );
  }
});

test("delivery closure notice is localized and limited to the home screen when delivery is disabled", async () => {
  const expected = {
    ru: "Приём заказов на доставку временно закрыт. Приходите к нам в кафе или заказывайте через другие службы доставки.",
    sr: "Prijem porudžbina za dostavu je privremeno obustavljen. Posetite nas u restoranu ili naručite preko drugih dostavnih službi.",
    en: "Delivery orders are temporarily unavailable. Visit us at the cafe or order through other delivery services.",
  };
  for (const [locale, text] of Object.entries(expected)) {
    assert.equal(clientCopy(locale).deliveryTemporarilyClosed, text);
  }

  const source = await readFile(new URL("../apps/client/src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /route\.name === "menu" && data\.runtime\?\.delivery_enabled === false[\s\S]*?ui\.deliveryTemporarilyClosed/);
});

test("shared menu portion labels follow the selected locale", () => {
  assert.equal(localizedWeightText("на 4–5 человек", "sr"), "za 4–5 osoba");
  assert.equal(localizedWeightText("на 4–5 человек", "en"), "serves 4–5");
  assert.equal(localizedWeightText("1 шт.", "sr"), "1 kom.");
  assert.equal(localizedWeightText("300 гр", "en"), "300 g");
  assert.equal(localizedWeightText("0.5 л", "en"), "0.5 l");
});

test("customer screens do not render known Russian-only controls directly", async () => {
  const source = await readFile(new URL("../apps/client/src/App.tsx", import.meta.url), "utf8");
  const forbidden = [
    />\s*В корзину/,
    />\s*Добавить к заказу/,
    />\s*Показать ещё/,
    />\s*Блюдо недоступно/,
    /aria-label="Назад"/,
    /aria-label="Минус"/,
    /aria-label="Плюс"/,
  ];

  for (const pattern of forbidden) assert.doesNotMatch(source, pattern);

  const directCyrillicJsx = [...source.matchAll(/>\s*([^<{\n]*[А-Яа-яЁё][^<{\n]*)\s*</g)].map((match) => match[1].trim());
  assert.deepEqual(directCyrillicJsx, [], `direct Russian JSX bypasses locale copy: ${directCyrillicJsx.join(" | ")}`);
});
