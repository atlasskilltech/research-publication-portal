/**
 * Print a stable JSON snapshot of the two real admin accounts, for before/after
 * comparison around a migration. Selects only columns that exist both before and
 * after 0003 (NOT application_no), so it runs either side of the migration. No
 * secrets printed.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
 * Run: node scripts/admin-snapshot.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const EMAILS = ["elizabeth.jerome@atlasuniversity.edu.in", "faizan.shaikh@atlasuniversity.edu.in"];

async function authByEmail(email) {
  for (let page = 1; page <= 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) break;
  }
  return null;
}

const out = [];
for (const email of EMAILS) {
  const u = await authByEmail(email);
  if (!u) { out.push({ email, present: false }); continue; }
  const { data: p } = await admin.from("profiles").select("name, base_type, is_admin, updated_at").eq("id", u.id).maybeSingle();
  out.push({
    email,
    id: u.id,
    is_admin: p?.is_admin,
    base_type: p?.base_type,
    name: p?.name,
    email_confirmed: !!u.email_confirmed_at,
    profile_updated_at: p?.updated_at,
  });
}
out.sort((a, b) => a.email.localeCompare(b.email));
console.log(JSON.stringify(out, null, 2));
