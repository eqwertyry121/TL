import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("maintenance never prunes containers or volumes", () => {
  const script = readFileSync("deploy/maintenance.sh", "utf8");
  assert.match(script, /docker builder prune/);
  assert.match(script, /docker builder prune --all --force >\/dev\/null/);
  assert.match(script, /docker image prune/);
  assert.doesNotMatch(script, /docker (?:system|container|volume) prune/);
  assert.doesNotMatch(script, /--volumes/);
});

test("health alerts use the deployed compose project and monitor disk", () => {
  const script = readFileSync("deploy/health-alert.sh", "utf8");
  assert.match(script, /COMPOSE_PROJECT_NAME="\$\{COMPOSE_PROJECT_NAME:-takolako\}"/);
  assert.match(script, /--project-name "\$COMPOSE_PROJECT_NAME"/);
  assert.match(script, /MIN_FREE_DISK_MB/);
  assert.match(script, /df -Pk/);
});
