import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const apps = ["client", "kitchen", "courier", "admin"];

for (const app of apps) {
  test(`${app} protects the React root with an error boundary`, () => {
    const main = readFileSync(`apps/${app}/src/main.tsx`, "utf8");
    const boundary = readFileSync(`apps/${app}/src/ErrorBoundary.tsx`, "utf8");

    assert.match(main, /import \{ ErrorBoundary \} from "\.\/ErrorBoundary"/);
    assert.match(main, /<ErrorBoundary>[\s\S]*<App \/>[\s\S]*<\/ErrorBoundary>/);
    assert.match(boundary, /getDerivedStateFromError/);
    assert.match(boundary, /componentDidCatch/);
    assert.match(boundary, /window\.location\.reload\(\)/);
    assert.doesNotMatch(boundary, /console\.error\([^)]*,/);
  });
}
