import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationsDir = new URL("../backend/migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

test("migrations are numbered contiguously and keep stable names", () => {
  assert.ok(migrationFiles.length > 0, "expected at least one migration file");

  const seen = new Set();
  for (const [index, file] of migrationFiles.entries()) {
    const match = file.match(/^(\d{3})_[a-z0-9_]+\.sql$/);
    assert.ok(match, `${file} must use NNN_snake_case.sql`);

    const version = Number(match[1]);
    assert.equal(version, index + 1, `${file} must be migration ${(index + 1).toString().padStart(3, "0")}`);
    assert.equal(seen.has(version), false, `duplicate migration version ${match[1]}`);
    seen.add(version);
  }
});

test("optimization migrations keep required indexes and additive schema", () => {
  const indexes = readMigration("011_optimization_indexes.sql");
  const media = readMigration("012_menu_media_metadata.sql");
  const revisions = readMigration("013_menu_revisions.sql");

  for (const pattern of [
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_orders_created_desc\s+ON\s+orders\s*\(\s*created_at\s+DESC\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_orders_phone_hash\s+ON\s+orders\s*\(\s*phone_hash\s*\)\s+WHERE\s+phone_hash\s+<>\s+''/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_order_items_order_sort\s+ON\s+order_items\s*\(\s*order_id\s*,\s*sort_order\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_order_events_order_created\s+ON\s+order_events\s*\(\s*order_id\s*,\s*created_at\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_audit_log_created\s+ON\s+audit_log\s*\(\s*created_at\s+DESC\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_sessions_expires\s+ON\s+sessions\s*\(\s*expires_at\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_calculation_tokens_expires\s+ON\s+calculation_tokens\s*\(\s*expires_at\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_idempotency_keys_expires\s+ON\s+idempotency_keys\s*\(\s*expires_at\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_notification_jobs_done_updated\s+ON\s+notification_jobs\s*\(\s*status\s*,\s*updated_at\s*\)\s+WHERE\s+status\s+IN\s+\(\s*'sent'\s*,\s*'failed'\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_cash_location_challenges_expires\s+ON\s+cash_location_challenges\s*\(\s*expires_at\s*\)/i,
  ]) {
    assert.match(compactSql(indexes), pattern);
  }

  assert.doesNotMatch(indexes, /\bCONCURRENTLY\b/i, "app migrations run in a transaction; use the runbook for production CONCURRENTLY indexes if needed");

  for (const pattern of [
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+menu_media\s*\(/i,
    /display_path\s+text\s+PRIMARY\s+KEY\s+CHECK\s*\(\s*display_path\s+LIKE\s+'\/media\/menu\/%'\s*\)/i,
    /thumbnail_path\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*thumbnail_path\s+LIKE\s+'\/media\/menu\/%'\s*\)/i,
    /display_width\s+integer\s+NOT\s+NULL\s+CHECK\s*\(\s*display_width\s+>\s+0\s*\)/i,
    /display_height\s+integer\s+NOT\s+NULL\s+CHECK\s*\(\s*display_height\s+>\s+0\s*\)/i,
    /display_bytes\s+integer\s+NOT\s+NULL\s+CHECK\s*\(\s*display_bytes\s+>=\s+0\s*\)/i,
    /thumbnail_width\s+integer\s+NOT\s+NULL\s+CHECK\s*\(\s*thumbnail_width\s+>\s+0\s*\)/i,
    /thumbnail_height\s+integer\s+NOT\s+NULL\s+CHECK\s*\(\s*thumbnail_height\s+>\s+0\s*\)/i,
    /thumbnail_bytes\s+integer\s+NOT\s+NULL\s+CHECK\s*\(\s*thumbnail_bytes\s+>=\s+0\s*\)/i,
    /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_menu_media_created\s+ON\s+menu_media\s*\(\s*created_at\s+DESC\s*\)/i,
  ]) {
    assert.match(compactSql(media), pattern);
  }

  assert.match(
    compactSql(revisions),
    /ALTER\s+TABLE\s+app_settings\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+menu_revision\s+bigint\s+NOT\s+NULL\s+DEFAULT\s+1/i,
  );
  assert.match(compactSql(revisions), /SET\s+menu_revision\s+=\s+GREATEST\s*\(\s*menu_revision\s*,\s*1\s*\)/i);
});

test("migrations avoid destructive domain-data operations", () => {
  const forbidden = [
    { name: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
    { name: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
    {
      name: "DELETE FROM domain data",
      pattern: /\bDELETE\s+FROM\s+(orders|order_items|order_events|menu_items|categories|users|staff|sessions|payment_attempts|cash_location_challenges|notification_jobs|app_settings|audit_log)\b/i,
    },
    {
      name: "DROP COLUMN on domain tables",
      pattern: /\bALTER\s+TABLE\s+(orders|order_items|order_events|menu_items|categories|users|staff|sessions|payment_attempts|cash_location_challenges|notification_jobs|app_settings|audit_log)\b[\s\S]*?\bDROP\s+COLUMN\b/i,
    },
  ];

  const violations = [];
  for (const file of migrationFiles) {
    const source = readMigration(file);
    for (const { name, pattern } of forbidden) {
      if (pattern.test(source)) violations.push(`${file}: ${name}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("delivery scheduling uses one order per thirty-minute slot", () => {
  const source = compactSql(readMigration("050_fix_delivery_slot_capacity.sql"));
  assert.match(source, /delivery_min_lead_minutes\s*=\s*30/i);
  assert.match(source, /delivery_slot_minutes\s*=\s*30/i);
  assert.match(source, /delivery_max_orders_per_slot\s*=\s*1/i);
  assert.match(source, /delivery_last_target_time\s*=\s*'21:00'/i);
});

function readMigration(file) {
  return readFileSync(new URL(file, migrationsDir), "utf8");
}

function compactSql(source) {
  return source.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
}
