/**
 * Behavioural auth + RLS test (no app server needed).
 *
 * Proves the security properties of the schema against the live Supabase
 * project. It creates its OWN throwaway users (a test admin + a test student),
 * exercises them, and DELETES them at the end. It NEVER touches, signs in as, or
 * changes the password of the real admin accounts — so it is safe to run at any
 * time. It touches only Supabase, never production.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY. Run: npm run supabase:test-auth
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !anonKey || !secret) {
  console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY.\n");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const userClient = () => createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const tag = crypto.randomBytes(5).toString("hex");
const pw = () => crypto.randomBytes(18).toString("base64url");

let failures = 0;
const cleanup = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function listAllUsers() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    all.push(...data.users);
    if (data.users.length < 200) break;
  }
  return all;
}
const findByEmail = async (email) => (await listAllUsers()).find((u) => (u.email || "").toLowerCase() === email.toLowerCase()) || null;

async function makeUser(kind, { admin: isAdmin = false, confirm = true } = {}) {
  const email = `rpp.test.${kind}.${tag}.${crypto.randomBytes(3).toString("hex")}@atlasuniversity.edu.in`;
  const password = pw();
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: confirm,
    user_metadata: { name: `Test ${kind}`, base_type: isAdmin ? "FACULTY" : "STUDENT" },
  });
  if (error) throw new Error(`createUser(${kind}) failed: ${error.message}`);
  cleanup.push(data.user.id);
  if (isAdmin) {
    const { error: e2 } = await admin.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
    if (e2) throw new Error(`elevate(${kind}) failed: ${e2.message}`);
  }
  return { id: data.user.id, email, password };
}

async function main() {
  console.log(`\n=== Behavioural auth + RLS tests on ${new URL(url).host} ===\n`);

  // ---- Throwaway admin: login, profile, admin-wide read ------------------
  console.log("Admin (throwaway) login & authorization:");
  const tAdmin = await makeUser("admin", { admin: true });
  const asAdmin = userClient();
  {
    const { data, error } = await asAdmin.auth.signInWithPassword({ email: tAdmin.email, password: tAdmin.password });
    check("admin signInWithPassword succeeds", !error && !!data?.session, error?.message);
  }
  {
    const { data: me } = await asAdmin.from("profiles").select("*").eq("id", tAdmin.id).maybeSingle();
    check("admin profile retrieval", !!me);
    check("admin profile is_admin = true", me?.is_admin === true);
  }
  {
    const { data: all } = await asAdmin.from("profiles").select("id");
    check("admin reads ALL profiles (admin policy + SECURITY DEFINER fn)", (all?.length || 0) >= 2, `${all?.length} rows`);
  }

  // ---- Signup trigger forces non-admin; non-admin RLS --------------------
  console.log("\nSignup trigger & non-admin RLS:");
  const tStudent = await makeUser("student", { admin: false });
  {
    const { data: p } = await admin.from("profiles").select("*").eq("id", tStudent.id).maybeSingle();
    check("trigger auto-created student profile", !!p);
    check("trigger forced is_admin = false", p?.is_admin === false);
    check("trigger set base_type (STUDENT) from metadata", p?.base_type === "STUDENT");
  }
  const asStudent = userClient();
  await asStudent.auth.signInWithPassword({ email: tStudent.email, password: tStudent.password });
  {
    const { data: rows } = await asStudent.from("profiles").select("id");
    const onlyOwn = rows?.length === 1 && rows[0].id === tStudent.id;
    check("student sees ONLY their own profile (RLS)", onlyOwn, `${rows?.length} row(s)`);
  }

  // ---- Privilege-escalation guard ----------------------------------------
  console.log("\nPrivilege-escalation guard:");
  {
    await asStudent.from("profiles").update({ is_admin: true, base_type: "FACULTY" }).eq("id", tStudent.id);
    const { data: p } = await admin.from("profiles").select("is_admin,base_type").eq("id", tStudent.id).maybeSingle();
    check("self-escalation blocked: is_admin stays false", p?.is_admin === false);
    check("self base_type change blocked: stays STUDENT", p?.base_type === "STUDENT");
  }
  {
    const { data: upd } = await asStudent.from("profiles").update({ name: "hacked" }).eq("id", tAdmin.id).select();
    check("student cannot modify another user's profile (RLS)", (upd?.length || 0) === 0, `${upd?.length || 0} row(s)`);
  }

  // ---- Email confirmation enforced (confirmation stays ENABLED) ----------
  console.log("\nEmail confirmation enforcement:");
  const tUnconf = await makeUser("unconf", { admin: false, confirm: false });
  {
    const { data, error } = await userClient().auth.signInWithPassword({ email: tUnconf.email, password: tUnconf.password });
    check("login refused until email confirmed", !data?.session && /confirm/i.test(error?.message || ""), error?.message || "signed in (unexpected)");
  }

  console.log("");
}

main()
  .catch((e) => { console.error("\n✖ Test run error:", e?.message || e); failures++; })
  .finally(async () => {
    for (const id of cleanup) { try { await admin.auth.admin.deleteUser(id); } catch {} }
    console.log(`Cleanup: removed ${cleanup.length} throwaway user(s).`);

    // ---- Invariant: 1:1 users↔profiles, no orphans/duplicates ----------
    try {
      const users = await listAllUsers();
      const { data: profiles } = await admin.from("profiles").select("id");
      const uIds = new Set(users.map((u) => u.id));
      const pIds = profiles.map((p) => p.id);
      const pSet = new Set(pIds);
      const orphans = pIds.filter((id) => !uIds.has(id));       // profile w/o auth user
      const missing = [...uIds].filter((id) => !pSet.has(id));  // auth user w/o profile
      const dupes = pIds.length !== pSet.size;
      console.log("\nProfile integrity:");
      check("no orphaned profiles (profile without auth user)", orphans.length === 0, `${orphans.length}`);
      check("no users missing a profile", missing.length === 0, `${missing.length}`);
      check("no duplicate profile rows", !dupes, `${users.length} users / ${pIds.length} profiles`);
    } catch (e) {
      check("profile integrity check ran", false, e.message);
    }

    console.log(`\n${failures === 0 ? "✓ PASS — all behavioural auth/RLS/integrity checks passed." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
