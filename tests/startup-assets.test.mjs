import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apps = ["client", "kitchen", "courier", "admin"];
const telegramSdkURL = "https://telegram.org/js/telegram-web-app.js";
const apiOrigin = "https://api.takolako.site";
const telegramOrigin = "https://telegram.org";

test("app HTML keeps startup network hints and Telegram SDK non-blocking", () => {
  for (const app of apps) {
    const html = readSource(`apps/${app}/index.html`);
    const telegramSdkTag = findTags(html, "script").find((tag) => hasAttrValue(tag, "src", telegramSdkURL));

    assert.ok(telegramSdkTag, `${app} index.html must load Telegram WebApp SDK`);
    assert.ok(hasBooleanAttr(telegramSdkTag, "defer"), `${app} Telegram SDK script must use defer`);

    assert.ok(
      findTags(html, "link").some(
        (tag) =>
          hasAttrToken(tag, "rel", "preconnect") &&
          hasAttrValue(tag, "href", apiOrigin) &&
          hasBooleanAttr(tag, "crossorigin"),
      ),
      `${app} index.html must preconnect to the API origin with crossorigin`,
    );
    assert.ok(
      findTags(html, "link").some(
        (tag) => hasAttrToken(tag, "rel", "preconnect") && hasAttrValue(tag, "href", telegramOrigin),
      ),
      `${app} index.html must preconnect to Telegram before loading the SDK`,
    );

    assertNoExternalFonts(html, `apps/${app}/index.html`);
    assertNoImagePreloads(html, `apps/${app}/index.html`);
  }
});

test("critical app CSS does not import blocking external font stylesheets", () => {
  for (const app of apps) {
    const css = readSource(`apps/${app}/src/styles.css`);

    assertNoExternalFonts(css, `apps/${app}/src/styles.css`);
    assert.doesNotMatch(css, /@import\b/i, `${app} critical CSS must not use @import`);
  }
});

test("client root fallback with Telegram initData does not trigger a second document load", () => {
  const source = readSource("apps/client/src/App.tsx");
  const appBody = sliceBetween(source, "export function App()", "function ClientMiniApp()");

  assertIncludes(appBody, "if (rawInitData()) return <ClientMiniApp />;");
  assertNotIncludes(source, "window.location.replace(`/main");
  assertNotIncludes(source, "function TelegramMainRedirect");
});

test("client Main Mini App deep link can open table booking directly", () => {
  const appSource = readSource("apps/client/src/App.tsx");
  const telegramSource = readSource("apps/client/src/telegram.ts");
  const routeSource = readSource("apps/client/src/route.ts");

  assertIncludes(appSource, "routeFromStartParam(currentRoute(), miniAppStartParam())");
  assertIncludes(telegramSource, "initDataUnsafe?.start_param");
  assertIncludes(telegramSource, 'get("tgWebAppStartParam")');
  assertIncludes(routeSource, 'startParam === "booking"');
  assertIncludes(routeSource, 'return { name: "booking" }');
});

