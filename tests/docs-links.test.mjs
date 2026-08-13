import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const markdownRoots = ["README.md", "docs"];
const markdownLinkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;

test("local markdown links resolve to existing files or directories", () => {
  const markdownFiles = markdownRoots.flatMap((root) => listMarkdownFiles(root));
  const broken = [];

  for (const file of markdownFiles) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(markdownLinkPattern)) {
      const target = normalizeTarget(match[1]);
      if (!target || isExternalOrAnchor(target)) continue;

      const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
      if (!withoutFragment) continue;

      const resolved = resolve(dirname(file), decodeURI(withoutFragment));
      if (!existsSync(resolved)) broken.push(`${file} -> ${target}`);
    }
  }

  assert.deepEqual(broken, []);
});

function listMarkdownFiles(path) {
  const info = statSync(path);
  if (info.isFile()) return path.endsWith(".md") ? [path] : [];

  return readdirSync(path).flatMap((entry) => listMarkdownFiles(resolve(path, entry)));
}

function normalizeTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  const bracketed = trimmed.match(/^<([^>]+)>/);
  if (bracketed) return bracketed[1].trim();

  const titleStart = trimmed.search(/\s+["']/);
  return titleStart === -1 ? trimmed : trimmed.slice(0, titleStart).trim();
}

function isExternalOrAnchor(target) {
  return (
    target.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}
