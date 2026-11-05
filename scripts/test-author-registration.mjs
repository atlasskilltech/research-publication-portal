/**
 * External AUTHOR registration + Google Sign-In (AIDC 2026) — offline suite
 * (no database, no network). Runs the SAME functions production uses:
 *
 *   lib/authorRegistration   validateAuthorRegistration + registerAuthor
 *   lib/oauthPolicy          completeGoogleCallback / validateIdTokenClaims /
 *                            decideAccount / buildAuthorizeUrl, with REAL RS256
 *                            ID tokens verified against a local JWKS
 *   lib/authMailer + templates  the Author confirmation email
 *
 * The Google callback runs against an in-memory "world" that records every
 * account, identity link, session and email it would create.
 *
 *   node scripts/test-author-registration.mjs
 */
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import {
  validateAuthorRegistration, registerAuthor, AUTHOR_STATUSES, AUTHOR_STATUS_VALUES, CONFERENCE_NAME,
  isValidPhone, AUTHOR_EXISTS_MESSAGE,
} from "../lib/authorRegistration.js";
import {
  completeGoogleCallback, verifyIdTokenSignature, validateIdTokenClaims, decideAccount, buildAuthorizeUrl,
  GOOGLE_NOTICES, noticeForReason, GOOGLE_ALLOWED_DOMAIN, isPlainEmail,
} from "../lib/oauthPolicy.js";
import { deliverAuthorRegistrationConfirmed, deliverSignInInstructions } from "../lib/authMailer.js";
import { idempotencyKey } from "../lib/email/core.js";
import { safeNextPath } from "../lib/authFlow.js";

let failures = 0, total = 0;
const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);

const VALID = {
  name: "Priya Menon", email: "Priya.Menon@Gmail.com", phone: "+91 98765 43210", organization: "National Institute of Design",
  currentStatus: "RESEARCHER", designation: "M.Des Interaction Design", location: "Ahmedabad, India",
  password: "Strong#Pass2026", confirmPassword: "Strong#Pass2026",
};

