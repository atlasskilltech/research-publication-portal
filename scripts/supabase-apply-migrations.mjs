/**
 * Apply the Supabase SQL migrations DIRECTLY, via the Supabase Management API.
 *
 * This is the reusable path for all future migrations — no copying SQL into the
 * dashboard. It reads every file in supabase/migrations/ in lexical order (so
 * 0001_* before 0002_*) and runs each against the project's database. The
 * migration SQL is written to be idempotent, so re-running is safe.
 *
 * Requires:
 *   NEXT_PUBLIC_SUPABASE_URL      — to derive the project ref
 *   SUPABASE_ACCESS_TOKEN         — a Supabase Personal Access Token (sbp_...),
 *                                   created at https://supabase.com/dashboard/account/tokens
 *                                   SERVER-ONLY. Never commit or print it.
 *
 * Run: npm run supabase:migrate            (applies every file)
 *      npm run supabase:migrate -- 0002    (applies only files matching "0002")
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!url) {
  console.error("\n✖ NEXT_PUBLIC_SUPABASE_URL is not set.\n");
  process.exit(1);
}
if (!token) {
  console.error(
    "\n✖ SUPABASE_ACCESS_TOKEN (a Personal Access Token, sbp_...) is not set.\n" +
      "  Create one at https://supabase.com/dashboard/account/tokens and add it to\n" +
      "  .env.local (server-only; never commit it). Then re-run this command.\n",
  );
  process.exit(1);
}

const ref = new URL(url).host.split(".")[0];
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

// Use the Management API MIGRATIONS endpoint (not the ad-hoc /database/query
// endpoint): it is authorized by the "Migrations Read-Write" token scope and it
// RECORDS the run in the project's migration history (supabase_migrations).
const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/migrations`;

async function runMigration(name, sql) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, query: sql }),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).message || text;
    } catch {}
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  return text;
}

async function main() {
  const filter = process.argv[2]; // optional substring, e.g. "0002"
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => (filter ? f.includes(filter) : true))
    .sort();

  if (files.length === 0) {
    console.error(`\n✖ No migration files found in ${migrationsDir}${filter ? ` matching "${filter}"` : ""}.\n`);
    process.exit(1);
  }

  console.log(`\nApplying ${files.length} migration(s) to project ${ref}:\n`);
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const name = file.replace(/\.sql$/, "");
    process.stdout.write(`• ${file} … `);
    try {
      await runMigration(name, sql);
      console.log("ok");
    } catch (e) {
      console.log("FAILED");
      console.error(`\n✖ ${file} failed: ${e.message}\n`);
      process.exit(1);
    }
  }
  console.log("\n✓ All migrations applied.\n");
}

main().catch((e) => {
  console.error("\n✖ Migration run failed:", e?.message || e);
  process.exit(1);
});
