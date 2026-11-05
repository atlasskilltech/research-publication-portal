/**
 * Deploy-time migration gate (run by .github/workflows on the EC2 server,
 * BEFORE `npm run build` / `pm2 reload`). Safe to run on every deploy:
 *
 *   1. Read-only preflight. Nothing pending → exit 0, nothing touched.
 *   2. Collision preflight must pass (no foreign table with an RPP name).
 *   3. FRESH backup of ONLY the RPP `research_*` tables (scripts/db-backup.mjs,
 *      self-verified: INSERT rows in the file == live COUNT(*)), into
 *      RPP_BACKUP_DIR (default ~/rpp-backups, outside the repo, mode 0600).
 *      The file must exist, be non-empty and contain research_users.
 *   4. Apply the pending migrations (idempotent, additive; see database/migrations).
 *   5. Verify: history complete, row counts of every pre-existing RPP table
 *      unchanged, and (for 004) the AUTHOR schema present.
 * Any failure → exit 1, so the deploy stops before build/reload and the
 * running application keeps serving the previous version.
 *
 *   npm run db:deploy-migrate
 * Env: the server's .env / .env.local (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, …).
 * Never prints credentials or row data.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Same precedence as the npm scripts (--env-file .env then .env.local): values
// already in the environment win, then .env.local, then .env.
for (const f of [".env.local", ".env"]) {
  try { process.loadEnvFile(f); } catch { /* optional */ }
}

const { createDb, createPool, dbConfigFromEnv } = await import("../lib/db/core.mjs");
const { T, OWN_TABLES } = await import("../lib/db/tables.mjs");
const { preflight, migrate, readHistory, listMigrations, serverInfo } = await import("./db-migrate.mjs");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const backupDir = process.env.RPP_BACKUP_DIR || path.join(os.homedir(), "rpp-backups");

async function counts(db) {
  const out = {};
  const present = (await db.query("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?)", [OWN_TABLES])).map((r) => r.n);
  for (const t of present) out[t] = Number((await db.one(`SELECT COUNT(*) AS n FROM \`${t}\``)).n);
  return out;
}

const cfg = dbConfigFromEnv(process.env);
const db = createDb(createPool({ ...cfg, connectionLimit: 1 }));
let code = 0;
try {
  const info = await serverInfo(db);
  console.log(`db-deploy-migrate: ${info.flavor} ${info.version}, database \`${cfg.database}\``);
  if (!info.supported) throw new Error("unsupported server version (need MySQL ≥ 8.0.16 / MariaDB ≥ 10.4)");

  const pf = await preflight(db);
  if (!pf.ok) throw new Error(`collision preflight failed: ${pf.collisions.join("; ")}`);
  if (!pf.pending.length) {
    console.log("✓ No pending migrations — nothing to do.");
  } else {
    console.log(`Pending: ${pf.pending.join(", ")}`);

    // ---- Fresh, verified backup of ONLY the RPP tables ----
    const before = new Set(readdirSafe(backupDir));
    execFileSync(process.execPath, [path.join(root, "scripts/db-backup.mjs"), backupDir], { stdio: "inherit", env: process.env });
    const created = readdirSafe(backupDir).filter((f) => f.endsWith(".sql") && !before.has(f));
    if (created.length !== 1) throw new Error("backup file was not created");
    const file = path.join(backupDir, created[0]);
    const text = readFileSync(file, "utf8");
    if (statSync(file).size < 100 || !text.includes(`CREATE TABLE IF NOT EXISTS \`${T.users}\``)) throw new Error("backup file is incomplete");
    console.log(`✓ Backup verified: ${file}`);

    // ---- Apply ----
    const pre = await counts(db);
    await migrate(db);

    // ---- Verify ----
    const history = await readHistory(db);
    const missing = listMigrations().filter((f) => !history.has(f));
    if (missing.length) throw new Error(`not recorded: ${missing.join(", ")}`);
    const post = await counts(db);
    const changed = Object.keys(pre).filter((t) => t !== T.schemaMigrations && pre[t] !== post[t]);
    if (changed.length) throw new Error(`row counts changed in: ${changed.join(", ")}`);
    console.log(`✓ Existing RPP rows unchanged (${Object.keys(pre).length} tables).`);
    if (history.has("004_author_role.mjs")) {
      const col = await db.one("SELECT column_type AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'baseType'", [T.users]);
      const tables = await db.query("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?)", [[T.authorProfiles, T.authorRegistrations]]);
      if (!/'AUTHOR'/.test(col?.t || "") || tables.length !== 2) throw new Error("AUTHOR schema not present after 004");
      console.log("✓ AUTHOR schema verified (baseType enum, author tables).");
    }
    console.log("✓ Migrations applied and verified.");
  }
} catch (e) {
  console.error(`✗ db-deploy-migrate: ${e.message} — deploy stopped; the running app is unchanged.`);
  code = 1;
} finally {
  await db.end();
}
process.exit(code);

function readdirSafe(d) {
  try { return readdirSync(d); } catch { return []; }
}
