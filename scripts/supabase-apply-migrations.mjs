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
 * Run: npm run supabase:migrate -- 0002    (applies only migration 0002)
 *      npm run supabase:migrate -- 0005 0006 0007 0008 0009 0011   (several, in number order)
 *      npm run supabase:migrate -- --all   (EVERY file — fresh empty project only; re-runs 0004,
 *                                           which temporarily undoes the 0010 hardening)
 *      npm run supabase:migrate -- 0010 --dry-run   (lists what WOULD run; no network)
 *   or directly: node scripts/supabase-apply-migrations.mjs 0010 [--dry-run]
 *
 * Selection: an all-digit filter matches the migration NUMBER exactly
 * ("0010" → only 0010_*.sql; "001" matches nothing). Any other filter is a
 * substring match on the file name, as before.
 * --dry-run / --list: print the selected files and whether the required
 * variables are set (names only, never values), then exit WITHOUT contacting
 * Supabase.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load .env.local / .env when run directly with `node` (the npm script already
// passes --env-file-if-exists). process.loadEnvFile never overrides a variable
// that is already set, so loading .env.local first keeps the same precedence as
// the npm script: shell > .env.local > .env. Missing files are ignored.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(path.join(projectRoot, f));
  } catch {
    /* file absent (or Node without loadEnvFile) — fall back to the shell env */
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || args.includes("--list");
const filters = args.filter((a) => !a.startsWith("--")); // e.g. "0005" "0006" …
const filter = filters.join(" ");
// Applying EVERY file re-runs 0004, which replaces the 0010-hardened
// admin_set_user_roles with the vulnerable version until 0010 runs again — and
// if anything in between fails, production is left exposed. Require an explicit
// selection; --all is the deliberate (fresh, empty project only) escape hatch.
const applyAll = args.includes("--all");
if (!filters.length && !applyAll) {
  console.error(
    "\n✖ Name the migration(s) to apply, e.g.:\n" +
      "    node scripts/supabase-apply-migrations.mjs 0005 0006 0007 0008 0009 0011 --dry-run\n" +
      "  Applying every file re-runs 0004 and temporarily undoes the 0010 security fix.\n" +
      "  Use --all only on a fresh, empty project.\n",
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;

/** Exact migration number for digit filters; substring otherwise. */
function selectFiles(all) {
  const sql = all.filter((f) => f.endsWith(".sql")).sort();
  if (!filters.length) return sql; // only reachable with --all
  return sql.filter((f) =>
    filters.some((flt) => (/^\d+$/.test(flt) ? f.split("_")[0] === flt : f.includes(flt))),
  );
}

if (dryRun) {
  const migrationsDir = path.join(projectRoot, "supabase", "migrations");
  const files = selectFiles(await readdir(migrationsDir));
  let ref = "(NEXT_PUBLIC_SUPABASE_URL not set)";
  try { if (url) ref = new URL(url).host.split(".")[0]; } catch { ref = "(invalid NEXT_PUBLIC_SUPABASE_URL)"; }
  console.log("\nDRY RUN — nothing is sent to Supabase.\n");
  console.log(`  Target project ref:     ${ref}`);
  console.log(`  NEXT_PUBLIC_SUPABASE_URL: ${url ? "set" : "NOT SET"}`);
  console.log(`  SUPABASE_ACCESS_TOKEN:  ${token ? "set" : "NOT SET"}`);
  console.log(`  Filter:                 ${filter ? JSON.stringify(filter) : "(none — ALL migrations)"}`);
  console.log(`\n  Would apply ${files.length} migration(s), in this order:`);
  for (const f of files) console.log(`    • ${f}`);
  console.log("");
  process.exit(files.length ? 0 : 1);
}

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
const migrationsDir = path.join(projectRoot, "supabase", "migrations");

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
  const files = selectFiles(await readdir(migrationsDir));

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
