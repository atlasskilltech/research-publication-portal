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
  check("completely empty body → every field reported", Object.keys(validateAuthorRegistration({}).fields || {}).length === 7);
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

section("Registration orchestration (registerAuthor) — pending only, no account");
{
  const data = validateAuthorRegistration(VALID).data;
  let pendingCreated = 0;
  const deps = (existing) => ({
    findUserByEmail: async (e) => (existing && e === existing ? { id: "U-x", email: e } : null),
    createPending: async () => { pendingCreated++; return { id: "R1", token: "T".repeat(43) }; },
  });
  const ok = await registerAuthor(data, deps(null));
  check("valid → 201 pending (no account created yet)", ok.status === 201 && ok.body.pending === true && ok.body.email === data.email && pendingCreated === 1);
  check("raw token returned for the httpOnly cookie, never in the JSON body", ok.token && !JSON.stringify(ok.body).includes(ok.token));
  const dup = await registerAuthor(data, deps(data.email));
  check("duplicate email (existing account) → 409, no pending row", dup.status === 409 && dup.body.code === "exists" && dup.body.error === AUTHOR_EXISTS_MESSAGE && pendingCreated === 1);
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
  const users = new Map(); const identities = new Map(); const states = new Map(); const pending = new Map();
  const log = { sessions: [], created: [], emails: [] };
  const add = (u) => { users.set(u.id, { status: "ACTIVE", is_admin: false, email_confirmed_at: "2026-10-01T00:00:00.000Z", ...u }); return users.get(u.id); };
  const addPending = (r) => { pending.set(r.id, { expired: false, ...r }); return r; };
  const deps = (tok) => ({
    clientId: CLIENT_ID, nowS: () => NOW,
    consumeState: async (s) => { const r = states.get(s); states.delete(s); return r || null; },
    exchangeCode: async () => ({ id_token: tok }),
    verifyIdToken: (t) => verifyIdTokenSignature(t, JWKS, CLIENT_ID),
    findIdentity: async (sub) => (identities.has(sub) ? users.get(identities.get(sub)) : null),
    findUserByEmail: async (e) => [...users.values()].find((u) => u.email === e) || null,
    linkedSubFor: async (id) => [...identities.entries()].find(([, uid]) => uid === id)?.[0] || null,
    completeSignIn: async ({ userId, link, verifyEmail, claims }) => {
      if (link) identities.set(claims.sub, userId);
      if (verifyEmail) users.get(userId).email_confirmed_at = "now";
      log.sessions.push(userId);
    },
    safeNext: safeNextPath,
    findAuthorRegistration: async (id) => { const r = pending.get(id); return r && !r.expired ? r : null; },
    activateAuthor: async ({ registration, claims }) => {
      const r = pending.get(registration.id);
      if (!r || r.expired || r.email !== claims.email) return null;
      pending.delete(registration.id);
      const id = `A-${users.size + 1}`;
      add({ id, email: r.email, name: r.name, base_type: "AUTHOR", is_admin: false, roles: [] });
      identities.set(claims.sub, id);
      log.created.push(id);
      return id;
    },
    sendAuthorConfirmation: async (m) => { log.emails.push(m); return { ok: true }; },
  });
  const begin = (extra = {}) => { const s = `st_${Math.random().toString(36).slice(2)}`; states.set(s, { nonce: "N0NCE", codeVerifier: "V", next: "/dashboard", ...extra }); return s; };
  return { users, identities, pending, log, add, addPending, deps, begin };
}
async function cb(w, { claims = {}, reg = null } = {}) {
  const s = w.begin(reg ? { authorRegistrationId: reg } : {});
  const tok = await idToken(claims);
  return completeGoogleCallback({ params: { code: "c", state: s }, cookieState: s }, w.deps(tok));
}
const reg = (w, email, id = `R-${Math.random().toString(36).slice(2)}`) => w.addPending({ id, email, name: "Priya Menon" }).id;

// The ONE Google button: every case below goes through the same callback; the
// only difference between flows is whether this browser held a pending
// Author registration (flow.authorRegistrationId).

