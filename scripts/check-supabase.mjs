/**
 * Supabase connectivity & capability diagnostic (read-only).
 *
 * Reports what this environment can and cannot do against the Supabase project,
 * so we know whether migrations can be applied directly. It uses the configured
 * keys only to make authorized API calls and prints ONLY status booleans and
 * counts — never the value of any secret.
 *
 * Run: npm run supabase:check
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const pat = process.env.SUPABASE_ACCESS_TOKEN; // Supabase Personal Access Token (sbp_...)
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const dbPass = process.env.SUPABASE_DB_PASSWORD;

const ref = url ? new URL(url).host.split(".")[0] : null;
const line = (k, v) => console.log("  " + k.padEnd(34), v);

async function main() {
  console.log("\n=== Supabase environment ===");
  line("Project URL:", url || "ABSENT");
  line("Project ref:", ref || "ABSENT");
  line("Publishable key present:", !!publishable);
  line("Secret (service_role) key present:", !!secret);
  line("Personal Access Token present:", !!pat);
  line("DB password / URL present:", !!(dbPass || dbUrl));
  line("EMAIL_ID present:", !!process.env.EMAIL_ID);
  line("EMAIL_APP_PASSWORD present:", !!process.env.EMAIL_APP_PASSWORD);

  // 1) Auth Admin API reachability (proves the secret key is valid + authorized).
  console.log("\n=== Auth Admin API (service_role) ===");
  if (secret) {
    try {
      const r = await fetch(`${url}/auth/v1/admin/users?per_page=1`, {
        headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      });
      line("Admin API HTTP:", r.status);
      line("Admin API usable:", r.ok);
    } catch (e) {
      line("Admin API error:", e.message);
    }
  } else {
    line("Skipped:", "no secret key");
  }

  // 2) Does public.profiles exist yet? (service_role bypasses RLS)
  console.log("\n=== Schema check: public.profiles ===");
  if (secret) {
    try {
      const r = await fetch(`${url}/rest/v1/profiles?select=id&limit=1`, {
        headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      });
      const txt = await r.text();
      const missing = r.status === 404 || /PGRST205|could not find the table/i.test(txt);
      line("profiles table exists:", !missing && r.ok);
      if (missing) line("note:", "table not found — migrations not yet applied");
    } catch (e) {
      line("error:", e.message);
    }
  } else {
    line("Skipped:", "no secret key");
  }

  // 3) Can we run DDL directly? Only via Management API (PAT) or a DB connection.
  console.log("\n=== Direct DDL capability ===");
  if (pat && ref) {
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
        headers: { Authorization: `Bearer ${pat}` },
      });
      line("Management API usable:", r.ok, `(HTTP ${r.status})`);
    } catch (e) {
      line("Management API error:", e.message);
    }
  } else if (dbPass || dbUrl) {
    line("DB connection present:", true, "(would use node-postgres)");
  } else {
    line("Can apply DDL directly:", false);
    line("reason:", "service_role grants Auth + PostgREST only, not raw SQL.");
    line("need one of:", "SUPABASE_ACCESS_TOKEN (PAT) or DATABASE_URL / DB password");
  }

  console.log("");
}

main().catch((e) => {
  console.error("diagnostic failed:", e?.message || e);
  process.exit(1);
});