// ================================================================================
section("Registration form validation (validateAuthorRegistration)");
{
  const v = validateAuthorRegistration(VALID);
  check("valid Author registration → ok", v.ok);
  check("email normalised to lower case", v.data?.email === "priya.menon@gmail.com");
  check("all 7 fields returned", v.ok && ["name", "email", "phone", "organization", "currentStatus", "designation", "location"].every((k) => v.data[k]));
  for (const s of AUTHOR_STATUSES) {
    const r = validateAuthorRegistration({ ...VALID, currentStatus: s.value });
    check(`current status "${s.label}" (${s.value}) → accepted`, r.ok && r.data.currentStatus === s.value);
  }
  check("exactly the 5 required status options", JSON.stringify(AUTHOR_STATUSES.map((s) => s.label)) === JSON.stringify(["Working Professional", "Student", "Researcher", "Independent Researcher", "Other"]));
  check("lower-case status value is normalised", validateAuthorRegistration({ ...VALID, currentStatus: "independent_researcher" }).ok);
  check("unknown status → rejected", validateAuthorRegistration({ ...VALID, currentStatus: "ADMINISTRATOR" }).fields?.currentStatus);

  for (const f of ["name", "email", "phone", "organization", "currentStatus", "designation", "location"]) {
    const r = validateAuthorRegistration({ ...VALID, [f]: "" });
    check(`missing ${f} → rejected with a ${f} message`, !r.ok && typeof r.fields[f] === "string");
    const r2 = validateAuthorRegistration({ ...VALID, [f]: "   " });
    check(`whitespace-only ${f} → rejected`, !r2.ok && !!r2.fields[f]);
  }
  check("completely empty body → every field reported (7 profile fields + password)", Object.keys(validateAuthorRegistration({}).fields || {}).length === 8);
  check("password returned separately, never inside data", (() => { const r = validateAuthorRegistration(VALID); return r.ok && r.password === VALID.password && !("password" in r.data) && !("confirmPassword" in r.data); })());
  check("missing password → rejected", !!validateAuthorRegistration({ ...VALID, password: "", confirmPassword: "" }).fields?.password);
  check("missing confirm password → rejected", !!validateAuthorRegistration({ ...VALID, confirmPassword: "" }).fields?.confirmPassword);
  check("password shorter than 10 characters → rejected", !!validateAuthorRegistration({ ...VALID, password: "Short#1", confirmPassword: "Short#1" }).fields?.password);
  check("password longer than 200 characters → rejected", !!validateAuthorRegistration({ ...VALID, password: "x".repeat(201), confirmPassword: "x".repeat(201) }).fields?.password);
  check("passwords that don't match → rejected on confirmPassword", !!validateAuthorRegistration({ ...VALID, confirmPassword: "Strong#Pass2027" }).fields?.confirmPassword);
  check("non-string password → rejected", !!validateAuthorRegistration({ ...VALID, password: 12345678901, confirmPassword: 12345678901 }).fields?.password);
  check("null body → rejected, no throw", validateAuthorRegistration(null).ok === false);

  for (const e of ["not-an-email", "a@b", "a@@b.com", "a b@c.com", "@gmail.com", "user@", "a@b@c.com", `${"x".repeat(190)}@gmail.com`]) {
    check(`invalid email ${JSON.stringify(e.length > 40 ? e.slice(0, 20) + "…" : e)} → rejected`, !!validateAuthorRegistration({ ...VALID, email: e }).fields?.email);
  }
  for (const e of ["a@gmail.com", "prof@iitb.ac.in", "x.y@nid.edu", "someone@atlasuniversity.edu.in", "first+tag@company.co.uk"]) {
    check(`any domain accepted: ${e}`, validateAuthorRegistration({ ...VALID, email: e }).ok);
  }

  for (const p of ["12345", "abcdefghij", "+91 98765 4321O", "98765-43210-12345-678", "++919876543210", "+", "----", "1".repeat(16)]) {
    check(`invalid phone ${JSON.stringify(p)} → rejected`, !!validateAuthorRegistration({ ...VALID, phone: p }).fields?.phone);
  }
  check("line breaks in the phone are normalised to a space (nothing multi-line is stored)", validateAuthorRegistration({ ...VALID, phone: "+91 98765\n43210" }).data?.phone === "+91 98765 43210");
  for (const p of ["9876543210", "+91 98765 43210", "+1 (415) 555-0132", "022-2345-6789", "+44 20 7946 0958"]) {
    check(`valid phone ${JSON.stringify(p)} → accepted`, isValidPhone(p));
  }
  check("name with control characters → rejected", !!validateAuthorRegistration({ ...VALID, name: "Pri\u0000ya" }).fields?.name);
  check("over-long organization → rejected", !!validateAuthorRegistration({ ...VALID, organization: "x".repeat(201) }).fields?.organization);
  check("one-character designation → rejected", !!validateAuthorRegistration({ ...VALID, designation: "x" }).fields?.designation);
  check("client cannot smuggle a role / admin flag (ignored)", (() => { const r = validateAuthorRegistration({ ...VALID, isAdmin: true, roles: ["ADMINISTRATOR"], baseType: "FACULTY" }); return r.ok && !("isAdmin" in r.data) && !("roles" in r.data) && !("baseType" in r.data); })());
}