section("Unified Google sign-in: existing accounts keep exactly their stored role");
{
  const w = world();
  w.add({ id: "S1", email: "student@atlasuniversity.edu.in", base_type: "STUDENT" });
  w.add({ id: "F1", email: "faculty@atlasuniversity.edu.in", base_type: "FACULTY", roles: ["PEER_REVIEWER"] });
  w.add({ id: "AD", email: "admin@atlasuniversity.edu.in", base_type: "FACULTY", is_admin: true, roles: ["ADMINISTRATOR"] });
  w.add({ id: "ED", email: "editor@atlasuniversity.edu.in", base_type: "FACULTY", roles: ["EDITOR"] });
  w.add({ id: "X1", email: "sf48116@gmail.com", base_type: "STUDENT" }); // existing user with a personal Gmail
  w.add({ id: "A1", email: "priya@gmail.com", base_type: "AUTHOR" });
  const before = JSON.stringify([...w.users.values()].map((u) => [u.id, u.base_type, u.is_admin, u.roles]));

  const s = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", sub: "G-s" } });
  check("1. existing Student, ATLAS Google account → signed in as that Student", s.outcome === "ok" && s.userId === "S1" && !s.created);
  const f = await cb(w, { claims: { email: "faculty@atlasuniversity.edu.in", sub: "G-f" } });
  check("2. existing Faculty, ATLAS Google account → signed in as that Faculty", f.outcome === "ok" && f.userId === "F1");
  const x = await cb(w, { claims: { email: "sf48116@gmail.com", hd: undefined, sub: "G-x" } });
  check("3. existing user with a personal Gmail (sf48116@gmail.com) → signed in, Google linked", x.outcome === "ok" && x.userId === "X1" && w.identities.get("G-x") === "X1");
  const a = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-p" } });
  check("4. existing Author, verified Gmail → signed in (same button, no re-registration)", a.outcome === "ok" && a.userId === "A1" && !a.created);
  const ad = await cb(w, { claims: { email: "admin@atlasuniversity.edu.in", sub: "G-ad" } });
  const ed = await cb(w, { claims: { email: "editor@atlasuniversity.edu.in", sub: "G-ed" } });
  check("8. existing Admin and Editor → signed in to their own accounts", ad.userId === "AD" && ed.userId === "ED");
  check("no base type, admin flag or role changed by any sign-in", JSON.stringify([...w.users.values()].map((u) => [u.id, u.base_type, u.is_admin, u.roles])) === before);
  check("no account created by any of these sign-ins", w.log.created.length === 0 && w.users.size === 6);

  const again = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-p" } });
  check("later sign-ins match by the linked Google sub", again.userId === "A1");
  const other = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-OTHER" } });
  check("same email from a DIFFERENT Google account → refused (identity_mismatch)", other.outcome === "rejected:identity_mismatch");
  w.add({ id: "OFF", email: "off@gmail.com", base_type: "STUDENT", status: "DISABLED" });
  const off = await cb(w, { claims: { email: "off@gmail.com", hd: undefined } });
  check("disabled account → refused", off.outcome === "rejected:disabled");
  const unv = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", email_verified: false } });
  check("unverified Google email → refused", unv.outcome === "rejected:unverified" && unv.redirect === "/login?notice=google_unverified");
  const unvStr = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-p", email_verified: "true" } });
  check("email_verified as the string \"true\" → refused", unvStr.outcome === "rejected:unverified");
  const hd = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", hd: undefined } });
  check("@atlasuniversity.edu.in address NOT from the ATLAS Workspace (no hd) → refused", hd.outcome === "rejected:hd_mismatch");
  const hd2 = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", hd: "gmail.com" } });
  check("@atlasuniversity.edu.in address with another hd → refused", hd2.outcome === "rejected:hd_mismatch");
}

