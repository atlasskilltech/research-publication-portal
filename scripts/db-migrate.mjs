/**
 * MySQL migration runner for the Research Publication Portal — explicit,
 * repeatable, non-destructive, and safe for a SHARED database.
 *
 *   npm run db:migrate                 # READ-ONLY: server check, collision preflight, pending list
 *   npm run db:migrate -- --apply      # apply every pending migration, in order (after preflight)
 *   npm run db:migrate -- --apply 002  # apply just one (must be pending)
 *   npm run db:migrate -- --rollback 003 --yes   # guarded `down` of the most recent migration
 *
 * Connection: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (+ DB_CONNECTION_LIMIT,
 * DB_QUEUE_LIMIT, DB_CONNECT_TIMEOUT_MS, DB_SSL, DB_SSL_CA). Never prints credentials.
 *
 * Shared-database rules:
 *  - Only `research_*` tables are ever created; nothing else is read beyond
 *    information_schema metadata, and nothing else is altered.
 *  - COLLISION PREFLIGHT (runs before any write, also in status mode): every table a
 *    pending migration would create must NOT already exist. If one does — e.g. an
 *    Employment Survey table that happens to use the same name — the run stops and
 *    nothing is changed. An existing `research_migrations` must have the expected
 *    shape (filename, applied_at).
 *  - History lives in `research_migrations` (created only by --apply).
 *
 * Each migration (database/migrations/NNN_*.mjs) exports `description`,
 * `tables()` (the tables it owns), `up(m)` and `down(m)`; every step is idempotent.
 * Refuses servers older than MySQL 8.0.16 / MariaDB 10.4.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createDb, createPool, dbConfigFromEnv } from "../lib/db/core.mjs";
import { T, TABLE_PREFIX, OWN_TABLES } from "../lib/db/tables.mjs";
import { helpers } from "../database/migrate-helpers.mjs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "database", "migrations");

function cmpVersion(a, b) {
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
}

export async function serverInfo(db) {
  const v = (await db.one("SELECT VERSION() AS v")).v;
  const isMaria = /mariadb/i.test(v);
  const nums = v.match(/(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
  const ok = isMaria ? cmpVersion(nums, [10, 4, 0]) >= 0 : cmpVersion(nums, [8, 0, 16]) >= 0;
  return { version: v, flavor: isMaria ? "MariaDB" : "MySQL", supported: ok };
}

export function listMigrations() {
  return readdirSync(dir).filter((f) => /^\d{3}_.+\.mjs$/.test(f)).sort();
}
const load = (f) => import(pathToFileURL(path.join(dir, f)).href);

async function existingTables(db) {
  return new Set((await db.query("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()")).map((r) => r.n));
}

/** READ-ONLY: applied filenames (empty set when the history table doesn't exist yet). */
export async function readHistory(db) {
  const tables = await existingTables(db);
  if (!tables.has(T.schemaMigrations)) return new Set();
  const cols = (await db.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [T.schemaMigrations])).map((r) => r.c);
  if (!cols.includes("filename") || !cols.includes("applied_at")) {
    throw new Error(`COLLISION: \`${T.schemaMigrations}\` exists but is not an RPP migration-history table (columns: ${cols.join(", ")}). Nothing changed.`);
  }
  return new Set((await db.query(`SELECT filename FROM \`${T.schemaMigrations}\``)).map((r) => r.filename));
}

/**
 * READ-ONLY collision preflight. → { ok, collisions[], foreignResearchTables[], otherTables, pending[] }
 * A collision = a table owned by a PENDING migration already exists.
 */
