import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";

const apps = {
  // Includes location selection, quarter-hour booking and the city permission flow.
  client: { js: 120 * 1024, css: 13 * 1024 },
  // Reservation editors load on demand; keep the former 102 KB limit for
  // the entry bundle while allowing the new forms in the total asset budget.
  admin: { js: 108 * 1024, css: 10 * 1024, entryJs: 102 * 1024 },
  kitchen: { js: 90 * 1024, css: 10 * 1024 },
  courier: { js: 90 * 1024, css: 10 * 1024 },
};

let failed = false;

for (const [app, budget] of Object.entries(apps)) {
  const assetsDir = join("apps", app, "dist", "assets");
  const files = listFiles(assetsDir);
  const js = gzipTotal(files.filter((file) => file.endsWith(".js")));
  const css = gzipTotal(files.filter((file) => file.endsWith(".css")));
  report(app, "js", js, budget.js);
  report(app, "css", css, budget.css);
  if (budget.entryJs) {
    const html = readFileSync(join("apps", app, "dist", "index.html"), "utf8");
    const moduleTag = html.match(/<script\b[^>]*\btype=["']module["'][^>]*>/i)?.[0] || "";
    const entryURL = moduleTag.match(/\bsrc=["']([^"']+\.js)["']/i)?.[1] || "";
    const entry = join(assetsDir, basename(entryURL));
    if (!entryURL || !files.includes(entry)) throw new Error(`${app} entry JavaScript was not found`);
    report(app, "entry js", gzipTotal([entry]), budget.entryJs);
  }
}
if (failed) process.exit(1);

function listFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function gzipTotal(files) {
  return files.reduce((sum, file) => sum + gzipSync(readFileSync(file), { level: 9 }).length, 0);
}

function report(app, type, actual, limit) {
  const actualKb = (actual / 1024).toFixed(2);
  const limitKb = (limit / 1024).toFixed(2);
  if (actual > limit) {
    failed = true;
    console.error(`${app} ${type} gzip ${actualKb} KB exceeds ${limitKb} KB`);
    return;
  }
  console.log(`${app} ${type} gzip ${actualKb} KB <= ${limitKb} KB`);
}