section("Unified Google sign-in: new external Author (pending registration)");
{
  const w = world();
  const r1 = await cb(w, { claims: { email: "priya.menon@gmail.com", hd: undefined, sub: "G-gmail" }, reg: reg(w, "priya.menon@gmail.com") });
  check("5. new external user, Author form + Gmail → AUTHOR created, signed in, → /dashboard", r1.outcome === "ok" && r1.created === true && r1.redirect === "/dashboard" && w.log.sessions.includes(r1.userId));
  const u1 = w.users.get(r1.userId);
  check("created account is AUTHOR, not admin, no roles", u1.base_type === "AUTHOR" && u1.is_admin === false && (u1.roles || []).length === 0);
  check("Google identity linked; exactly one confirmation email; pending registration consumed", w.identities.get("G-gmail") === r1.userId && w.log.emails.length === 1 && w.pending.size === 0);
  const r2 = await cb(w, { claims: { email: "prof.rao@iitb.ac.in", hd: "iitb.ac.in", sub: "G-iitb" }, reg: reg(w, "prof.rao@iitb.ac.in") });
  check("IIT Google Workspace account → AUTHOR created", r2.outcome === "ok" && r2.created);
  const r3 = await cb(w, { claims: { email: "k.iyer@nitk.edu.in", hd: "nitk.edu.in", sub: "G-nit" }, reg: reg(w, "k.iyer@nitk.edu.in") });
  check("NIT Google account → AUTHOR created", r3.outcome === "ok" && r3.created);
  const r4 = await cb(w, { claims: { email: "new.author@atlasuniversity.edu.in", sub: "G-uni" }, reg: reg(w, "new.author@atlasuniversity.edu.in") });
  check("ATLAS Google account registering as Author → AUTHOR created", r4.outcome === "ok" && r4.created && w.users.get(r4.userId).base_type === "AUTHOR");

  const mm = reg(w, "registered@gmail.com");
  const n = w.users.size;
  const r5 = await cb(w, { claims: { email: "someone.else@gmail.com", hd: undefined }, reg: mm });
  check("6. Google email ≠ registration email → refused with the mismatch message, no account", r5.outcome === "rejected:author_email_mismatch" && r5.redirect === "/register?type=author&notice=author_email_mismatch" && w.users.size === n);
  check("…mismatch message is clear", /does not match the email address on your Author registration/.test(GOOGLE_NOTICES.author_email_mismatch));
  check("…pending registration kept so the user can retry", w.pending.has(mm));
  const r6 = await cb(w, { claims: { email: "Registered@GMAIL.com", hd: undefined }, reg: mm });
  check("same email in different letter case → match", r6.outcome === "ok" && r6.created);
  const r7 = await cb(w, { claims: { email: "registered@gmail.com.evil.io", hd: undefined }, reg: reg(w, "registered2@gmail.com") });
  check("look-alike of the registered email → refused", r7.outcome === "rejected:author_email_mismatch");
  const r8 = await cb(w, { claims: { email: "unverified@gmail.com", hd: undefined, email_verified: false }, reg: reg(w, "unverified@gmail.com") });
  check("unverified Google email with a matching registration → refused, no account", r8.outcome === "rejected:unverified" && ![...w.users.values()].some((u) => u.email === "unverified@gmail.com"));
  const exp = reg(w, "late@gmail.com"); w.pending.get(exp).expired = true;
  const r9 = await cb(w, { claims: { email: "late@gmail.com", hd: undefined }, reg: exp });
  check("expired pending registration → refused (fill in the form again)", r9.outcome === "rejected:author_registration_expired");
  const r10 = await cb(w, { claims: { email: "ghost@gmail.com", hd: undefined }, reg: "R-does-not-exist" });
  check("unknown / already used registration id → refused", r10.outcome === "rejected:author_registration_expired");
  const once = reg(w, "once@gmail.com");
  const ok1 = await cb(w, { claims: { email: "once@gmail.com", hd: undefined, sub: "G-once" }, reg: once });
  const again = await cb(w, { claims: { email: "once@gmail.com", hd: undefined, sub: "G-once" }, reg: once });
  check("re-using a consumed registration → normal sign-in to the SAME account, never a second account", ok1.created && again.outcome === "ok" && !again.created && again.userId === ok1.userId && [...w.users.values()].filter((u) => u.email === "once@gmail.com").length === 1);
}

section("Unified Google sign-in: unregistered users never get an account");
{
  const w = world();
  for (const [label, claims] of [
    ["Gmail", { email: "stranger@gmail.com", hd: undefined }],
    ["IIT Workspace", { email: "stranger@iitb.ac.in", hd: "iitb.ac.in" }],
    ["ATLAS Workspace", { email: "newbie@atlasuniversity.edu.in" }],
  ]) {
    const r = await cb(w, { claims });
    check(`7. unregistered ${label} account (no Author form) → refused, no account, no session`, r.outcome === "rejected:not_registered" && r.redirect === "/login?notice=google_not_registered" && w.users.size === 0 && w.log.sessions.length === 0);
  }
  check("…message tells external authors to complete the Author registration form", /Author registration form/.test(GOOGLE_NOTICES[noticeForReason("not_registered")]));
}

