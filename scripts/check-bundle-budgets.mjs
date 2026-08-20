import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const apps = {
  client: { js: 105 * 1024, css: 10.5 * 1024 },
  admin: { js: 95 * 1024, css: 10 * 1024 },
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
