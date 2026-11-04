/**
 * Google-first registration & optional password — HTTP suite against a RUNNING
 * app and its MySQL database (never production: throwaway accounts only,
 * deleted at the end).
 *
 * A real Google login needs Google; the callback itself is covered offline with
 * real RS256 tokens (scripts/test-google-first.mjs, test-google-auth.mjs). Here
 * a "Google sign-in" is the exact effect of a successful callback
 * (lib/googleAuth.completeSignIn): link the identity, mark the email verified,
 * start an APP session with authMethod 'google'.
 *
 *   node scripts/test-google-first-http.mjs http://localhost:3001
 * Env: DB_* = the app's database. Student registration needs the app's
 * STUDENT_CHECK_API_URL to accept application numbers starting 25/26 (a local mock).
 */
import crypto from "node:crypto";
import { makeHarness } from "./lib/test-db.mjs";
import { createSession, sessionPolicy, SESSION_COOKIE } from "../lib/auth/store.mjs";
import { markEmailVerified } from "../lib/repos/users.mjs";
import { uuid } from "../lib/auth/crypto.mjs";

const h = makeHarness(process.argv[2]);
const { check } = h;
const MSG = "Your registration is successful. You can now sign in using your ATLAS University Google account.";

/** The effect of a successful Google callback, for user `u`, in browser `br`. */
async function googleSignIn(br, u) {
  const linked = await h.db.one(`SELECT 1 AS x FROM \`${h.T.userIdentities}\` WHERE user_id = ?`, [u.id]);
  if (!linked) {
    await h.db.exec(
      `INSERT INTO \`${h.T.userIdentities}\` (id, user_id, provider, subject, email, created_at, last_login_at) VALUES (?, ?, 'google', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [uuid(), u.id, `it-${crypto.randomBytes(8).toString("hex")}`, u.email],
    );
  }
  await markEmailVerified(h.db, u.id);
  const s = await createSession(h.db, u.id, { purpose: "APP", method: "google", policy: sessionPolicy() });
  br.set(SESSION_COOKIE, s.token);
}
const row = (id) => h.db.one(`SELECT id, baseType, isAdmin, status, passwordHash, emailVerified, applicationNo FROM \`${h.T.users}\` WHERE id = ?`, [id]);
const rolesOf = async (id) => (await h.db.query(`SELECT role FROM \`${h.T.userRoles}\` WHERE user_id = ? ORDER BY role`, [id])).map((r) => r.role).join(",");
const tokensOf = async (id) => Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.authTokens}\` WHERE user_id = ?`, [id])).n);

