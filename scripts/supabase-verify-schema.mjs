/**
 * Verify the deployed Supabase schema (read-only), using only what the
 * "Migrations Read-Write" PAT and the service_role key authorize:
 *
 *   • Migration history  — GET /v1/projects/{ref}/database/migrations (PAT)
 *   • Table + columns     — service_role read through PostgREST
 *
 * RLS enforcement, the signup trigger and the privilege-escalation guard are
 * proven behaviourally (they need real rows) by scripts/test-auth.mjs after the
 * admins are provisioned. Full pg_catalog introspection (exact policy/function
 * names) would additionally require a token with the `database:read` scope.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_ACCESS_TOKEN (PAT) and
 * SUPABASE_SECRET_KEY. Run: npm run supabase:verify
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !token || !secret) {
  console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_ACCESS_TOKEN and SUPABASE_SECRET_KEY.\n");
  process.exit(1);
}

const ref = new URL(url).host.split(".")[0];
const EXPECTED_COLUMNS = [
  "id", "email", "name", "base_type", "is_admin",
  "school_code", "roll_no", "legacy_id", "created_at", "updated_at",
];

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function main() {
  console.log(`\n=== Verifying schema on project ${ref} ===\n`);

  // 1) Migration history (PAT, database_migrations_read).
  console.log("Migration history:");
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/migrations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    check("read migration history", false, `HTTP ${r.status}`);
  } else {
    const history = await r.json();
    const names = history.map((m) => m.name || m.version).join(", ");
    check("0001_profiles recorded", history.some((m) => (m.name || "").includes("0001_profiles")), names);
    check("0002_rls recorded", history.some((m) => (m.name || "").includes("0002_rls")));
  }

  // 2) Table + every expected column (service_role through PostgREST). A missing
  //    column makes PostgREST return 400 naming it, so a clean 2xx proves them all.
  console.log("\nTable & columns (public.profiles):");
  const sel = EXPECTED_COLUMNS.join(",");
  const pr = await fetch(`${url}/rest/v1/profiles?select=${sel}&limit=1`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
  });
  if (pr.ok) {
    check("public.profiles exists", true);
    check(`all ${EXPECTED_COLUMNS.length} expected columns present`, true, sel);
  } else {
    const body = await pr.text();
    check("public.profiles + columns", false, `HTTP ${pr.status}: ${body.slice(0, 160)}`);
  }

  console.log(`\n${failures === 0 ? "✓ PASS — schema + history verified." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✖ Verification failed:", e?.message || e);
  process.exit(1);
});