test("client shows combos inline without a separate transition control", () => {
  const source = readSource("apps/client/src/App.tsx");
  const styles = readSource("apps/client/src/styles.css");
  const menuBody = sliceBetween(source, "function Menu(", "function AddToOrder(");

  assertNotIncludes(menuBody, "showCombos");
  assertNotIncludes(menuBody, "combo-promo");
  assertNotIncludes(styles, ".combo-promo");
  assertIncludes(menuBody, 'className="menu-group-head"');
  assertIncludes(menuBody, 'combo ? " combo-card" : ""');
  assertIncludes(menuBody, "items.length");
  assertIncludes(menuBody, "combo-pages");
  assertIncludes(menuBody, "scrollTo");
  assertIncludes(menuBody, 'index === comboIndex ? "active" : ""');
  assertNotIncludes(menuBody, "combo-nav");
  assertNotIncludes(menuBody, "листайте карточки");
  assertIncludes(menuBody, "combo-contents");
  assertIncludes(menuBody, 'description.split(" • ")');
  assertIncludes(menuBody, 'part.split(" × ")');
  assertNotIncludes(menuBody, "contentsLabel");
  assertNotIncludes(menuBody, "В составе");
  assertIncludes(styles, ".combo-contents li");
  assertIncludes(styles, "align-content: start");
  assertIncludes(styles, "row-gap: 0.62rem");
  assertIncludes(styles, ".combo-strip .dish-body");
  assertIncludes(styles, "grid-template-rows: auto 1fr auto auto");
  assertIncludes(styles, ".combo-strip .dish-card");
  assertNotIncludes(sliceBetween(styles, ".combo-strip .dish-body", ".combo-strip .link-title"), "height: 100%");
  assertIncludes(menuBody, "showBadge={!combo}");
  assertIncludes(menuBody, "{!combo && <span>{item.weight_text}</span>}");
  assertIncludes(styles, ".combo-strip .link-title");

  const fixtures = readSource("apps/client/src/fixtures.ts");
  assertIncludes(fixtures, 'title: "Комбо"');
  assertIncludes(fixtures, "хачапури по-мегрельски");
  assertIncludes(fixtures, "хачапури по-аджарски");
  for (const title of ["FULL HOUSE", "ONE & DONE", "DOUBLE", "SWEET DUO", "VEGGIE"]) assertIncludes(fixtures, title);
  for (const singleItem of ["1 × хачапури по-мегрельски", "1 × грузинский салат", "1 × Borjomi 0,5 л"]) assertIncludes(fixtures, singleItem);
  for (const price of ["6890", "2490", "5690", "2290", "2110"]) assertIncludes(fixtures, price);
  assertIncludes(fixtures, 'staticMedia("full-house-card")');
  for (const photo of ["one-and-done-card", "double-card", "sweet-duo-card", "veggie-card"]) assertIncludes(fixtures, `staticMedia("${photo}")`);
  assertIncludes(fixtures, "import.meta.env.BASE_URL");
  assertIncludes(fixtures, '"Натакхари с грушей 1 л"');
  assertIncludes(fixtures, "910");
  assertNotIncludes(fixtures, '"24 хинкали + хачапури + напиток"');
});

test("client legal pages stay available without Telegram authentication", () => {
  const appSource = readSource("apps/client/src/App.tsx");
  const routeSource = readSource("apps/client/src/route.ts");
  const legalSource = readSource("apps/client/src/legal.tsx");
  const appBody = sliceBetween(appSource, "export function App()", "function ClientMiniApp()");

  assertIncludes(appBody, "if (isPublicInformationRoute(entryRoute)) return <ClientMiniApp />;");
  for (const route of ["terms", "returns", "privacy"]) {
    assertIncludes(routeSource, `if (parts[0] === "${route}")`);
    assertIncludes(legalSource, `route.name === "${route}"`);
  }
  assertIncludes(legalSource, "Telegram initData is verified by the server and is not written to application logs.");
  assertIncludes(legalSource, "Kartična porudžbina smatra se plaćenom samo posle potvrde pružaoca platnih usluga.");
});

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function findTags(source, tagName) {
  return Array.from(source.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "gi")), (match) => match[0]);
}

function hasBooleanAttr(tag, name) {
  return new RegExp(`\\s${escapeRegExp(name)}(?:\\s|=|/?>)`, "i").test(tag);
}

function hasAttrToken(tag, name, token) {
  const value = getAttrValue(tag, name);

  return value
    .split(/\s+/)
    .filter(Boolean)
    .some((part) => part.toLowerCase() === token.toLowerCase());
}

function hasAttrValue(tag, name, expected) {
  return getAttrValue(tag, name) === expected;
}

function getAttrValue(tag, name) {
  const match = tag.match(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])(.*?)\\1`, "i"));

  return match?.[2] ?? "";
}

function assertNoExternalFonts(source, label) {
  assert.doesNotMatch(source, /fonts\.googleapis\.com|fonts\.gstatic\.com/i, `${label} must not load Google Fonts`);
  assert.doesNotMatch(
    source,
    /<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']https?:\/\//i,
    `${label} must not load blocking external stylesheets`,
  );
}

function assertNoImagePreloads(source, label) {
  const hasPreloadedImage = findTags(source, "link").some(
    (tag) => hasAttrToken(tag, "rel", "preload") && hasAttrValue(tag, "as", "image"),
  );

  assert.ok(!hasPreloadedImage, `${label} must not preload menu/media images in the startup HTML`);
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing start marker: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing end marker: ${endNeedle}`);
  return source.slice(start, end);
}

function assertIncludes(source, needle) {
  assert.ok(source.includes(needle), `expected source to include ${needle}`);
}

function assertNotIncludes(source, needle) {
  assert.ok(!source.includes(needle), `expected source not to include ${needle}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