section("Registration orchestration (registerAuthor) — account + session + one email");
{
  const v = validateAuthorRegistration(VALID);
  const log = { created: [], sessions: [], emails: [], passwords: [] };
  const deps = (existing, { emailFails = false, race = false } = {}) => ({
    findUserByEmail: async (e) => (existing && e === existing ? { id: "U-x", email: e } : null),
    createAuthor: async ({ data, password }) => {
      if (race) throw Object.assign(new Error("dup"), { duplicate: true });
      log.passwords.push(password); log.created.push(data.email); return `A-${log.created.length}`;
    },
    startSession: async (id) => { log.sessions.push(id); },
    sendConfirmation: async (m) => { log.emails.push(m); if (emailFails) throw new Error("smtp"); return { ok: true }; },
  });
  const ok = await registerAuthor(v.data, v.password, deps(null));
  check("valid → 201, account created, signed in, → /dashboard", ok.status === 201 && ok.body.ok && ok.body.redirect === "/dashboard" && log.created.length === 1 && log.sessions[0] === "A-1");
  check("exactly one confirmation email, to the registered address", log.emails.length === 1 && log.emails[0].email === "priya.menon@gmail.com" && ok.body.emailSent === true);
  check("password handed only to createAuthor (for hashing), never in the response", log.passwords[0] === VALID.password && !JSON.stringify(ok.body).includes(VALID.password));
  const dup = await registerAuthor(v.data, v.password, deps(v.data.email));
  check("duplicate email (existing account) → 409, nothing created, no session", dup.status === 409 && dup.body.code === "exists" && dup.body.error === AUTHOR_EXISTS_MESSAGE && log.created.length === 1 && log.sessions.length === 1);
  const race = await registerAuthor(v.data, v.password, deps(null, { race: true }));
  check("unique-key race → 409, no session", race.status === 409 && log.sessions.length === 1);
  const mailFail = await registerAuthor(v.data, v.password, deps(null, { emailFails: true }));
  check("email delivery failure never fails the registration", mailFail.status === 201 && mailFail.body.emailSent === false);
}

