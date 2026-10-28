/**
 * Database connectivity check.
 *
 *   npm run db:check
 *   (= node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/check-db.mjs)
 *
 * Loads .env first, then .env.local on top if present (local overrides). On
 * production, where only .env exists, .env.local is skipped harmlessly.
 *
 * Reads the same variables the application uses, so a pass here means the app's
 * pool will connect too. Run it after changing .env.local or pointing at a
 * different MySQL server. It never prints the password.
 */
import mysql from "mysql2/promise";

const { DB_HOST, DB_PORT = "3306", DB_USER, DB_PASS = "", DB_NAME } = process.env;

const missing = ["DB_HOST", "DB_USER", "DB_NAME"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  console.error("Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const line = (label, value) => console.log(`  ${label.padEnd(22)}${value}`);

console.log(`\nResearch Publication Portal — database check`);
console.log(`  target                ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
console.log(`  user                  ${DB_USER} (password ${DB_PASS ? "set" : "blank"})\n`);

let server;
try {
  server = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASS,
    connectTimeout: 8000,
  });
  const [[v]] = await server.query("SELECT VERSION() AS version");
  line("server reachable", `MySQL ${v.version}`);
} catch (error) {
  line("server UNREACHABLE", `${error.code}: ${error.message}`);
  console.error("\nIs MySQL running, and are the credentials correct?\n");
  process.exit(1);
}

const [schemas] = await server.query(
  "SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation " +
    "FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
  [DB_NAME],
);
const dbExists = schemas.length > 0;
line(
  "database",
  dbExists ? `exists (${schemas[0].charset} / ${schemas[0].collation})` : `"${DB_NAME}" not created yet`,
);

let exitCode = 0;
if (dbExists) {
  await server.changeUser({ database: DB_NAME });
  try {
    const [[ping]] = await server.query("SELECT 1 AS ok");
    line("select", `ok=${ping.ok}`);
    const [[bound]] = await server.execute("SELECT ? + ? AS sum, ? AS text", [2, 3, "héllo ✓"]);
    line("prepared statement", `${bound.sum}, utf8mb4 round-trip "${bound.text}"`);
    const [tables] = await server.query(
      "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [DB_NAME],
    );
    line("tables present", tables[0].n);
  } catch (error) {
    line("query FAILED", `${error.code}: ${error.message}`);
    exitCode = 1;
  }
} else {
  console.log("\n  Create the database, then run `npm run db:migrate`.");
}

await server.end();
console.log(exitCode === 0 ? "\nAll checks passed.\n" : "\nChecks failed.\n");
process.exit(exitCode);
