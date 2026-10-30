/**
 * Print current Supabase Auth accounts and their profile role (read-only).
 * No secrets are printed. Run: npm run supabase:status
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.\n");
  process.exit(1);
}
const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
const { data: profiles } = await admin.from("profiles").select("id,email,name,base_type,is_admin");
const byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

console.log(`\nAuth users: ${data.users.length}  |  profiles: ${profiles?.length ?? 0}\n`);
for (const u of data.users) {
  const p = byId[u.id] || {};
  console.log(
    `  ${u.email.padEnd(42)} confirmed=${!!u.email_confirmed_at}` +
      `  is_admin=${p.is_admin === true}  base_type=${p.base_type || "-"}  name="${p.name || ""}"`,
  );
}
console.log("");
