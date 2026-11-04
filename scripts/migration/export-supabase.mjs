/**
 * ONE-OFF, READ-ONLY export of every RPP table + the auth users from the old
 * Supabase project into a JSON file, for import into MySQL
 * (scripts/migration/import-supabase-export.mjs).
 *
 * No Supabase SDK: plain HTTPS against PostgREST + the GoTrue admin API, so this
 * keeps working after @supabase/* is removed from package.json.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SECRET_KEY=<service role> \
 *     node scripts/migration/export-supabase.mjs <outFile.json>
 * (NEXT_PUBLIC_SUPABASE_URL is accepted as a fallback for SUPABASE_URL.)
 *
 * Password hashes are NOT reachable through these APIs. To carry passwords over,
 * run this in the Supabase SQL editor and save the result as CSV/JSON:
 *   select id, encrypted_password from auth.users;
 * then pass it to the import script with --hashes <file>.
 * The output contains personal data (emails/names): keep it outside the repo.
 */
import { writeFileSync } from "node:fs";

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SECRET_KEY || "";
const out = process.argv[2];
if (!url || !key || !out) {
  console.error("usage: SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/migration/export-supabase.mjs <out.json>");
  process.exit(2);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };

const TABLES = [
  "profiles", "user_roles", "papers", "paper_authors", "paper_manuscripts", "paper_assignments",
  "paper_activity", "reviews", "paper_revisions", "editorial_decisions", "volumes", "issues", "publications",
];

async function readTable(t) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { ...headers, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (r.status === 404) return { missing: true, rows: [] };
    if (!r.ok && r.status !== 206) throw new Error(`${t}: HTTP ${r.status}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) return { rows };
  }
}

async function readUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!r.ok) throw new Error(`auth users: HTTP ${r.status}`);
    const body = await r.json();
    const list = body.users || [];
    for (const u of list) {
      users.push({
        id: u.id, email: u.email, email_confirmed_at: u.email_confirmed_at || null,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at || null,
        banned_until: u.banned_until || null,
        providers: u.app_metadata?.providers || [],
        identities: (u.identities || []).map((i) => ({ provider: i.provider, sub: i.identity_data?.sub || i.id || null, email: i.identity_data?.email || null })),
      });
    }
    if (list.length < 200) return users;
  }
}

const data = { exportedAt: new Date().toISOString(), source: new URL(url).host, tables: {}, authUsers: [] };
for (const t of TABLES) {
  const { rows, missing } = await readTable(t);
  data.tables[t] = rows;
  console.log(`${t.padEnd(20)} ${missing ? "(table not found)" : rows.length}`);
}
data.authUsers = await readUsers();
console.log(`${"auth users".padEnd(20)} ${data.authUsers.length}`);
writeFileSync(out, JSON.stringify(data, null, 2), { mode: 0o600 });
console.log(`written: ${out}`);
