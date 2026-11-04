/**
 * READ-ONLY database inspection (changes nothing — SELECTs and information_schema
 * only). Run it BEFORE migrating the shared database:
 *
 *   npm run db:check
 *
 * Prints: connectivity, server flavour/version, time zone + sql_mode, EVERY table
 * in the database (names + engine; the non-RPP ones are only listed, never read),
 * the Research Publication Portal's `research_*` tables with exact row counts,
 * the RPP migration history, and the collision preflight (would any table a
 * pending migration creates clash with an existing one?). Account summary is
 * counts only — no emails, no hashes, no credentials.
 */
import { createDb, createPool, dbConfigFromEnv } from "../lib/db/core.mjs";
import { T, TABLE_PREFIX, OWN_TABLES } from "../lib/db/tables.mjs";
import { preflight, serverInfo } from "./db-migrate.mjs";

const cfg = dbConfigFromEnv(process.env);
const db = createDb(createPool({ ...cfg, connectionLimit: 1 }));
try {
  const info = await serverInfo(db);
  const s = await db.one("SELECT @@global.time_zone AS gtz, @@session.time_zone AS stz, @@session.sql_mode AS mode, @@default_storage_engine AS eng, @@character_set_database AS cs, @@collation_database AS coll");
  console.log(`✓ Connected: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  console.log(`  Server ${info.flavor} ${info.version} (${info.supported ? "supported" : "UNSUPPORTED — need MySQL ≥ 8.0.16 / MariaDB ≥ 10.4"}) | engine ${s.eng} | db charset ${s.cs}/${s.coll}`);
  console.log(`  time_zone global=${s.gtz} session=${s.stz} (app pins +00:00) | session sql_mode=${s.mode}`);

  const tables = await db.query("SELECT table_name AS name, engine FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name");
  const own = tables.filter((t) => OWN_TABLES.includes(t.name));
  const foreignResearch = tables.filter((t) => t.name.startsWith(TABLE_PREFIX) && !OWN_TABLES.includes(t.name));
  const others = tables.filter((t) => !t.name.startsWith(TABLE_PREFIX));
  console.log(`\nAll tables in \`${cfg.database}\`: ${tables.length}`);
  console.log(`  Other applications (listed only — never read, altered or dropped): ${others.length}`);
  for (const t of others) console.log(`    ${t.name} (${t.engine})`);
  if (foreignResearch.length) {
    console.log(`  ! research_* tables NOT owned by RPP (left untouched): ${foreignResearch.map((t) => t.name).join(", ")}`);
  }
  console.log(`  RPP-owned tables present: ${own.length}/${OWN_TABLES.length}`);
  for (const t of own) {
    const n = (await db.one(`SELECT COUNT(*) AS n FROM \`${t.name}\``)).n;
    console.log(`    ${t.name.padEnd(32)} ${String(t.engine).padEnd(7)} ${n} row(s)`);
  }

  const pf = await preflight(db);
  console.log(`\nRPP migration history (${T.schemaMigrations}): ${[...pf.applied].sort().join(", ") || "(none yet — table not created)"}`);
  console.log(`Pending migrations: ${pf.pending.join(", ") || "(none)"}`);
  console.log(pf.ok ? "✓ Collision preflight: no existing table clashes with a pending RPP migration." : `✗ COLLISION:\n  ${pf.collisions.join("\n  ")}`);
  if (!pf.ok) process.exitCode = 1;

  if (own.some((t) => t.name === T.users)) {
    const u = await db.one(
      `SELECT COUNT(*) AS total, SUM(isAdmin = 1) AS admins, SUM(passwordHash IS NOT NULL) AS with_pw,
              SUM(passwordHash LIKE '$2%') AS bcrypt, SUM(passwordHash LIKE '$argon2id$%') AS argon,
              SUM(emailVerified IS NOT NULL) AS verified FROM \`${T.users}\``);
    console.log(`\nRPP accounts: ${u.total} (admins ${u.admins || 0}, verified ${u.verified || 0}, with password ${u.with_pw || 0}: bcrypt ${u.bcrypt || 0} / argon2id ${u.argon || 0})`);
  }
} catch (e) {
  console.error(`✗ ${e.code || ""} ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
