import { readFileSync } from "node:fs";

const checkedFiles = [
  "apps/client/src/fixtures.ts",
  "apps/admin/src/api.ts",
  "backend/migrations/002_seed.sql",
  "docs/menu-fixtures.csv",
];

const forbiddenPatterns = [
  { name: "fixture media reference", pattern: /\bfixtures\/[^"',)\s]+/g },
  { name: "external image URL", pattern: /\bhttps?:\/\/[^"',)\s]+\.(?:avif|gif|jpe?g|png|webp)\b/gi },
];
const violations = [];

for (const file of checkedFiles) {
  const content = readFileSync(file, "utf8");
  for (const { name, pattern } of forbiddenPatterns) {
    const matches = content.match(pattern) || [];
    for (const match of matches) {
      violations.push(`${file}: forbidden ${name} ${match}`);
    }
  }
  for (const photoPath of extractPhotoPaths(file, content)) {
    if (photoPath !== "" && !validPublishedMenuMediaPath(photoPath)) {
      violations.push(`${file}: invalid published photo_path ${photoPath}`);
    }
  }
}

if (violations.length) {
  console.error("Media references would produce slow, external or missing production images:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Media references OK: published menu photos are empty or optimized /media/menu/*.jpg paths.");

function extractPhotoPaths(file, content) {
  if (file.endsWith(".ts")) {
    return [...content.matchAll(/\bphoto_path:\s*["']([^"']*)["']/g)].map((match) => match[1]);
  }
  if (file.endsWith(".sql")) {
    return [...content.matchAll(/,\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*\d+\s*,/g)]
      .map((match) => match[1])
      .filter((value) => value === "" || looksLikeImageReference(value));
  }
  if (file.endsWith(".csv")) {
    const [headerLine, ...rows] = content.trimEnd().split(/\r?\n/);
    const headers = parseCSVLine(headerLine);
    const imageIndex = headers.indexOf("image_file");
    if (imageIndex === -1) return [];
    return rows.map((row) => parseCSVLine(row)[imageIndex] || "").filter((value) => value === "" || looksLikeImageReference(value));
  }
  return [];
}

function looksLikeImageReference(value) {
  return /(?:^|\/|\\)[^/\\]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(value) || value.startsWith("/media/menu/");
}

function validPublishedMenuMediaPath(value) {
  return /^\/media\/menu\/[A-Za-z0-9._-]+\.jpg$/.test(value) && !value.includes("..");
}

function parseCSVLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') {
      cell += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  return cells;
}
