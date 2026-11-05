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

section("Google: external Author activation (verified email must match the form)");
{
  const w = world();
  const r1 = await cb(w, { claims: { email: "priya.menon@gmail.com", hd: undefined, sub: "G-gmail" }, reg: reg(w, "priya.menon@gmail.com") });
  check("external Gmail account + matching registration → AUTHOR created, signed in, → /dashboard", r1.outcome === "ok" && r1.created === true && r1.redirect === "/dashboard" && w.log.sessions.includes(r1.userId));
  const u1 = w.users.get(r1.userId);
  check("created account is AUTHOR, not admin, no roles", u1.base_type === "AUTHOR" && u1.is_admin === false && (u1.roles || []).length === 0);
  check("Google identity linked to the new account", w.identities.get("G-gmail") === r1.userId);
  check("exactly one confirmation email, after Google authentication", w.log.emails.length === 1 && w.log.emails[0].email === "priya.menon@gmail.com");
  check("pending registration consumed (single use)", w.pending.size === 0);

  const r2 = await cb(w, { claims: { email: "prof.rao@iitb.ac.in", hd: "iitb.ac.in", sub: "G-iitb" }, reg: reg(w, "prof.rao@iitb.ac.in") });
  check("external institutional Google Workspace account (IIT) → AUTHOR created", r2.outcome === "ok" && r2.created && w.users.get(r2.userId).base_type === "AUTHOR");
  const r2b = await cb(w, { claims: { email: "k.iyer@nitk.edu.in", hd: "nitk.edu.in", sub: "G-nit" }, reg: reg(w, "k.iyer@nitk.edu.in") });
  check("external institutional Google account (NIT) → AUTHOR created", r2b.outcome === "ok" && r2b.created);

  const r3 = await cb(w, { claims: { email: "new.author@atlasuniversity.edu.in", sub: "G-uni" }, reg: reg(w, "new.author@atlasuniversity.edu.in") });
  check("university Google account registering as Author → AUTHOR created", r3.outcome === "ok" && r3.created && w.users.get(r3.userId).base_type === "AUTHOR");

  const mismatchReg = reg(w, "registered@gmail.com");
  const n = w.users.size;
  const r4 = await cb(w, { claims: { email: "someone.else@gmail.com", hd: undefined }, reg: mismatchReg });
  check("Google email ≠ registered email → refused, back to the Author form", r4.outcome === "rejected:author_email_mismatch" && r4.redirect === "/register?type=author&notice=author_email_mismatch" && w.users.size === n);
  check("…pending registration kept so the user can retry with the right account", w.pending.has(mismatchReg));
  const r4b = await cb(w, { claims: { email: "Registered@GMAIL.com", hd: undefined }, reg: mismatchReg });
  check("same email in different letter case → treated as the same address (match)", r4b.outcome === "ok" && r4b.created);
  const r4c = await cb(w, { claims: { email: "registered@gmail.com.evil.io", hd: undefined }, reg: reg(w, "registered2@gmail.com") });
  check("look-alike of the registered email → refused", r4c.outcome === "rejected:author_email_mismatch");

  const r5 = await cb(w, { claims: { email: "unverified@gmail.com", hd: undefined, email_verified: false }, reg: reg(w, "unverified@gmail.com") });
  check("unverified Google email → refused (no account, no session)", r5.outcome === "rejected:external_unverified" && /google_external_unverified/.test(r5.redirect) && ![...w.users.values()].some((u) => u.email === "unverified@gmail.com"));
  const r5b = await cb(w, { claims: { email: "unverified2@gmail.com", hd: undefined, email_verified: "true" }, reg: reg(w, "unverified2@gmail.com") });
  check("email_verified as the string \"true\" → refused", r5b.outcome === "rejected:external_unverified");

  const exp = reg(w, "late@gmail.com"); w.pending.get(exp).expired = true;
  const r6 = await cb(w, { claims: { email: "late@gmail.com", hd: undefined }, reg: exp });
  check("expired pending registration → refused (fill in the form again)", r6.outcome === "rejected:author_registration_expired" && /author_registration_expired/.test(r6.redirect));
  const r6b = await cb(w, { claims: { email: "ghost@gmail.com", hd: undefined }, reg: "R-does-not-exist" });
  check("unknown / already used registration id → refused", r6b.outcome === "rejected:author_registration_expired");

  // Replay of an already-activated registration (pending row consumed).
  const once = reg(w, "once@gmail.com");
  const ok1 = await cb(w, { claims: { email: "once@gmail.com", hd: undefined, sub: "G-once" }, reg: once });
  const again = await cb(w, { claims: { email: "once@gmail.com", hd: undefined, sub: "G-once" }, reg: once });
  check("activation is single use: re-using the registration id → refused, no second account", ok1.created && again.outcome === "rejected:author_registration_expired" && [...w.users.values()].filter((u) => u.email === "once@gmail.com").length === 1);
}