export async function preflight(db, { only } = {}) {
  const applied = await readHistory(db);
  const tables = await existingTables(db);
  const pending = listMigrations().filter((f) => !applied.has(f) && (!only || f.startsWith(only)));
  const collisions = [];
  for (const f of pending) {
    for (const t of (await load(f)).tables()) if (tables.has(t)) collisions.push(`${t} (would be created by ${f})`);
  }
  const foreignResearchTables = [...tables].filter((t) => t.startsWith(TABLE_PREFIX) && !OWN_TABLES.includes(t)).sort();
  const otherTables = [...tables].filter((t) => !t.startsWith(TABLE_PREFIX)).length;
  return { ok: collisions.length === 0, collisions, foreignResearchTables, otherTables, pending, applied };
}

async function createHistory(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS \`${T.schemaMigrations}\` (\`filename\` VARCHAR(255) NOT NULL, \`applied_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (\`filename\`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

/** Apply pending migrations (all, or one by number) after the collision preflight. Used by tests too. */
export async function migrate(db, { only: num, log = console.log } = {}) {
  const pf = await preflight(db, { only: num });
  if (!pf.ok) throw new Error(`COLLISION — these tables already exist and were not created by RPP migrations: ${pf.collisions.join("; ")}. Nothing changed.`);
  if (!pf.pending.length) return [];
  await createHistory(db);
  for (const f of pf.pending) {
    const mod = await load(f);
    log(`→ ${f}: ${mod.description || ""}`);
    await mod.up(helpers(db, log));
    await db.exec(`INSERT INTO \`${T.schemaMigrations}\` (filename, applied_at) VALUES (?, UTC_TIMESTAMP(3))`, [f]);
    log(`✓ ${f} recorded`);
  }
  return pf.pending;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rollback = args.includes("--rollback");
  const only = args.find((a) => /^\d{3}$/.test(a));
  const cfg = dbConfigFromEnv(process.env);
  const db = createDb(createPool({ ...cfg, connectionLimit: 1 }));
  try {
    const info = await serverInfo(db);
    console.log(`Server: ${info.flavor} ${info.version} — database \`${cfg.database}\` on ${cfg.host}:${cfg.port}`);
    if (!info.supported) {
      console.error("✗ Unsupported server version (need MySQL ≥ 8.0.16 or MariaDB ≥ 10.4). Nothing changed.");
      process.exitCode = 1;
      return;
    }

    if (rollback) {
      if (!only || !args.includes("--yes")) { console.error("Usage: --rollback NNN --yes"); process.exitCode = 2; return; }
      const f = listMigrations().find((x) => x.startsWith(only));
      const history = await readHistory(db);
      if (!f || !history.has(f)) { console.error(`${only} is not applied.`); process.exitCode = 1; return; }
      const later = listMigrations().filter((x) => x > f && history.has(x));
      if (later.length) { console.error(`Refusing: roll back ${later.reverse().join(", ")} first. Nothing changed.`); process.exitCode = 1; return; }
      const mod = await load(f);
      await mod.down(helpers(db, console.log));
      await db.exec(`DELETE FROM \`${T.schemaMigrations}\` WHERE filename = ?`, [f]);
      console.log(`✓ rolled back ${f}`);
      return;
    }

    const pf = await preflight(db, { only });
    console.log(`Other tables in this database (not RPP, never touched): ${pf.otherTables}`);
    if (pf.foreignResearchTables.length) console.log(`! research_* tables NOT owned by RPP (left untouched): ${pf.foreignResearchTables.join(", ")}`);
    console.log(`RPP history (${T.schemaMigrations}): ${[...pf.applied].sort().join(", ") || "(none yet)"}`);
    console.log(`Pending: ${pf.pending.join(", ") || "(none)"}`);
    if (!pf.ok) {
      console.error(`✗ COLLISION — already exist but were not created by RPP migrations:\n  ${pf.collisions.join("\n  ")}\nNothing changed.`);
      process.exitCode = 1;
      return;
    }
    console.log("✓ Collision preflight passed.");
    if (!apply) { console.log("Status only (read-only). Re-run with --apply to apply the pending migrations."); return; }
    await migrate(db, { only });
    console.log("Done.");
  } catch (e) {
    console.error("✗ Migration failed:", e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
