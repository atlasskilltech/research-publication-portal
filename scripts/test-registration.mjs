/**
 * Behavioural test of the passwordless onboarding mechanism against the live
 * Supabase project. Creates its OWN throwaway users and deletes them; it NEVER
 * touches the real admin accounts.
 *
 * REQUIRES migration 0003 (application_no) to be applied — it asserts the column
 * is populated and that its uniqueness index holds. Run only after the live
 * apply is approved.
 *
 * Proves: invite link → verifyOtp → set password → login (no password ever
 * collected up front); email stays unconfirmed until the link is used; the
 * profile carries application_no; is_admin is forced false; faculty carry no
 * application_no; and the application_no uniqueness index rejects duplicates.
 *
 * Run: npm run supabase:test-registration
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
const anon = () => createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const tag = crypto.randomBytes(5).toString("hex");
const pw = () => crypto.randomBytes(18).toString("base64url");

let failures = 0;
const cleanup = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function main() {
  console.log(`\n=== Passwordless onboarding tests on ${new URL(url).host} ===\n`);

  // ---- Student: invite → verify → set password → login -------------------
  console.log("Student onboarding (no password collected up front):");
  const email = `rpp.reg.student.${tag}@atlasuniversity.edu.in`;
  const appNo = `APP${tag.toUpperCase()}`;
  const { data: gen, error: genErr } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { name: "Reg Test Student", base_type: "STUDENT", application_no: appNo } },
  });
  check("invite link generated (account created, no password)", !genErr && !!gen?.properties?.hashed_token, genErr?.message);
  if (gen?.user?.id) cleanup.push(gen.user.id);

  {
    const { data: u } = await admin.auth.admin.getUserById(gen.user.id);
    check("email starts UNCONFIRMED (not auto-verified)", !u?.user?.email_confirmed_at);
  }
  {
    const { data: p } = await admin.from("profiles").select("*").eq("id", gen.user.id).maybeSingle();
    check("profile created by trigger", !!p);
    check("profile.application_no populated (needs migration 0003)", p?.application_no === appNo, String(p?.application_no));
    check("is_admin forced false", p?.is_admin === false);
    check("base_type = STUDENT", p?.base_type === "STUDENT");
  }

  // Login must FAIL before the link is used / password set.
  {
    const { data } = await anon().auth.signInWithPassword({ email, password: "whatever-not-set-123" });
    check("cannot log in before verifying + setting a password", !data?.session);
  }

  // Use the invite link (verifyOtp) then set a password.
  const client = anon();
  const newPw = pw();
  {
    const { data, error } = await client.auth.verifyOtp({ type: "invite", token_hash: gen.properties.hashed_token });
    check("invite link verifies email + opens a session", !error && !!data?.session, error?.message);
    const { error: upErr } = await client.auth.updateUser({ password: newPw });
    check("password set via updateUser", !upErr, upErr?.message);
  }
  {
    const { data: u } = await admin.auth.admin.getUserById(gen.user.id);
    check("email now CONFIRMED after using the link", !!u?.user?.email_confirmed_at);
  }
  {
    const { data, error } = await anon().auth.signInWithPassword({ email, password: newPw });
    check("can log in with the new password", !error && !!data?.session, error?.message);
  }

  // ---- Application-number uniqueness index -------------------------------
  console.log("\nApplication-number uniqueness:");
  {
    const email2 = `rpp.reg.student2.${tag}@atlasuniversity.edu.in`;
    const { data: gen2, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email: email2,
      options: { data: { name: "Dup", base_type: "STUDENT", application_no: `OTHER${tag}` } },
    });
    if (gen2?.user?.id) cleanup.push(gen2.user.id);
    check("second student created with a different app no", !error);
    // Try to collide its application_no with the first student's, using a
    // DIFFERENT CASE — proves the index is case-insensitive (lower()).
    const { error: dupErr } = await admin.from("profiles").update({ application_no: appNo.toLowerCase() }).eq("id", gen2.user.id);
    check("case-insensitive duplicate application_no rejected by unique index", !!dupErr, dupErr ? "rejected" : "NOT rejected");
  }

  // ---- Faculty: no application number ------------------------------------
  console.log("\nFaculty onboarding:");
  {
    const femail = `rpp.reg.faculty.${tag}@atlasuniversity.edu.in`;
    const { data: fgen, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email: femail,
      options: { data: { name: "Reg Test Faculty", base_type: "FACULTY" } },
    });
    if (fgen?.user?.id) cleanup.push(fgen.user.id);
    check("faculty invite generated", !error && !!fgen?.properties?.hashed_token, error?.message);
    const { data: p } = await admin.from("profiles").select("base_type, application_no, is_admin").eq("id", fgen.user.id).maybeSingle();
    check("faculty base_type = FACULTY", p?.base_type === "FACULTY");
    check("faculty has NO application_no", p?.application_no == null);
    check("faculty is_admin forced false", p?.is_admin === false);
  }

  console.log("");
}

main()
  .catch((e) => { console.error("\n✖ Test run error:", e?.message || e); failures++; })
  .finally(async () => {
    for (const id of cleanup) { try { await admin.auth.admin.deleteUser(id); } catch {} }
    console.log(`Cleanup: removed ${cleanup.length} throwaway user(s).`);
    console.log(`\n${failures === 0 ? "✓ PASS — onboarding mechanism verified." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