section("Google: unregistered accounts never get an Author account");
{
  const w = world();
  const r = await cb(w, { claims: { email: "stranger@gmail.com", hd: undefined } });
  check("unregistered Gmail (no Author form) → refused, no account, no session", r.outcome === "rejected:external_not_registered" && w.users.size === 0 && w.log.sessions.length === 0);
  check("…user is told to complete the Author registration form", /Author registration form/.test(GOOGLE_NOTICES[noticeForReason("external_not_registered")]));
  const r2 = await cb(w, { claims: { email: "stranger@iitb.ac.in", hd: "iitb.ac.in" } });
  check("unregistered institutional Google account → refused, no account", r2.outcome === "rejected:external_not_registered" && w.users.size === 0);
  const r3 = await cb(w, { claims: { email: "newbie@atlasuniversity.edu.in" } });
  check("unregistered university account → refused exactly as before (google_not_registered)", r3.outcome === "rejected:not_registered" && r3.redirect === "/login?notice=google_not_registered" && w.users.size === 0);
}

section("Google: returning Authors (existing AUTHOR accounts)");
{
  const w = world();
  w.add({ id: "A1", email: "priya@gmail.com", base_type: "AUTHOR" });
  const r = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-p" } });
  check("returning Author with Gmail → signed in (first use links the Google sub)", r.outcome === "ok" && r.userId === "A1" && w.identities.get("G-p") === "A1" && !r.created);
  const r2 = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-p" } });
  check("later sign-ins match by linked sub", r2.outcome === "ok" && r2.userId === "A1");
  const r3 = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-OTHER" } });
  check("same email from a DIFFERENT Google account → refused", r3.outcome === "rejected:identity_mismatch");
  w.add({ id: "A2", email: "off@gmail.com", base_type: "AUTHOR", status: "DISABLED" });
  const r4 = await cb(w, { claims: { email: "off@gmail.com", hd: undefined } });
  check("disabled Author → refused", r4.outcome === "rejected:disabled");
  const r5 = await cb(w, { claims: { email: "priya@gmail.com", hd: undefined, sub: "G-p", email_verified: false } });
  check("returning Author whose Google email became unverified → refused", r5.outcome === "rejected:external_unverified");
}

section("Existing rules unchanged: Student / Faculty / sf48116@gmail.com exception");
{
  const w = world();
  w.add({ id: "S1", email: "student@atlasuniversity.edu.in", base_type: "STUDENT" });
  w.add({ id: "F1", email: "faculty@atlasuniversity.edu.in", base_type: "FACULTY" });
  w.add({ id: "X1", email: "sf48116@gmail.com", base_type: "STUDENT" }); // the intentional testing exception
  const s = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", sub: "G-s" } });
  check("Student with verified @atlasuniversity.edu.in → signed in", s.outcome === "ok" && s.userId === "S1" && w.users.get("S1").base_type === "STUDENT");
  const f = await cb(w, { claims: { email: "faculty@atlasuniversity.edu.in", sub: "G-f" } });
  check("Faculty with verified @atlasuniversity.edu.in → signed in", f.outcome === "ok" && f.userId === "F1" && w.users.get("F1").base_type === "FACULTY");
  const su = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", email_verified: false } });
  check("Student with UNVERIFIED university email → refused (google_unverified, as before)", su.outcome === "rejected:unverified" && su.redirect === "/login?notice=google_unverified");
  const hd = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", hd: undefined } });
  check("university email without Workspace hd → refused (hd_mismatch, as before)", hd.outcome === "rejected:hd_mismatch");
  const x = await cb(w, { claims: { email: "sf48116@gmail.com", hd: undefined, sub: "G-x" } });
  check("sf48116@gmail.com (STUDENT, the testing exception) → Google refused exactly as before (google_domain)", x.outcome === "rejected:domain" && x.redirect === "/login?notice=google_domain" && w.log.sessions.every((id) => id !== "X1"));
  const g = await cb(w, { claims: { email: "sf48116@gmail.com", hd: undefined, sub: "G-x" }, reg: reg(w, "sf48116@gmail.com") });
  check("…and the Author flow can't convert that STUDENT account into an AUTHOR", g.outcome === "rejected:domain" && w.users.get("X1").base_type === "STUDENT" && w.log.created.length === 0);
  check("validateIdTokenClaims without allowExternal is still university-only (gmail → domain)",
    validateIdTokenClaims(await verifyIdTokenSignature(await idToken({ email: "a@gmail.com", hd: undefined }), JWKS, CLIENT_ID), { clientId: CLIENT_ID, nonce: "N0NCE", nowS: NOW }).reason === "domain");
}