section("A pending Author registration never converts or re-roles an existing account");
{
  const w = world();
  w.add({ id: "S1", email: "student@atlasuniversity.edu.in", base_type: "STUDENT" });
  w.add({ id: "AD", email: "admin@atlasuniversity.edu.in", base_type: "FACULTY", is_admin: true });
  w.add({ id: "X1", email: "sf48116@gmail.com", base_type: "STUDENT" });
  const r1 = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", sub: "G-s" }, reg: reg(w, "student@atlasuniversity.edu.in") });
  check("existing STUDENT + matching pending registration → signs in as STUDENT, no AUTHOR created", r1.outcome === "ok" && !r1.created && w.users.get("S1").base_type === "STUDENT");
  const r2 = await cb(w, { claims: { email: "admin@atlasuniversity.edu.in", sub: "G-ad" }, reg: reg(w, "someone@gmail.com") });
  check("existing admin with a stale pending registration for another email → admin sign-in, flag untouched", r2.outcome === "ok" && r2.userId === "AD" && w.users.get("AD").is_admin === true);
  const r3 = await cb(w, { claims: { email: "sf48116@gmail.com", hd: undefined, sub: "G-x" }, reg: reg(w, "sf48116@gmail.com") });
  check("sf48116@gmail.com + Author form → still STUDENT (not converted)", r3.outcome === "ok" && w.users.get("X1").base_type === "STUDENT");
  check("no AUTHOR account created in any of these", w.log.created.length === 0);
  const dec = decideAccount({ claims: { sub: "z", email: "x@gmail.com" }, identity: null, byEmail: { id: "F", email: "x@gmail.com", status: "ACTIVE", base_type: "FACULTY", is_admin: false } });
  check("decideAccount returns only the user id (role is never decided or changed here)", dec.ok && JSON.stringify(Object.keys(dec).sort()) === JSON.stringify(["link", "ok", "userId", "verifyEmail"]));
}

section("Authorize URL (account-chooser hints only)");
{
  const base = { clientId: CLIENT_ID, redirectUri: "https://portal.example/auth/callback", state: "s", nonce: "n", codeChallenge: "c" };
  const def = new URL(buildAuthorizeUrl(base));
  check("one flow for everyone: no hd hint, no login_hint by default", !def.searchParams.has("hd") && !def.searchParams.has("login_hint"));
  const ext = new URL(buildAuthorizeUrl({ ...base, loginHint: "priya@gmail.com" }));
  check("with a pending registration: login_hint = registered email", ext.searchParams.get("login_hint") === "priya@gmail.com");
  check("PKCE S256 + nonce + state kept", ext.searchParams.get("code_challenge_method") === "S256" && ext.searchParams.get("nonce") === "n" && ext.searchParams.get("state") === "s");
  check("malformed login_hint is dropped", !new URL(buildAuthorizeUrl({ ...base, loginHint: "not an email\n" })).searchParams.has("login_hint"));
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
  check("no token, no password link", !/token|password=|reset-password|create-password/i.test(m.text.replace(/You do not need a password\./, "")));
  check("no invented dates, fees, deadlines, guarantees or IEEE claims", !/\bIEEE\b|fee|deadline|guarantee|\b20(2[7-9]|3\d)\b|\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(m.text + m.subject));
  check("HTML escapes the name", (await (async () => { sent.length = 0; await deliverAuthorRegistrationConfirmed({ email: "x@y.com", name: "<b>x</b>", userId: "A2" }, { sendEmail, siteUrl: "https://r.example" }); return !sent[0].html.includes("<b>x</b>"); })()));
  sent.length = 0;
  await deliverSignInInstructions({ email: "priya@gmail.com", userId: "A1", external: true }, { sendEmail, siteUrl: "https://r.example", isUniversityEmail: () => false });
  check("sign-in reminder for a non-ATLAS address points to Google (not the password-only text)", /Sign in with Google/.test(sent[0].text) && /Google account for this email/.test(sent[0].text) && !/can't use Google sign-in/.test(sent[0].text));
  sent.length = 0;
  await deliverSignInInstructions({ email: "sf48116@gmail.com", userId: "X1", external: true }, { sendEmail, siteUrl: "https://r.example", isUniversityEmail: () => true });
  check("sign-in reminder for sf48116@gmail.com now points to Google too", /Sign in with Google/.test(sent[0].text) && !/can't use Google sign-in/.test(sent[0].text));
}

section("Branding");
check("conference name exactly as specified", CONFERENCE_NAME === "AIDC – ATLAS International Design Conference 2026");
check("status values match the database ENUM", JSON.stringify(AUTHOR_STATUS_VALUES) === JSON.stringify(["WORKING_PROFESSIONAL", "STUDENT", "RESEARCHER", "INDEPENDENT_RESEARCHER", "OTHER"]));

console.log(`\n${failures ? `✗ FAIL — ${failures} check(s) failed.` : "✓ PASS"} — ${total - failures}/${total} checks (external Author registration & Google sign-in)`);
process.exit(failures ? 1 : 0);