async function main() {
  console.log(`\n=== Google-first registration (app ${h.BASE}) ===\n`);
  const anon = h.browser();
  const post = (p, json, b = anon) => b.api(p, { method: "POST", json });

  console.log("Registration (no password setup):");
  const facEmail = h.email("fac");
  const fr = await post("/api/register", { name: "IT Faculty", email: facEmail, baseType: "FACULTY", school: "uGDX" });
  check("faculty registration → 201 with the exact message", fr.status === 201 && fr.data?.message === MSG && fr.data?.googleSignIn === true, `${fr.status} ${fr.data?.error || ""}`);
  const fac = await h.track(facEmail);
  const facRow = await row(fac.id);
  check("faculty: FACULTY, ACTIVE, not admin, no password, no roles", facRow.baseType === "FACULTY" && facRow.status === "ACTIVE" && !facRow.isAdmin && facRow.passwordHash === null && (await rolesOf(fac.id)) === "");
  check("faculty: NO setup/verification token issued", (await tokensOf(fac.id)) === 0);

  const appNo = `25${crypto.randomInt(10000000, 99999999)}`;
  const stEmail = h.email("stu");
  const sr = await post("/api/register", { name: "IT Student", email: stEmail, baseType: "STUDENT", school: "ISME", applicationNo: appNo });
  check("student registration → 201 with the exact message", sr.status === 201 && sr.data?.message === MSG, `${sr.status} ${sr.data?.error || ""}`);
  const stu = await h.track(stEmail);
  const stuRow = stu ? await row(stu.id) : null;
  check("student: STUDENT with the verified application number, no password, no roles", stuRow?.baseType === "STUDENT" && stuRow.applicationNo === appNo && stuRow.passwordHash === null && (await rolesOf(stu.id)) === "");
  check("student: NO setup/verification token issued", stu && (await tokensOf(stu.id)) === 0);
  check("unverified application number → 422, nothing created", (await post("/api/register", { name: "Nope", email: h.email("nope"), baseType: "STUDENT", applicationNo: "1234567" })).status === 422);
  check("same email again → 409 (points to Google)", (await post("/api/register", { name: "Again", email: facEmail, baseType: "FACULTY" })).data?.code === "exists");
  check("password login refused for the new accounts (no password)", (await anon.login(facEmail, "Anything#2026x")) === 401 && (await anon.login(stEmail, "Anything#2026x")) === 401);

  console.log("\nAccount settings & optional password — security:");
  check("GET /account signed out → redirect to /login", [302, 303, 307].includes((await anon.req("/account")).status));
  check("POST /api/account/password signed out → 401", (await post("/api/account/password", { password: "Strong#Pass2026", confirm: "Strong#Pass2026" })).status === 401);
  const forged = h.browser(); forged.set(SESSION_COOKIE, crypto.randomBytes(32).toString("base64url"));
  check("forged session cookie → 401", (await post("/api/account/password", { password: "Strong#Pass2026", confirm: "Strong#Pass2026" }, forged)).status === 401);

  console.log("\nStudent signs in with Google, then optionally adds a password:");
  const sb = h.browser();
  await googleSignIn(sb, stu);
  const other = h.browser();
  await googleSignIn(other, stu);
  check("Google session reaches the dashboard", (await sb.req("/dashboard")).status === 200);
  const acct = await sb.req("/account");
  const acctHtml = await acct.text();
  check("/account renders with the Set password form", acct.status === 200 && /Set a password/.test(acctHtml) && /Linked/.test(acctHtml));
  check("cross-site POST refused (403)", (await sb.api("/api/account/password", { method: "POST", json: { password: "Strong#Pass2026", confirm: "Strong#Pass2026" }, headers: { Origin: "https://evil.example" } })).status === 403);
  check("weak password → 422", (await sb.api("/api/account/password", { method: "POST", json: { password: "short", confirm: "short" } })).status === 422);
  const beforeRoles = await rolesOf(stu.id);
  const set = await sb.api("/api/account/password", { method: "POST", json: { password: "Student#NewPass2026", confirm: "Student#NewPass2026" } });
  check("password set → 200", set.status === 200, `HTTP ${set.status} ${set.data?.error || ""}`);
  const after = await row(stu.id);
  check("stored as Argon2id (no plain text)", /^\$argon2id\$/.test(after.passwordHash || "") && !String(after.passwordHash).includes("Student#NewPass2026"));
  check("roles, admin flag and account type unchanged", (await rolesOf(stu.id)) === beforeRoles && !after.isAdmin && after.baseType === "STUDENT");
  check("this browser stays signed in", (await sb.api("/api/dashboard")).status === 200);
  check("other device signed out", (await other.api("/api/dashboard")).status === 401);
  const again = await sb.api("/api/account/password", { method: "POST", json: { password: "Other#Pass20266", confirm: "Other#Pass20266" } });
  check("second Set password → 409, hash unchanged", again.status === 409 && (await row(stu.id)).passwordHash === after.passwordHash);
  check("password login now works", (await h.browser().login(stEmail, "Student#NewPass2026")) === 200);
  check("…and the wrong password is refused", (await h.browser().login(stEmail, "Wrong#Pass20266")) === 401);
  check("/account now shows 'Password set'", /Password set/.test(await (await sb.req("/account")).text()));

  console.log("\nExisting accounts:");
  const admin = await h.mkAdmin();
  const editor = await h.mkUser({ kind: "editor" });
  await h.grant(admin.id, editor.id, ["EDITOR", "PEER_REVIEWER"]);
  const adminRoles = await rolesOf(admin.id), editorRoles = await rolesOf(editor.id);
  check("existing admin password login still works", (await h.browser().login(admin.email, admin.password)) === 200);
  check("existing editor password login still works", (await h.browser().login(editor.email, editor.password)) === 200);
  const ab = h.browser();
  await googleSignIn(ab, admin);
  check("admin signed in with Google can't overwrite the password (409)", (await ab.api("/api/account/password", { method: "POST", json: { password: "Admin#Override2026", confirm: "Admin#Override2026" } })).status === 409);
  check("admin password unchanged", (await h.browser().login(admin.email, admin.password)) === 200);
  check("admin and editor roles unchanged", (await rolesOf(admin.id)) === adminRoles && (await rolesOf(editor.id)) === editorRoles && !!(await row(admin.id)).isAdmin);
  const pwStudent = await h.mkUser({ kind: "oldstu", baseType: "STUDENT", applicationNo: `26${crypto.randomInt(10000000, 99999999)}` });
  check("existing student with a password logs in", (await h.browser().login(pwStudent.email, pwStudent.password)) === 200);

  console.log("\nForgot password & resend:");
  const facTokens = await tokensOf(fac.id);
  const rs = await post("/api/auth/resend", { email: facEmail }, h.browser());
  check("resend → neutral 200, no token issued", rs.status === 200 && (await tokensOf(fac.id)) === facTokens);
  const fp = await post("/api/auth/forgot-password", { email: facEmail }, h.browser());
  check("forgot password (no password yet) → explicit RECOVERY link", fp.status === 200 && !!(await h.db.one(`SELECT 1 AS x FROM \`${h.T.authTokens}\` WHERE user_id = ? AND purpose = 'RECOVERY' AND consumed_at IS NULL`, [fac.id])));
  const raw = await h.token(fac.id, "RECOVERY");
  const rb = h.browser();
  const c = await h.confirmLink(rb, raw, "recovery", "reset");
  check("reset link → /reset-password", /\/reset-password$/.test(c.location || ""), c.location);
  const pw = "Faculty#Reset2026";
  check("reset sets the password", (await rb.api("/api/set-password", { method: "POST", json: { password: pw, confirm: pw } })).status === 200);
  check("faculty can now log in with the password", (await h.browser().login(facEmail, pw)) === 200);
  check("faculty roles still empty, not admin", (await rolesOf(fac.id)) === "" && !(await row(fac.id)).isAdmin);

  console.log("\nSign-in page:");
  const login = await (await h.browser().req("/login")).text();
  check("Google first, then the password form", login.indexOf("Sign in with Google") > -1 && login.indexOf("Sign in with Google") < login.indexOf('name="password"'));
  check("no 'Resend setup email' prompt", !/Resend setup email/.test(login));
  check("registered notice renders", /You can now sign in using your ATLAS University Google account/.test(await (await h.browser().req("/login?notice=registered")).text()));
}
main().catch(h.fail).finally(() => h.finish("Google-first registration HTTP"));
