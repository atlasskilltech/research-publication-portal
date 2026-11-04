/**
 * Google-first registration & authentication — offline suite (no database, no
 * network). Exercises the SAME functions production uses with in-memory fakes:
 *
 *   lib/registration.registerAccount       student / faculty registration
 *   lib/authMailer.deliverRegistrationConfirmed + the real templates
 *   lib/oauthPolicy.completeGoogleCallback (real RS256 ID tokens, local JWKS)
 *   lib/authFlow.addPassword               optional password after Google sign-in
 *   lib/auth/password.mjs                  real Argon2id hashing / verification
 *   lib/authFlow.resendSetupEmail          forgot password / sign-in instructions
 *
 *   node scripts/test-google-first.mjs
 */
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { registerAccount, REGISTERED_MESSAGE, EXISTS_MESSAGE } from "../lib/registration.js";
import { deliverRegistrationConfirmed, deliverSignInInstructions } from "../lib/authMailer.js";
import { registrationConfirmedEmail, passwordChangedEmail } from "../lib/email/templates.js";
import { idempotencyKey } from "../lib/email/core.js";
import {
  completeGoogleCallback, verifyIdTokenSignature, isUniversityEmail, GOOGLE_ALLOWED_DOMAIN,
} from "../lib/oauthPolicy.js";
import { addPassword, resendSetupEmail, safeNextPath } from "../lib/authFlow.js";
import { hashPassword, verifyPassword } from "../lib/auth/password.mjs";

let failures = 0, total = 0;
const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SITE = "https://research.atlasskilltech.app";

// ---- An in-memory portal: users, roles, identities, sessions, outbox ---------------------
function portal() {
  let seq = 0;
  const users = new Map(); // id → { id, name, email, base_type, is_admin, status, application_no, school_code, password_hash, email_confirmed_at }
  const roles = new Map(); // id → string[]
  const identities = new Map(); // google sub → userId
  const sessions = []; // { token, userId, revoked }
  const outbox = []; // emails handed to the sender
  const tokens = []; // any single-use email token issued (must stay EMPTY for registration)
  const byEmail = (e) => [...users.values()].find((u) => u.email === String(e).toLowerCase()) || null;
  const add = (u) => {
    const id = u.id || `u${++seq}`;
    users.set(id, { id, status: "ACTIVE", is_admin: false, password_hash: null, email_confirmed_at: "2026-10-01T00:00:00Z", application_no: null, school_code: null, ...u });
    roles.set(id, [...(u.roles || [])]);
    return users.get(id);
  };
  const sendEmail = async (m) => { outbox.push(m); return { ok: true, id: `m${outbox.length}` }; };
  const regDeps = (over = {}) => ({
    findUserByApplicationNo: async (no) => [...users.values()].find((u) => u.application_no === no) || null,
    verifyApplicationNo: async (no) => ({ status: no === "2507316" || no === "2600001" ? "exists" : no === "OUTAGE" ? "unavailable" : "not_found" }),
    findUserByEmail: async (e) => byEmail(e),
    createAccount: async ({ name, email, baseType, schoolCode, applicationNo }) => {
      if (byEmail(email) || (applicationNo && [...users.values()].some((u) => u.application_no === applicationNo))) {
        throw Object.assign(new Error("dup"), { duplicate: true });
      }
      // Mirrors lib/repos/users.createRegisteredUser: no password, not verified, not admin, no roles.
      return add({ name, email, base_type: baseType, school_code: schoolCode, application_no: applicationNo, email_confirmed_at: null }).id;
    },
    sendRegistrationEmail: ({ email, name, userId, baseType }) =>
      deliverRegistrationConfirmed({ email, name, userId, baseType }, { sendEmail, siteUrl: SITE, isUniversityEmail }),
    isUniversityEmail,
    ...over,
  });
  const login = async (email, password) => {
    const u = byEmail(email);
    const usable = u && u.password_hash && u.status === "ACTIVE" && u.email_confirmed_at; // same rule as /api/login
    if (!usable) return 401;
    return (await verifyPassword(u.password_hash, password)).ok ? 200 : 401;
  };
  const startSession = (userId) => { const t = `s${sessions.length + 1}`; sessions.push({ token: t, userId, revoked: false }); return t; };
  return { users, roles, identities, sessions, outbox, tokens, byEmail, add, regDeps, login, startSession, sendEmail };
}

