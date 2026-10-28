/**
 * Schema verification.
 *
 *   npm run db:verify
 *   (= node --env-file=.env.local scripts/verify-schema.mjs)
 *
 * Confirms the expected auth tables exist with the right engine and collation,
 * and reports which migrations have been recorded. Exits non-zero on any
 * deviation, so it can gate a deployment. Read-only — it changes nothing.
 */
import mysql from "mysql2/promise";

const { DB_HOST, DB_PORT = "3306", DB_USER, DB_PASSWORD = "", DB_NAME } = process.env;

const EXPECTED = ["users", "verification_tokens", "sessions"];

const conn = await mysql.createConnection({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
});

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};

const [[schema]] = await conn.query(
  "SELECT DEFAULT_CHARACTER_SET_NAME cs, DEFAULT_COLLATION_NAME co " +
    "FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
  [DB_NAME],
);
console.log(`\ndatabase  ${DB_NAME}  ${schema.cs} / ${schema.co}`);

const [tables] = await conn.query(
  "SELECT TABLE_NAME name, ENGINE engine, TABLE_COLLATION collation " +
    "FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' " +
    "ORDER BY TABLE_NAME",
  [DB_NAME],
);
const found = tables.map((t) => t.name);

for (const name of EXPECTED) {
  if (!found.includes(name)) fail(`missing table: ${name}`);
}
for (const t of tables) {
  if (!EXPECTED.includes(t.name) && t.name !== "schema_migrations") continue;
  if (t.engine !== "InnoDB") fail(`${t.name} engine is ${t.engine}`);
  if (t.collation !== "utf8mb4_unicode_ci") fail(`${t.name} collation is ${t.collation}`);
}

const [fks] = await conn.query(
  "SELECT COUNT(*) n FROM information_schema.TABLE_CONSTRAINTS " +
    "WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
  [DB_NAME],
);

let migrations = [];
try {
  const [rows] = await conn.query(
    "SELECT `filename`, `applied_at` FROM `schema_migrations` ORDER BY `filename`",
  );
  migrations = rows;
} catch {
  fail("schema_migrations table is missing — run `npm run db:migrate`");
}

console.log(`\ntables present    ${found.filter((n) => EXPECTED.includes(n)).length} / ${EXPECTED.length} expected`);
console.log(`foreign keys      ${fks[0].n}`);
console.log(`migrations applied`);
if (migrations.length === 0) console.log("  (none recorded)");
for (const m of migrations) {
  console.log(`  ${m.filename.padEnd(28)}${new Date(m.applied_at).toISOString()}`);
}

await conn.end();

if (failures === 0) {
  console.log(`\nSchema verified — no deviations.\n`);
  process.exit(0);
}
console.log(`\n${failures} problem(s) found.\n`);
process.exit(1);
