/**
 * LIVE account-flow test through the app's own endpoints (running server) +
 * the existing Supabase project. Uses throwaway accounts that are
 * plus-addresses of EMAIL_ID (mail lands only in the portal's own mailbox) and
 * deletes them at the end. Never touches real accounts.
 *
 * Covers: registration (+ invite email via SMTP), duplicate registration,
 * unconfirmed login refused, resend, forgot password (+ reset email),
 * reset via the emailed token type (recovery → verifyOtp → new password),
 * old password refused / new accepted, reused + invalid tokens rejected,
 * rate limiting.
 *
 *   RPP_E2E_CONFIRM=yes node --env-file=.env.local scripts/test-auth-live-app.mjs [baseUrl]
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

if (process.env.RPP_E2E_CONFIRM !== "yes") { console.error("Set RPP_E2E_CONFIRM=yes (writes throwaway test accounts)."); process.exit(1); }
const BASE = (process.argv[2] || "http://127.0.0.1:5631").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SECRET_KEY, pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const [local, domain] = (process.env.EMAIL_ID || "").trim().toLowerCase().split("@");
if (!url || !secret || !pub || !local) { console.error("Need Supabase env + EMAIL_ID."); process.exit(1); }
const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const anonClient = () => createClient(url, pub, { auth: { autoRefreshToken: false, persistSession: false } });

const RUN = `auth${Date.now()}`;
const TAG = `+rpp-${RUN}-`;
const mail = (p) => `${local}${TAG}${p}@${domain}`;
const created = [];
let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${!ok && d ? " — " + d : ""}`); if (!ok) failures++; };
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
};
async function idOf(email) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}

try {
  console.log(`\nRegistration (${RUN})`);
  const regEmail = mail("faculty");
  const reg = await post("/api/register", { name: `[TEST ${RUN}] Faculty`, email: regEmail, baseType: "FACULTY" });
  check("register faculty → 201", reg.status === 201, `${reg.status} ${reg.data?.error || ""}`);
  const ru = await idOf(regEmail);
  if (ru) created.push(ru.id);
  check("account created, email NOT yet confirmed", !!ru && !ru.email_confirmed_at);
  const { data: prof } = ru ? await admin.from("profiles").select("is_admin, base_type").eq("id", ru.id).maybeSingle() : { data: null };
  check("profile: FACULTY, never admin", prof?.base_type === "FACULTY" && prof?.is_admin === false, JSON.stringify(prof));
  const dup = await post("/api/register", { name: `[TEST ${RUN}] Faculty`, email: regEmail, baseType: "FACULTY" });
  check("duplicate registration handled (201 re-invite or 409), no 5xx", [201, 409].includes(dup.status), String(dup.status));
  const bad = await post("/api/register", { name: "X Y", email: `someone${TAG}x@gmail.com`, baseType: "FACULTY" });
  check("non-university email rejected (422)", bad.status === 422, String(bad.status));
  const login0 = await post("/api/login", { email: regEmail, password: "Whatever-123456" });
  check("unconfirmed account cannot log in (401)", login0.status === 401, String(login0.status));
  const rs = await post("/api/auth/resend", { email: regEmail });
  check("resend setup email → 200", rs.status === 200, String(rs.status));

  console.log("\nForgot / reset password");
  const userEmail = mail("member");
  const oldPw = crypto.randomBytes(18).toString("base64url") + "Aa1!";
  const { data: cu, error: ce } = await admin.auth.admin.createUser({ email: userEmail, password: oldPw, email_confirm: true, user_metadata: { name: `[TEST ${RUN}] Member`, base_type: "FACULTY" } });
  if (cu?.user) created.push(cu.user.id);
  check("confirmed test member created", !ce && !!cu?.user, ce?.message);
  check("member logs in with password", (await post("/api/login", { email: userEmail, password: oldPw })).status === 200);
  const fp = await post("/api/auth/forgot-password", { email: userEmail });
  check("forgot password → 200 (reset email sent)", fp.status === 200, String(fp.status));
  const fpUnknown = await post("/api/auth/forgot-password", { email: mail("nobody") });
  check("unknown email gets the SAME response (no account probing)", fpUnknown.status === fp.status);

  // The emailed link carries a recovery token_hash; generate an equivalent one
  // (the emailed one stays in the mailbox) and redeem it exactly as /auth/confirm does.
  const { data: gl, error: ge } = await admin.auth.admin.generateLink({ type: "recovery", email: userEmail });
  check("recovery token generated", !ge && !!gl?.properties?.hashed_token, ge?.message);
  const c1 = anonClient();
  const v = await c1.auth.verifyOtp({ token_hash: gl.properties.hashed_token, type: "recovery" });
  check("recovery token verifies once", !v.error && !!v.data?.session, v.error?.message);
  const newPw = crypto.randomBytes(18).toString("base64url") + "Bb2@";
  const upd = await c1.auth.updateUser({ password: newPw });
  check("new password set", !upd.error, upd.error?.message);
  const reuse = await anonClient().auth.verifyOtp({ token_hash: gl.properties.hashed_token, type: "recovery" });
  check("reused token rejected", !!reuse.error);
  const junk = await anonClient().auth.verifyOtp({ token_hash: crypto.randomBytes(28).toString("hex"), type: "recovery" });
  check("invalid / expired token rejected", !!junk.error);
  check("old password refused (401)", (await post("/api/login", { email: userEmail, password: oldPw })).status === 401);
  check("new password accepted (200)", (await post("/api/login", { email: userEmail, password: newPw })).status === 200);

  console.log("\nRate limiting");
  let limited = false;
  for (let i = 0; i < 15 && !limited; i++) {
    const r = await post("/api/auth/forgot-password", { email: mail("ratelimit") });
    if (r.status === 429) limited = true;
  }
  check("repeated reset requests are rate-limited (429)", limited);
} catch (e) {
  failures++; console.log(`  ✗ unexpected error — ${e.message}`);
} finally {
  // Give after()-scheduled / in-flight emails a moment, then delete only our accounts.
  await new Promise((r) => setTimeout(r, 2000));
  for (const id of created) {
    const { data } = await admin.auth.admin.getUserById(id);
    if (!(data?.user?.email || "").includes(TAG)) { console.log(`  ! skipped ${id}: not a test address`); continue; }
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(`  cleanup: ${error ? "FAILED " + error.message : "deleted"} ${data.user.email.replace(/^[^+]+/, "***")}`);
  }
}
console.log(failures ? `\n✗ FAIL — ${failures} check(s) failed.\n` : "\n✓ PASS — live account flows work.\n");
process.exit(failures ? 1 : 0);