section("Role can never change through Google Sign-In");
{
  const w = world();
  w.add({ id: "S1", email: "student@atlasuniversity.edu.in", base_type: "STUDENT" });
  // A pending Author registration for an email that (by a race) already has a Student account.
  const r = await cb(w, { claims: { email: "student@atlasuniversity.edu.in", sub: "G-s" }, reg: reg(w, "student@atlasuniversity.edu.in") });
  check("existing STUDENT + Author flow → normal sign-in, account stays STUDENT, no AUTHOR created", r.outcome === "ok" && !r.created && r.userId === "S1" && w.users.get("S1").base_type === "STUDENT" && w.log.created.length === 0);
  w.add({ id: "AD", email: "admin@atlasuniversity.edu.in", base_type: "FACULTY", is_admin: true });
  const r2 = await cb(w, { claims: { email: "admin@atlasuniversity.edu.in", sub: "G-ad" }, reg: reg(w, "admin@atlasuniversity.edu.in") });
  check("existing admin + Author flow → admin flag untouched, no AUTHOR created", r2.outcome === "ok" && w.users.get("AD").is_admin === true && w.users.get("AD").base_type === "FACULTY" && w.log.created.length === 0);
  w.add({ id: "A9", email: "auth9@gmail.com", base_type: "AUTHOR" });
  const r3 = await cb(w, { claims: { email: "auth9@gmail.com", hd: undefined, sub: "G-9" } });
  check("existing AUTHOR sign-in → stays AUTHOR, not admin", r3.outcome === "ok" && w.users.get("A9").base_type === "AUTHOR" && w.users.get("A9").is_admin === false);
  const dec = decideAccount({ claims: { sub: "z", email: "x@gmail.com", external: true }, identity: null, byEmail: { id: "F", email: "x@gmail.com", status: "ACTIVE", base_type: "FACULTY" } });
  check("decideAccount: external email + non-AUTHOR account → domain", dec.reason === "domain");
}

section("Authorize URL (account-chooser hints only)");
{
  const base = { clientId: CLIENT_ID, redirectUri: "https://portal.example/auth/callback", state: "s", nonce: "n", codeChallenge: "c" };
  const def = new URL(buildAuthorizeUrl(base));
  check("default (Student/Faculty) still sends hd=atlasuniversity.edu.in", def.searchParams.get("hd") === GOOGLE_ALLOWED_DOMAIN && !def.searchParams.has("login_hint"));
  const ext = new URL(buildAuthorizeUrl({ ...base, external: true, loginHint: "priya@gmail.com" }));
  check("Author flow omits hd and pre-selects the registered email", !ext.searchParams.has("hd") && ext.searchParams.get("login_hint") === "priya@gmail.com");
  check("PKCE S256 + nonce + state kept in the Author flow", ext.searchParams.get("code_challenge_method") === "S256" && ext.searchParams.get("nonce") === "n" && ext.searchParams.get("state") === "s");
  const bad = new URL(buildAuthorizeUrl({ ...base, external: true, loginHint: "not an email\n" }));
  check("malformed login_hint is dropped", !bad.searchParams.has("login_hint"));
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
  check("sign-in reminder for an Author points to Google (not the password-only text)", /Author sign-in with Google/.test(sent[0].text) && !/can't use Google sign-in/.test(sent[0].text));
  sent.length = 0;
  await deliverSignInInstructions({ email: "sf48116@gmail.com", userId: "X1" }, { sendEmail, siteUrl: "https://r.example", isUniversityEmail: () => false });
  check("sign-in reminder for the sf48116 Student exception unchanged (password route)", /can't use Google sign-in/.test(sent[0].text));
}

section("Branding");
check("conference name exactly as specified", CONFERENCE_NAME === "AIDC – ATLAS International Design Conference 2026");
check("status values match the database ENUM", JSON.stringify(AUTHOR_STATUS_VALUES) === JSON.stringify(["WORKING_PROFESSIONAL", "STUDENT", "RESEARCHER", "INDEPENDENT_RESEARCHER", "OTHER"]));

console.log(`\n${failures ? `✗ FAIL — ${failures} check(s) failed.` : "✓ PASS"} — ${total - failures}/${total} checks (external Author registration & Google sign-in)`);
process.exit(failures ? 1 : 0);