// ---- Google: real RS256 tokens against a local JWKS ---------------------------------------
const CLIENT_ID = "rpp-test.apps.googleusercontent.com";
const NOW = Math.floor(Date.now() / 1000);
const { publicKey, privateKey } = await generateKeyPair("RS256");
const JWKS = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
async function idToken(c = {}) {
  const base = {
    iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, sub: `sub-${c.email}`,
    email_verified: true, hd: GOOGLE_ALLOWED_DOMAIN, nonce: "N0NCE", iat: NOW, exp: NOW + 3600, ...c,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return new SignJWT(base).setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(privateKey);
}
/** Run the real callback for `email` against portal P. Records role writes (there must be none). */
async function googleSignIn(P, email, claims = {}) {
  const state = `st_${Math.random().toString(36).slice(2)}`;
  const flows = new Map([[state, { nonce: "N0NCE", codeVerifier: "V", next: "/dashboard" }]]);
  const tok = await idToken({ email, ...claims });
  let signedIn = null;
  const r = await completeGoogleCallback({ params: { code: "c", state }, cookieState: state }, {
    clientId: CLIENT_ID, nowS: () => NOW,
    consumeState: async (s) => { const f = flows.get(s); flows.delete(s); return f || null; },
    exchangeCode: async () => ({ id_token: tok }),
    verifyIdToken: (t) => verifyIdTokenSignature(t, JWKS, CLIENT_ID),
    findIdentity: async (sub) => (P.identities.has(sub) ? P.users.get(P.identities.get(sub)) : null),
    findUserByEmail: async (e) => P.byEmail(e),
    linkedSubFor: async (id) => [...P.identities].find(([, uid]) => uid === id)?.[0] || null,
    // Mirrors lib/googleAuth.completeSignIn: link + verify email + APP session. No role/admin input exists.
    completeSignIn: async (args) => {
      const allowed = ["userId", "link", "verifyEmail", "claims"];
      if (Object.keys(args).some((k) => !allowed.includes(k))) throw new Error("unexpected sign-in field");
      if (args.link) P.identities.set(args.claims.sub, args.userId);
      if (args.verifyEmail) P.users.get(args.userId).email_confirmed_at = new Date().toISOString();
      signedIn = P.startSession(args.userId);
    },
    safeNext: safeNextPath,
  });
  return { ...r, session: signedIn };
}
const snapshot = (P, id) => JSON.stringify({ roles: P.roles.get(id), admin: P.users.get(id).is_admin, type: P.users.get(id).base_type, id });
/** addPassword wired to portal P for the session `token`. */
const addPwDeps = (P, token, over = {}) => ({
  getSessionUser: async () => { const s = P.sessions.find((x) => x.token === token && !x.revoked); const u = s && P.users.get(s.userId); return u ? { id: u.id, email: u.email } : null; },
  setInitialPassword: async (userId, password) => {
    const u = P.users.get(userId);
    if (u.password_hash) return { exists: true };
    u.password_hash = await hashPassword(password);
    return { ok: true };
  },
  revokeOtherSessions: async (userId) => { for (const s of P.sessions) if (s.userId === userId && s.token !== token) s.revoked = true; },
  notifyPasswordAdded: async (email) => { P.outbox.push({ to: email, purpose: "password_added" }); },
  ...over,
});
const isPasswordSetupMail = (m) => /create (your )?password|token_hash|\/auth\/confirm|\/create-password/i.test(`${m.subject} ${m.html} ${m.text}`);

// =========================================================================================
section("Student registration (no password setup)");
{
  const P = portal();
  const r = await registerAccount({ name: "Asha Student", email: "asha.s@atlasuniversity.edu.in", baseType: "STUDENT", school: "ISME", applicationNo: "2507316" }, P.regDeps());
  const u = P.byEmail("asha.s@atlasuniversity.edu.in");
  check("201 with the exact Google sign-in message", r.status === 201 && r.body.message === REGISTERED_MESSAGE && r.body.googleSignIn === true, r.body.message);
  check("account category = STUDENT, application no. + school kept", u?.base_type === "STUDENT" && u.application_no === "2507316" && u.school_code === "ISME");
  check("no password, not admin, no roles", u.password_hash === null && u.is_admin === false && P.roles.get(u.id).length === 0);
  check("no email-verification / password token issued", P.tokens.length === 0);
  check("exactly ONE email sent: registration confirmation", P.outbox.length === 1 && P.outbox[0].purpose === "registration_confirmed");
  check("…and it is NOT a password-creation email (no link, no token)", !isPasswordSetupMail(P.outbox[0]), P.outbox[0].subject);
  check("…its button goes to the plain sign-in page", P.outbox[0].html.includes(`${SITE}/login`) && /Sign in with Google/.test(P.outbox[0].html));
  check("…idempotency key derived from the user id only (a retry can't send a second copy)", P.outbox[0].key === idempotencyKey("registered", u.id));
  check("password login refused before any password exists", (await P.login(u.email, "anything-at-all")) === 401);

  const again = await registerAccount({ name: "Other", email: "other@atlasuniversity.edu.in", baseType: "STUDENT", school: null, applicationNo: "2507316" }, P.regDeps());
  check("same application number again → 409, no account, no email", again.status === 409 && !P.byEmail("other@atlasuniversity.edu.in") && P.outbox.length === 1);
  const nf = await registerAccount({ name: "Nope", email: "nope@atlasuniversity.edu.in", baseType: "STUDENT", school: null, applicationNo: "0000000" }, P.regDeps());
  check("unknown application number → 422 (field error), nothing created", nf.status === 422 && !!nf.body.issues?.applicationNo && !P.byEmail("nope@atlasuniversity.edu.in"));
  const down = await registerAccount({ name: "Later", email: "later@atlasuniversity.edu.in", baseType: "STUDENT", school: null, applicationNo: "OUTAGE" }, P.regDeps());
  check("verification outage → 503, nothing created", down.status === 503 && !P.byEmail("later@atlasuniversity.edu.in"));
  const dupEmail = await registerAccount({ name: "Dup", email: "asha.s@atlasuniversity.edu.in", baseType: "STUDENT", school: null, applicationNo: "2600001" }, P.regDeps());
  check("existing email → 409 pointing to Google sign-in, no second email", dupEmail.status === 409 && dupEmail.body.error === EXISTS_MESSAGE && P.outbox.length === 1);
}

section("Faculty registration (no password setup)");
{
  const P = portal();
  let verifyCalls = 0;
  const r = await registerAccount({ name: "Dr. Rao", email: "rao.f@atlasuniversity.edu.in", baseType: "FACULTY", school: "uGDX", applicationNo: null },
    P.regDeps({ verifyApplicationNo: async () => { verifyCalls++; return { status: "exists" }; } }));
  const u = P.byEmail("rao.f@atlasuniversity.edu.in");
  check("201 with the Google sign-in message", r.status === 201 && r.body.message === REGISTERED_MESSAGE);
  check("account category = FACULTY, no application number", u?.base_type === "FACULTY" && u.application_no === null && u.school_code === "uGDX");
  check("faculty skip the application-number check (unchanged)", verifyCalls === 0);
  check("no password, not admin, no roles, no token", u.password_hash === null && !u.is_admin && P.roles.get(u.id).length === 0 && P.tokens.length === 0);
  check("one confirmation email, mentioning a faculty account", P.outbox.length === 1 && /faculty account/.test(P.outbox[0].text) && !isPasswordSetupMail(P.outbox[0]));

  const race = await registerAccount({ name: "Race", email: "race@atlasuniversity.edu.in", baseType: "FACULTY", school: null, applicationNo: null },
    P.regDeps({ createAccount: async () => { throw Object.assign(new Error("dup"), { duplicate: true }); } }));
  check("unique-key race → 409, no email", race.status === 409 && P.outbox.length === 1);
  const mailDown = await registerAccount({ name: "Quiet", email: "quiet@atlasuniversity.edu.in", baseType: "FACULTY", school: null, applicationNo: null },
    P.regDeps({ sendRegistrationEmail: async () => ({ ok: false }) }));
  check("email delivery fails → still 201 (emailSent:false), account usable", mailDown.status === 201 && mailDown.body.emailSent === false && !!P.byEmail("quiet@atlasuniversity.edu.in"));
  const thrown = await registerAccount({ name: "Boom", email: "boom@atlasuniversity.edu.in", baseType: "FACULTY", school: null, applicationNo: null },
    P.regDeps({ sendRegistrationEmail: async () => { throw new Error("smtp down"); } }));
  check("email sender throws → still 201", thrown.status === 201 && thrown.body.emailSent === false);
  const tester = await registerAccount({ name: "Tester", email: "tester@gmail.com", baseType: "FACULTY", school: null, applicationNo: null }, P.regDeps());
  check("approved non-university address → googleSignIn:false + Forgot-password guidance", tester.status === 201 && tester.body.googleSignIn === false && /Forgot password/.test(tester.body.message));
  const testerMail = P.outbox.at(-1);
  check("…its email points to Forgot password, not Google", /Forgot password/.test(testerMail.text) && !/Sign in with Google/.test(testerMail.html));
}

section("Registration confirmation email (template)");
{
  const m = registrationConfirmedEmail({ siteUrl: SITE, loginUrl: `${SITE}/login`, name: "<script>x</script>", accountType: "STUDENT" });
  check("subject", m.subject === "Your Research Portal Registration Is Complete");
  check("says to sign in with the ATLAS University Google account", /sign in using your ATLAS University Google account/.test(m.text));
  check("states that no password is needed", /do not need to create a password/i.test(m.text));
  check("mentions the optional password in Account settings", /Account settings/.test(m.text));
  check("HTML-escapes the name", !m.html.includes("<script>") && m.html.includes("&lt;script&gt;"));
  check("no token / confirm / create-password link anywhere", !isPasswordSetupMail(m));
  const ins = await deliverSignInInstructions({ email: "a@atlasuniversity.edu.in", userId: "u1" }, { sendEmail: async (x) => ({ ok: true, x }), siteUrl: SITE, isUniversityEmail });
  check("sign-in instructions email delivers without a token", ins.ok === true);
  const added = passwordChangedEmail({ siteUrl: SITE, loginUrl: `${SITE}/login`, added: true });
  check("'password added' email says both methods now work", /Google account or with your email address and this password/.test(added.text));
}

section("Google Sign-In for registered users");
{
  const P = portal();
  await registerAccount({ name: "Asha", email: "asha@atlasuniversity.edu.in", baseType: "STUDENT", school: null, applicationNo: "2507316" }, P.regDeps());
  await registerAccount({ name: "Rao", email: "rao@atlasuniversity.edu.in", baseType: "FACULTY", school: null, applicationNo: null }, P.regDeps());
  const student = P.byEmail("asha@atlasuniversity.edu.in");
  const faculty = P.byEmail("rao@atlasuniversity.edu.in");
  const admin = P.add({ name: "Admin", email: "admin.x@atlasuniversity.edu.in", base_type: "FACULTY", is_admin: true, roles: ["ADMINISTRATOR"], password_hash: await hashPassword("Admin#Existing2026") });
  const editor = P.add({ name: "Editor", email: "editor.x@atlasuniversity.edu.in", base_type: "FACULTY", roles: ["EDITOR", "PEER_REVIEWER"] });
  const before = Object.fromEntries([student, faculty, admin, editor].map((u) => [u.id, snapshot(P, u.id)]));

  const s1 = await googleSignIn(P, "asha@atlasuniversity.edu.in");
  check("new student (no password) → signed in with Google", s1.outcome === "ok" && s1.userId === student.id && !!s1.session);
  check("…the same user id (no new account), Google identity linked", P.users.size === 4 && P.identities.get("sub-asha@atlasuniversity.edu.in") === student.id);
  check("…email now verified (Google proved the mailbox)", !!P.users.get(student.id).email_confirmed_at);
  const s2 = await googleSignIn(P, "rao@atlasuniversity.edu.in");
  check("new faculty (no password) → signed in with Google", s2.outcome === "ok" && s2.userId === faculty.id);
  const s3 = await googleSignIn(P, "admin.x@atlasuniversity.edu.in");
  check("existing admin with a password, not yet linked → signed in, linked", s3.outcome === "ok" && s3.userId === admin.id && P.identities.get("sub-admin.x@atlasuniversity.edu.in") === admin.id);
  const s4 = await googleSignIn(P, "editor.x@atlasuniversity.edu.in");
  check("existing editor → signed in", s4.outcome === "ok" && s4.userId === editor.id);
  const s5 = await googleSignIn(P, "asha@atlasuniversity.edu.in");
  check("already-linked account → signed in by its linked Google identity", s5.outcome === "ok" && s5.userId === student.id);
  for (const [label, u] of [["student", student], ["faculty", faculty], ["admin", admin], ["editor", editor]]) {
    check(`${label}: id, account type, roles and admin flag unchanged`, snapshot(P, u.id) === before[u.id]);
  }
  check("existing admin's password hash untouched by Google sign-in", (await P.login("admin.x@atlasuniversity.edu.in", "Admin#Existing2026")) === 200);

  const n = P.users.size;
  const unreg = await googleSignIn(P, "stranger@atlasuniversity.edu.in");
  check("unregistered university account → rejected, no account created", unreg.outcome === "rejected:not_registered" && /google_not_registered/.test(unreg.redirect) && P.users.size === n && !unreg.session);
  const gmail = await googleSignIn(P, "asha.personal@gmail.com", { hd: undefined });
  check("non-university Google account → rejected", gmail.outcome === "rejected:domain" && /google_domain/.test(gmail.redirect));
  const lookalike = await googleSignIn(P, "asha@atlasuniversity.edu.in.evil.com");
  check("look-alike domain → rejected", lookalike.outcome === "rejected:domain");
  const unverified = await googleSignIn(P, "rao@atlasuniversity.edu.in", { email_verified: false });
  check("unverified Google email → rejected", unverified.outcome === "rejected:unverified");
  const disabledU = P.add({ name: "Off", email: "off@atlasuniversity.edu.in", base_type: "STUDENT", status: "DISABLED" });
  const dis = await googleSignIn(P, disabledU.email);
  check("disabled account → rejected", dis.outcome === "rejected:disabled" && !dis.session);
  check("rejections never changed roles", [student, faculty, admin, editor].every((u) => snapshot(P, u.id) === before[u.id]));
  const src = read("../lib/googleAuth.js");
  check("production completeSignIn writes no role / admin data", !/userRoles|isAdmin|is_admin|setUserRoles/.test(src.slice(src.indexOf("export async function completeSignIn"))));
}

section("Optional password after Google sign-in");
{
  const P = portal();
  await registerAccount({ name: "Asha", email: "asha@atlasuniversity.edu.in", baseType: "STUDENT", school: null, applicationNo: "2507316" }, P.regDeps());
  const u = P.byEmail("asha@atlasuniversity.edu.in");
  const before = snapshot(P, u.id);
  const anon = await addPassword({ password: "Strong#Pass2026", confirm: "Strong#Pass2026" }, addPwDeps(P, "no-such-session"));
  check("not signed in → 401, nothing stored", anon.status === 401 && anon.body.code === "signin_required" && u.password_hash === null);

  const { session } = await googleSignIn(P, u.email);
  const otherDevice = (await googleSignIn(P, u.email)).session;
  const weak = await addPassword({ password: "short", confirm: "short" }, addPwDeps(P, session));
  check("too short → 422, nothing stored", weak.status === 422 && u.password_hash === null);
  const mismatch = await addPassword({ password: "Strong#Pass2026", confirm: "Strong#Pass2027" }, addPwDeps(P, session));
  check("confirmation mismatch → 422", mismatch.status === 422 && mismatch.body.issues?.confirm);
  const ok = await addPassword({ password: "Strong#Pass2026", confirm: "Strong#Pass2026" }, addPwDeps(P, session));
  check("signed in with Google → password set (200)", ok.status === 200 && ok.body.ok === true);
  check("stored as Argon2id, never plain text", /^\$argon2id\$/.test(u.password_hash) && !u.password_hash.includes("Strong#Pass2026"));
  check("this browser stays signed in", !P.sessions.find((s) => s.token === session).revoked);
  check("other devices are signed out", P.sessions.find((s) => s.token === otherDevice).revoked);
  check("'password added' confirmation email sent", P.outbox.some((m) => m.purpose === "password_added"));
  check("roles, admin flag, account type and id unchanged", snapshot(P, u.id) === before);
  check("password login now works", (await P.login(u.email, "Strong#Pass2026")) === 200);
  check("wrong password still refused", (await P.login(u.email, "Wrong#Pass2026")) === 401);
  check("Google sign-in still works too", (await googleSignIn(P, u.email)).outcome === "ok");
  const hash = u.password_hash;
  const again = await addPassword({ password: "Another#Pass2026", confirm: "Another#Pass2026" }, addPwDeps(P, session));
  check("second attempt → 409, existing password NOT overwritten", again.status === 409 && again.body.code === "password_exists" && u.password_hash === hash);
  const failing = await addPassword({ password: "Strong#Pass2028", confirm: "Strong#Pass2028" }, addPwDeps(P, session, { setInitialPassword: async () => ({}) }));
  check("storage failure → 500", failing.status === 500);
  const notifyFails = portal();
  await registerAccount({ name: "B", email: "b@atlasuniversity.edu.in", baseType: "FACULTY", school: null, applicationNo: null }, notifyFails.regDeps());
  const bs = (await googleSignIn(notifyFails, "b@atlasuniversity.edu.in")).session;
  const nf = await addPassword({ password: "Strong#Pass2026", confirm: "Strong#Pass2026" }, addPwDeps(notifyFails, bs, { notifyPasswordAdded: async () => { throw new Error("smtp"); } }));
  check("email failure never undoes the password", nf.status === 200 && !!notifyFails.byEmail("b@atlasuniversity.edu.in").password_hash);
}

section("Existing accounts, forgot password, resend");
{
  const P = portal();
  const pwStudent = P.add({ name: "S", email: "old.student@atlasuniversity.edu.in", base_type: "STUDENT", application_no: "1111111", password_hash: await hashPassword("Student#Old2026") });
  const pwFaculty = P.add({ name: "F", email: "old.faculty@atlasuniversity.edu.in", base_type: "FACULTY", password_hash: await hashPassword("Faculty#Old2026") });
  check("existing student with a password → password login works", (await P.login(pwStudent.email, "Student#Old2026")) === 200);
  check("existing faculty with a password → password login works", (await P.login(pwFaculty.email, "Faculty#Old2026")) === 200);
  const blank = await addPassword({ password: "New#Password2026", confirm: "New#Password2026" }, addPwDeps(P, P.startSession(pwStudent.id)));
  check("Set-password can't overwrite an existing password (409)", blank.status === 409 && (await P.login(pwStudent.email, "Student#Old2026")) === 200);

  const sent = [];
  const deps = {
    isApprovedEmail: (e) => e.endsWith("@atlasuniversity.edu.in"),
    rateLimit: () => true,
    findUserByEmail: async (e) => P.byEmail(e),
    sendRecovery: async (e, flow) => { sent.push(["recovery", e, flow]); return { error: null }; },
    sendSignInInstructions: async (e) => { sent.push(["instructions", e]); return { error: null }; },
  };
  await registerAccount({ name: "N", email: "new.one@atlasuniversity.edu.in", baseType: "FACULTY", school: null, applicationNo: null }, P.regDeps());
  await resendSetupEmail({ email: pwStudent.email, ip: "1.1.1.1", purpose: "reset" }, deps);
  check("forgot password (has a password) → reset link", sent.at(-1).join() === `recovery,${pwStudent.email},reset`);
  await resendSetupEmail({ email: "new.one@atlasuniversity.edu.in", ip: "1.1.1.1", purpose: "reset" }, deps);
  check("forgot password (no password yet) → reset link (explicit request)", sent.at(-1).join() === "recovery,new.one@atlasuniversity.edu.in,reset");
  const ghost = await resendSetupEmail({ email: "ghost@atlasuniversity.edu.in", ip: "1.1.1.1", purpose: "reset" }, deps);
  const known = await resendSetupEmail({ email: pwStudent.email, ip: "1.1.1.1", purpose: "reset" }, deps);
  check("same neutral answer for unknown accounts", JSON.stringify(ghost) === JSON.stringify(known));
  const n = sent.length;
  await resendSetupEmail({ email: "new.one@atlasuniversity.edu.in", ip: "1.1.1.1" }, deps);
  check("'resend' sends sign-in instructions, never a password link", sent.length === n + 1 && sent.at(-1)[0] === "instructions");
}

section("Wiring (source checks)");
{
  const route = read("../app/api/register/route.js");
  const regLib = read("../lib/registration.js");
  const server = read("../lib/authServer.js");
  check("register route uses the Google-first core", /registerAccount\(data, registrationDeps\(\)\)/.test(route));
  check("register route issues no token and sends no invite", !/issueToken|deliverInvite|generateLink|registerAndInvite/.test(route + regLib));
  const regDepsSrc = server.slice(server.indexOf("export function registrationDeps"), server.indexOf("export async function sendSignInInstructions"));
  check("registration deps create the account directly + send the confirmation email only", /createRegisteredUser/.test(regDepsSrc) && /deliverRegistrationConfirmed/.test(regDepsSrc) && !/issueToken|deliverInvite|generateLink/.test(regDepsSrc));
  check("no route sends the legacy invite", !/legacyDeliverInvite|sendInvite\(/.test(["../app/api/register/route.js", "../app/api/auth/resend/route.js", "../app/api/auth/forgot-password/route.js"].map(read).join("")));
  const acct = read("../app/api/account/password/route.js");
  check("Set-password API takes the user only from the APP session", /addPasswordDeps/.test(acct) && !/userId|body\?\.id|body\.id/.test(acct));
  const addDeps = server.slice(server.indexOf("export const addPasswordDeps"));
  check("…hashes with Argon2id and never overwrites (passwordHash IS NULL)", /hashPassword\(password\)/.test(addDeps) && /setInitialPasswordHash/.test(addDeps) && /passwordHash IS NULL/.test(read("../lib/repos/users.mjs")));
  check("…keeps this session, revokes the others", /exceptToken: keep/.test(addDeps));
  const login = read("../app/(auth)/login/page.js");
  check("login page: Google button first and prominent", login.indexOf("<GoogleSignInButton") < login.indexOf("<LoginForm") && /<GoogleSignInButton next=\{next\} prominent \/>/.test(login));
  check("login page keeps email/password sign-in + Forgot password", /<LoginForm next=\{next\} \/>/.test(login) && /\/auth\/forgot-password/.test(login));
  check("login page no longer advertises 'Resend setup email'", !/Resend setup email/.test(login));
  const reg = read("../app/(auth)/register/page.js");
  check("registration success shows the exact message", reg.includes("Your registration is successful. You can now sign in using your ATLAS University Google account."));
  check("registration success offers Sign in with Google", /<GoogleSignInButton prominent \/>/.test(reg));
  check("Account settings page renders the Set password form", /<CreatePasswordForm mode="add" \/>/.test(read("../app/(app)/account/page.js")));
  check("/account is behind the signed-in gate", /"\/account"/.test(read("../middleware.js")));
}

console.log(`\n${failures === 0 ? "✓ PASS" : `✗ FAIL — ${failures} check(s) failed.`} — ${total - failures}/${total} checks (Google-first registration & sign-in)`);
process.exit(failures === 0 ? 0 : 1);
