import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("client menu images keep bounded responsive rendering attributes", () => {
  const source = readSource("apps/client/src/App.tsx");
  const visualBody = sliceBetween(source, "function DishVisual", "function Cart(");

  assertIncludes(visualBody, "srcSet={srcSet}");
  assertIncludes(visualBody, "sizes={hero ? \"(max-width: 720px) 100vw, 720px\" : \"(max-width: 720px) 45vw, 220px\"}");
  assertIncludes(visualBody, "width={dimensions?.width}");
  assertIncludes(visualBody, "height={dimensions?.height}");
  assertIncludes(visualBody, "loading={hero ? \"eager\" : \"lazy\"}");
  assertIncludes(visualBody, "decoding=\"async\"");
  assertIncludes(visualBody, "fetchPriority={hero ? \"high\" : undefined}");
  assertIncludes(visualBody, "menuPhotoURL(item.photo_path, item.version)");
  assertIncludes(source, 'v=${version}');
  assertIncludes(source, 'menuPhotoURL(variants.thumbnail?.url || "", item.version)');
  assertIncludes(source, "function menuPhotoDimensions(item: MenuItem, hero: boolean)");
});

test("admin menu preview uses thumbnail variants and keeps image geometry", () => {
  const appSource = readSource("apps/admin/src/App.tsx");
  const apiSource = readSource("apps/admin/src/api.ts");
  const formBody = sliceBetween(appSource, "function DishForm", "function OrdersTab(");
  const previewBody = sliceBetween(appSource, "function adminPhotoPreview", "function positiveDimension");

  assertIncludes(apiSource, "uploadMenuPhoto(token: string, file: File): Promise<MenuPhotoUploadResponse>");
  assertIncludes(apiSource, "photo_variants?: AdminMenuItem[\"photo_variants\"]");
  assertIncludes(formBody, "const preview = adminPhotoPreview(form)");
  assertIncludes(formBody, "photo_variants: photoVariants");
  assertIncludes(formBody, "photo_variants: undefined");
  assertIncludes(formBody, "src={preview.url}");
  assertIncludes(formBody, "width={preview.width}");
  assertIncludes(formBody, "height={preview.height}");
  assertIncludes(formBody, "loading=\"lazy\"");
  assertIncludes(formBody, "decoding=\"async\"");
  assertIncludes(previewBody, "item.photo_variants?.thumbnail?.url");
  assertIncludes(previewBody, "item.photo_variants.display");
});

function readSource(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
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
