/**
 * READ-ONLY backup of EXACTLY the Research Publication Portal tables (the `research_*`
 * names in lib/db/tables.mjs — never any other application's table in the shared DB)
 * into a single .sql file (CREATE TABLE + INSERTs) — for servers where
 * `mysqldump` is not installed. Prefer mysqldump when available (see the
 * migration guide); this is the fallback. Verifies the written file by
 * re-counting the INSERTed rows against live COUNT(*).
 *
 *   npm run db:backup -- <outDir>
 * The output contains personal data and password hashes: it is written with
 * mode 0600 and must be kept OUTSIDE the repository / web root.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2";
import { createDb, createPool, dbConfigFromEnv } from "../lib/db/core.mjs";
import { OWN_TABLES } from "../lib/db/tables.mjs";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: npm run db:backup -- <outDir>"); process.exit(2); }

const cfg = dbConfigFromEnv(process.env);
// Raw values (no app type casting) so the dump round-trips exactly.
const raw = mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl: cfg.ssl, connectTimeout: cfg.connectTimeout, timezone: "Z", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, charset: "utf8mb4_unicode_ci" }).promise();
const db = createDb(createPool({ ...cfg, connectionLimit: 1 }));
try {
  await raw.query("SET time_zone = '+00:00'");
  const [tables] = await raw.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?) ORDER BY table_name", [OWN_TABLES]);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `rpp-backup-${cfg.database}-${stamp}.sql`);
  const parts = [`-- RPP backup of ${cfg.database} @ ${cfg.host} — ${new Date().toISOString()}\nSET NAMES utf8mb4;\nSET time_zone = '+00:00';\nSET FOREIGN_KEY_CHECKS = 0;\n`];
  const counts = {};
  for (const { name } of tables) {
    const [[ddl]] = await raw.query(`SHOW CREATE TABLE \`${name}\``);
    parts.push(`\n-- ${name}\n${ddl["Create Table"].replace(/^CREATE TABLE/, "CREATE TABLE IF NOT EXISTS")};\n`);
    const [rows] = await raw.query(`SELECT * FROM \`${name}\``);
    counts[name] = rows.length;
    for (const r of rows) parts.push(mysql.format(`INSERT INTO \`${name}\` SET ?;`, [r]) + "\n");
  }
  parts.push("\nSET FOREIGN_KEY_CHECKS = 1;\n");
  writeFileSync(file, parts.join(""), { mode: 0o600 });

  // Verify: INSERT lines per table in the file == live row count.
  const text = readFileSync(file, "utf8");
  let ok = true;
  for (const { name } of tables) {
    const inFile = (text.match(new RegExp(`^INSERT INTO \\\`${name}\\\` `, "gm")) || []).length;
    const live = Number((await db.one(`SELECT COUNT(*) AS n FROM \`${name}\``)).n);
    const same = inFile === counts[name] && live === counts[name];
    ok &&= same;
    console.log(`  ${same ? "✓" : "✗"} ${name.padEnd(52)} ${counts[name]} row(s)${same ? "" : ` (file ${inFile}, live ${live})`}`);
  }
  console.log(`${ok ? "✓" : "✗"} Backup written: ${file} (${tables.length} tables)`);
  if (!ok) process.exitCode = 1;
} catch (e) {
  console.error("✗ Backup failed:", e.code || "", e.message);
  process.exitCode = 1;
} finally {
  await raw.end();
  await db.end();
}