// ================================================================================
// Google: real RS256 tokens against a local JWKS
const CLIENT_ID = "rpp-test.apps.googleusercontent.com";
const NOW = Math.floor(Date.now() / 1000);
const { publicKey, privateKey } = await generateKeyPair("RS256");
const JWKS = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
async function idToken(claims = {}) {
  const base = {
    iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, sub: `sub-${Math.random().toString(36).slice(2)}`,
    email: "user@atlasuniversity.edu.in", email_verified: true, hd: GOOGLE_ALLOWED_DOMAIN, nonce: "N0NCE", iat: NOW, exp: NOW + 3600, ...claims,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return new SignJWT(base).setProtectedHeader({ alg: "RS256", kid: "k1" }).sign(privateKey);
}

function world() {
  const users = new Map(); const identities = new Map(); const states = new Map();
  const log = { sessions: [], links: [] };
  const add = (u) => { users.set(u.id, { status: "ACTIVE", is_admin: false, roles: [], email_confirmed_at: "2026-10-01T00:00:00.000Z", ...u }); return users.get(u.id); };
  const deps = (tok) => ({
    clientId: CLIENT_ID, nowS: () => NOW,
    consumeState: async (s) => { const r = states.get(s); states.delete(s); return r || null; },
    exchangeCode: async () => ({ id_token: tok }),
    verifyIdToken: (t) => verifyIdTokenSignature(t, JWKS, CLIENT_ID),
    findIdentity: async (sub) => (identities.has(sub) ? users.get(identities.get(sub)) : null),
    findUserByEmail: async (e) => [...users.values()].find((u) => u.email === e) || null,
    linkedSubFor: async (id) => [...identities.entries()].find(([, uid]) => uid === id)?.[0] || null,
    completeSignIn: async ({ userId, link, verifyEmail, claims }) => {
      if (link) { identities.set(claims.sub, userId); log.links.push(userId); }
      if (verifyEmail) users.get(userId).email_confirmed_at = "now";
      log.sessions.push(userId);
    },
    safeNext: safeNextPath,
  });
  const begin = () => { const s = `st_${Math.random().toString(36).slice(2)}`; states.set(s, { nonce: "N0NCE", codeVerifier: "V", next: "/dashboard" }); return s; };
  return { users, identities, log, add, deps, begin };
}
async function cb(w, { claims = {} } = {}) {
  const s = w.begin();
  const tok = await idToken(claims);
  return completeGoogleCallback({ params: { code: "c", state: s }, cookieState: s }, w.deps(tok));
}

section("Google Sign-In is NOT available for Authors");
{
  const w = world();
  w.add({ id: "A1", email: "priya@gmail.com", base_type: "AUTHOR" });
  w.add({ id: "A2", email: "linked@gmail.com", base_type: "AUTHOR" });
  w.identities.set("G-linked", "A2"); // an identity linked under the earlier Google-based flow
  w.add({ id: "A3", email: "author@atlasuniversity.edu.in", base_type: "AUTHOR" });
  const r1 = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-p" } });
  check("Author (Gmail) via Google → refused with the Author message, no session, no link", r1.outcome === "rejected:author_google_disabled" && r1.redirect === "/login?notice=author_google_disabled" && w.log.sessions.length === 0 && !w.identities.has("G-p"));
  const r2 = await cb(w, { claims: { email: "linked@gmail.com", hd: undefined, sub: "G-linked" } });
  check("Author with an ALREADY LINKED Google identity → refused", r2.outcome === "rejected:author_google_disabled" && w.log.sessions.length === 0);
  const r3 = await cb(w, { claims: { email: "author@atlasuniversity.edu.in", sub: "G-a3" } });
  check("Author with an ATLAS Google account → refused too", r3.outcome === "rejected:author_google_disabled" && w.log.sessions.length === 0);
  check("message tells Authors to use email + password / Forgot password", /email address and password/.test(GOOGLE_NOTICES.author_google_disabled) && /Forgot password/.test(GOOGLE_NOTICES.author_google_disabled));
  check("decideAccount refuses AUTHOR by email and by linked identity",
    decideAccount({ claims: { sub: "x", email: "priya@gmail.com" }, identity: null, byEmail: w.users.get("A1"), linkedSub: null }).reason === "author_google_disabled"
    && decideAccount({ claims: { sub: "G-linked", email: "linked@gmail.com" }, identity: w.users.get("A2") }).reason === "author_google_disabled");
  check("Author accounts unchanged (still AUTHOR, not admin)", ["A1", "A2", "A3"].every((id) => w.users.get(id).base_type === "AUTHOR" && !w.users.get(id).is_admin));
}

section("Google Sign-In for Student / Faculty / Admin / Editor / Reviewer — unchanged");
{
  const w = world();
  w.add({ id: "S1", email: "student@atlasuniversity.edu.in", base_type: "STUDENT" });
  w.add({ id: "F1", email: "faculty@atlasuniversity.edu.in", base_type: "FACULTY" });
  w.add({ id: "AD", email: "admin@atlasuniversity.edu.in", base_type: "FACULTY", is_admin: true, roles: ["ADMINISTRATOR"] });
  w.add({ id: "ED", email: "editor@atlasuniversity.edu.in", base_type: "FACULTY", roles: ["EDITOR"] });
  w.add({ id: "RV", email: "reviewer@atlasuniversity.edu.in", base_type: "FACULTY", roles: ["PEER_REVIEWER"] });
  w.add({ id: "X1", email: "sf48116@gmail.com", base_type: "STUDENT" });
  const before = JSON.stringify([...w.users.values()].map((u) => [u.id, u.base_type, u.is_admin, u.roles]));
  for (const [id, email, extra] of [["S1", "student@atlasuniversity.edu.in"], ["F1", "faculty@atlasuniversity.edu.in"], ["AD", "admin@atlasuniversity.edu.in"],
    ["ED", "editor@atlasuniversity.edu.in"], ["RV", "reviewer@atlasuniversity.edu.in"], ["X1", "sf48116@gmail.com", { hd: undefined }]]) {
    const r = await cb(w, { claims: { email, sub: `G-${id}`, ...(extra || {}) } });
    check(`${w.users.get(id).base_type}${w.users.get(id).is_admin ? " admin" : ""} ${email} → signed in to its own account`, r.outcome === "ok" && r.userId === id);
  }
  check("no base type, admin flag or role changed", JSON.stringify([...w.users.values()].map((u) => [u.id, u.base_type, u.is_admin, u.roles])) === before);
  check("no account created", w.users.size === 6);
  const unv = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", email_verified: false } });
  check("unverified Google email → refused", unv.outcome === "rejected:unverified");
  const hd = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", hd: undefined } });
  check("@atlasuniversity.edu.in not from the ATLAS Workspace → refused", hd.outcome === "rejected:hd_mismatch");
  const other = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", sub: "G-OTHER" } });
  check("account already linked to a different Google account → refused", other.outcome === "rejected:identity_mismatch");
  const s0 = w.log.sessions.length;
  const stranger = await cb(w, { claims: { email: "stranger@gmail.com", hd: undefined } });
  check("unregistered Google user → refused, no account, no session (Google never creates accounts)", stranger.outcome === "rejected:not_registered" && w.users.size === 6 && w.log.sessions.length === s0);
  check("…message points external authors to Author registration + email/password", /register as an Author/.test(GOOGLE_NOTICES[noticeForReason("not_registered")]) && /email and password/.test(GOOGLE_NOTICES[noticeForReason("not_registered")]));
}

section("Authorize URL");
{
  const base = { clientId: CLIENT_ID, redirectUri: "https://portal.example/auth/callback", state: "s", nonce: "n", codeChallenge: "c" };
  const u = new URL(buildAuthorizeUrl(base));
  check("one flow: no hd hint, PKCE S256, state, nonce", !u.searchParams.has("hd") && u.searchParams.get("code_challenge_method") === "S256" && u.searchParams.get("state") === "s" && u.searchParams.get("nonce") === "n");
  check("isPlainEmail rejects look-alikes / whitespace", !isPlainEmail("a@b") && !isPlainEmail("a b@c.com") && !isPlainEmail("a@b@c.com") && isPlainEmail("a@b.co"));
}

section("SendGrid email: Author confirmation (existing mail pipeline)");
{
  const sent = [];
  const sendEmail = async (m) => { sent.push(m); return { ok: true }; };
  const r = await deliverAuthorRegistrationConfirmed({ email: "priya@gmail.com", name: "Priya Menon", userId: "A1" }, { sendEmail, siteUrl: "https://research.example/" });
  const m = sent[0];
  check("sent through the shared sendEmail (one message)", r.ok && sent.length === 1 && m.to === "priya@gmail.com");
  check("idempotency key = user id → retries never send a second copy", m.key === idempotencyKey("author-registered", "A1"));
  check("mentions the conference name", m.text.includes(CONFERENCE_NAME) && m.subject.includes("AIDC 2026"));
  check("confirmation tells the Author to sign in with email + password (Google not available)", /email address and the password you chose/.test(m.text) && /Google Sign-In is not available for Author accounts/.test(m.text));
  check("confirmation contains no password", !m.text.includes(VALID.password) && !m.html.includes(VALID.password));
  check("no token, no password link", !/token|password=|reset-password|create-password/i.test(m.text.replace(/You do not need a password\./, "")));
  check("no invented dates, fees, deadlines, guarantees or IEEE claims", !/\bIEEE\b|fee|deadline|guarantee|\b20(2[7-9]|3\d)\b|\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(m.text + m.subject));
  check("HTML escapes the name", (await (async () => { sent.length = 0; await deliverAuthorRegistrationConfirmed({ email: "x@y.com", name: "<b>x</b>", userId: "A2" }, { sendEmail, siteUrl: "https://r.example" }); return !sent[0].html.includes("<b>x</b>"); })()));
  sent.length = 0;
  await deliverSignInInstructions({ email: "priya@gmail.com", userId: "A1", external: true, author: true }, { sendEmail, siteUrl: "https://r.example", isUniversityEmail: () => true });
  check("sign-in reminder for an Author: email + password, Forgot password, Google not available", /email address and password/.test(sent[0].text) && /Forgot password/.test(sent[0].text) && /not available for Author/.test(sent[0].text) && !/Sign in with Google/.test(sent[0].text));
  sent.length = 0;
  await deliverSignInInstructions({ email: "sf48116@gmail.com", userId: "X1", external: true }, { sendEmail, siteUrl: "https://r.example", isUniversityEmail: () => true });
  check("sign-in reminder for sf48116@gmail.com now points to Google too", /Sign in with Google/.test(sent[0].text) && !/can't use Google sign-in/.test(sent[0].text));
}

section("Branding");
check("conference name exactly as specified", CONFERENCE_NAME === "AIDC – ATLAS International Design Conference 2026");
check("status values match the database ENUM", JSON.stringify(AUTHOR_STATUS_VALUES) === JSON.stringify(["WORKING_PROFESSIONAL", "STUDENT", "RESEARCHER", "INDEPENDENT_RESEARCHER", "OTHER"]));

console.log(`\n${failures ? `✗ FAIL — ${failures} check(s) failed.` : "✓ PASS"} — ${total - failures}/${total} checks (external Author registration & Google sign-in)`);
process.exit(failures ? 1 : 0);
