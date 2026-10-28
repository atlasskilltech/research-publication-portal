/**
 * Applies pending database migrations, in order, exactly once each.
 *
 *   npm run db:migrate
 *   (= node --env-file=.env.local scripts/migrate.mjs)
 *
 * Reads the same DB_* variables the application uses, so it follows whatever
 * .env.local you load it with and needs no mysql CLI on PATH. It connects to
 * the configured database BY NAME and never issues CREATE DATABASE, so it can
 * only ever migrate the database you pointed it at — never the local XAMPP one
 * by accident, and never a database that does not already exist.
 *
 * Behaviour:
 *   - Each file in database/migrations/*.sql is applied once and recorded in a
 *     `schema_migrations` table. Re-running applies only files not yet recorded,
 *     so it is safe to run repeatedly.
 *   - Nothing is ever dropped, truncated or reset. Migrations are written to be
 *     idempotent (IF NOT EXISTS / guarded ALTERs); structural changes go in new
 *     numbered files, never by editing an already-applied one.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import mysql from "mysql2/promise";

const { DB_HOST, DB_PORT = "3306", DB_USER, DB_PASSWORD = "", DB_NAME } = process.env;

const missing = ["DB_HOST", "DB_USER", "DB_NAME"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`\nMissing required env vars: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env.local and fill it in, or load the right env file.\n");
  process.exit(1);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "database", "migrations");

console.log(`\nResearch Publication Portal — migrate`);
console.log(`  target   ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
console.log(`  user     ${DB_USER} (password ${DB_PASSWORD ? "set" : "blank"})\n`);

let conn;
try {
  conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME, // connect by name — never create it
    multipleStatements: true,
    charset: "utf8mb4_unicode_ci",
  });
} catch (error) {
  if (error.code === "ER_BAD_DB_ERROR") {
    console.error(
      `Database "${DB_NAME}" does not exist on ${DB_HOST}:${DB_PORT}.\n` +
        "Create it first (locally in phpMyAdmin, or in cPanel on production), then re-run.\n" +
        "This script never creates databases, so it cannot target the wrong one by accident.\n",
    );
  } else {
    console.error(`Could not connect: ${error.code} — ${error.message}\n`);
  }
  process.exit(1);
}

try {
  await conn.query(
    "CREATE TABLE IF NOT EXISTS `schema_migrations` (" +
      "`filename` VARCHAR(255) NOT NULL," +
      "`applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)," +
      "PRIMARY KEY (`filename`)" +
      ") ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
  );

  const [appliedRows] = await conn.query("SELECT `filename` FROM `schema_migrations`");
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (files.length === 0) {
    console.log("No migration files found.\n");
    process.exit(0);
  }

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip   ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(migrationsDir, file), "utf8");
    process.stdout.write(`  apply  ${file} ... `);
    try {
      await conn.query(sql);
      await conn.execute("INSERT INTO `schema_migrations` (`filename`) VALUES (?)", [file]);
      ran += 1;
      console.log("done");
    } catch (error) {
      console.log("FAILED");
      console.error(`\n  ${file}: ${error.code} — ${error.sqlMessage ?? error.message}\n`);
      process.exit(1);
    }
  }

  console.log(`\n${ran} migration(s) applied, ${files.length - ran} already present.`);
  console.log("Run `npm run db:verify` to confirm the schema.\n");
} finally {
  await conn.end();
}
