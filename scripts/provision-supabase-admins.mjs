/**
 * Provision the Research Publication Portal administrator accounts in Supabase.
 *
 * Uses the supported Supabase Auth Admin API (`auth.admin.*`) — never a direct
 * INSERT into auth.users. Each admin is created with their existing email, a
 * confirmed address (so no SMTP is needed to sign in), and a random throwaway
 * password that is NEVER printed. Each admin sets their own password afterwards
 * with scripts/set-admin-password.mjs (or a Supabase reset email once SMTP is
 * configured).
 *
 * The run is idempotent: an account that already exists is left in place and
 * only has its admin flag / profile fields reasserted.
 *
 * Requires (server-side only): NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.
 * Run with:  npm run supabase:provision-admins
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ADMINS = [
  {
    email: "faizan.shaikh@atlasuniversity.edu.in",
    name: "Faizan Shaikh",
    baseType: "FACULTY",
    legacyId: "cmvp590oe0000toig5612cv1b",
  },
  {
    email: "elizabeth.jerome@atlasuniversity.edu.in",
    name: "Elizabeth Jerome",
    baseType: "FACULTY",
    legacyId: "cmvp596h40001toigw7o3n066",
  },
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n✖ Missing required environment variable ${name}.`);
    console.error("  Set it in .env.local (SUPABASE_SECRET_KEY is server-only — never commit it).\n");
    process.exit(1);
  }
  return v;
}

/** Find an existing auth user by email (listUsers is paginated). */
async function findUserByEmail(admin, email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secret = requireEnv("SUPABASE_SECRET_KEY");
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`\nProvisioning ${ADMINS.length} administrator account(s) on ${new URL(url).host}\n`);

  for (const a of ADMINS) {
    let user = await findUserByEmail(admin, a.email);

    if (user) {
      console.log(`• ${a.email} — already exists, reasserting admin profile`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: a.email,
        password: crypto.randomBytes(24).toString("base64url"), // throwaway; reset later
        email_confirm: true,
        user_metadata: { name: a.name, base_type: a.baseType },
      });
      if (error) {
        console.error(`✖ ${a.email} — createUser failed: ${error.message}`);
        process.exitCode = 1;
        continue;
      }
      user = data.user;
      console.log(`• ${a.email} — created`);
    }

    // The handle_new_user() trigger created the profile with is_admin=false.
    // Elevate it deliberately here (service role bypasses RLS + the escalation
    // trigger). Upsert guards the rare case the trigger row is missing.
    const { error: upErr } = await admin.from("profiles").upsert(
      {
        id: user.id,
        email: a.email,
        name: a.name,
        base_type: a.baseType,
        is_admin: true,
        legacy_id: a.legacyId,
      },
      { onConflict: "id" },
    );
    if (upErr) {
      console.error(`  ✖ profile update failed for ${a.email}: ${upErr.message}`);
      process.exitCode = 1;
    } else {
      console.log(`  ✓ profile set: is_admin=true, base_type=${a.baseType}`);
    }
  }

  console.log(
    "\nDone. Admins have no usable password yet — set one with:\n" +
      '  npm run supabase:set-admin-password -- "<email>" "<new-password>"\n',
  );
}

main().catch((e) => {
  console.error("\n✖ Provisioning failed:", e?.message || e);
  process.exit(1);
});
