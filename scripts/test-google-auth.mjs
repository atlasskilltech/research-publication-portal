/**
 * Google Sign-In security tests (direct OpenID Connect, no Supabase) — offline.
 *
 * Uses REAL RS256 signatures: a locally generated RSA key pair plays Google's
 * JWKS, and tokens are verified by the SAME function production uses
 * (lib/oauthPolicy.verifyIdTokenSignature). The callback orchestration
 * (completeGoogleCallback) runs with in-memory fakes for MySQL and Google's
 * token endpoint that record every side effect.
 * The DB-backed parts (state single-use, identity linking, sessions) are also
 * exercised against real MySQL in scripts/test-mysql-integration.mjs.
 *
 * Run: node scripts/test-google-auth.mjs
 */
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { readFileSync } from "node:fs";
import {
  isUniversityEmail, validateIdTokenClaims, decideAccount, completeGoogleCallback, verifyIdTokenSignature,
  buildAuthorizeUrl, validateRedirectUri, noticeForReason, GOOGLE_NOTICES, GOOGLE_ALLOWED_DOMAIN,
} from "../lib/oauthPolicy.js";
import { safeNextPath } from "../lib/authFlow.js";

let failures = 0, total = 0;
const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const CLIENT_ID = "rpp-test.apps.googleusercontent.com";
const NOW = Math.floor(Date.now() / 1000);
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const JWKS = createLocalJWKSet({ keys: [jwk] });
const other = await generateKeyPair("RS256");

async function idToken(claims = {}, { key = privateKey, kid = "k1", alg = "RS256" } = {}) {
  const base = {
    iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, sub: "1100000000000000001",
    email: "user@atlasuniversity.edu.in", email_verified: true, hd: GOOGLE_ALLOWED_DOMAIN,
    nonce: "N0NCE", iat: NOW, exp: NOW + 3600, ...claims,
  };
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return new SignJWT(base).setProtectedHeader({ alg, kid }).sign(key);
}
const claimsOf = async (c) => validateIdTokenClaims(await verifyIdTokenSignature(await idToken(c), JWKS, CLIENT_ID), { clientId: CLIENT_ID, nonce: "N0NCE", nowS: NOW });

// ---- Fake world for the callback ----------------------------------------------------
function world() {
  const users = new Map(); // id → { id, email, status, is_admin, roles, email_confirmed_at }
  const identities = new Map(); // sub → userId
  const states = new Map(); // state → { nonce, codeVerifier, next, exp }
  const log = { sessions: [], links: [], roleWrites: 0, created: 0, exchanged: [] };
  const add = (u) => { users.set(u.id, { status: "ACTIVE", is_admin: false, roles: [], email_confirmed_at: "2026-10-01T00:00:00.000Z", ...u }); return users.get(u.id); };
  const deps = (tokenFor) => ({
    clientId: CLIENT_ID,
    nowS: () => NOW,
    consumeState: async (s) => { const r = states.get(s); states.delete(s); return r && r.exp > Date.now() ? r : null; },
    exchangeCode: async (code, verifier) => { log.exchanged.push([code, verifier]); return tokenFor(code); },
    verifyIdToken: (t) => verifyIdTokenSignature(t, JWKS, CLIENT_ID),
    findIdentity: async (sub) => (identities.has(sub) ? users.get(identities.get(sub)) || null : null),
    findUserByEmail: async (e) => [...users.values()].find((u) => u.email === e) || null,
    linkedSubFor: async (id) => [...identities.entries()].find(([, uid]) => uid === id)?.[0] || null,
    completeSignIn: async ({ userId, link, verifyEmail, claims }) => {
      if (link) { identities.set(claims.sub, userId); log.links.push(userId); }
      if (verifyEmail) users.get(userId).email_confirmed_at = new Date().toISOString();
      log.sessions.push(userId);
    },
    safeNext: safeNextPath,
  });
  const begin = (next = "/dashboard") => { const s = `st_${Math.random().toString(36).slice(2)}`; states.set(s, { nonce: "N0NCE", codeVerifier: "VERIFIER", next, exp: Date.now() + 600_000 }); return s; };
  return { users, identities, states, log, add, deps, begin };
}
async function callback(w, { email = "user@atlasuniversity.edu.in", claims = {}, state, cookie, params, next } = {}) {
  const s = state ?? w.begin(next);
  const tok = await idToken({ email, ...claims });
  return completeGoogleCallback({ params: params ?? { code: "auth-code", state: s }, cookieState: cookie ?? s }, w.deps(async () => ({ id_token: tok })));
}

// ---- Domain rules -----------------------------------------------------------------------
section("Exact university domain (isUniversityEmail)");
for (const [email, want] of [
  ["user@atlasuniversity.edu.in", true], ["USER@ATLASUNIVERSITY.EDU.IN", true], ["User@AtlasUniversity.Edu.In", true],
  ["user@gmail.com", false], ["user@outlook.com", false], ["user@atlasuniversity.edu.in.example.com", false],
  ["user@sub.atlasuniversity.edu.in", false], ["user@evilatlasuniversity.edu.in", false], ["user@atlasuniversity.edu", false],
  ["user@atlasuniversity.edu.in.", false], ["user@atlasuniversity.edu.in ", false], ["a@b@atlasuniversity.edu.in", false],
  ["@atlasuniversity.edu.in", false], ["user@atlasuniversity.edu.in\n", false], ["user%atlasuniversity.edu.in@gmail.com", false],
  ["", false], [null, false],
]) check(`${JSON.stringify(email)} → ${want ? "accepted" : "rejected"}`, isUniversityEmail(email) === want);

// ---- Signature / standard claims ------------------------------------------------------------
section("ID token signature, issuer, audience, expiry (jose, RS256)");
{
  check("valid Google-signed token verifies", !!(await verifyIdTokenSignature(await idToken(), JWKS, CLIENT_ID)).sub);
  const rejects = async (label, p) => { let ok = false; try { await p; } catch { ok = true; } check(label, ok); };
  await rejects("token signed by another key → rejected", verifyIdTokenSignature(await idToken({}, { key: other.privateKey }), JWKS, CLIENT_ID));
  await rejects("unknown kid → rejected", verifyIdTokenSignature(await idToken({}, { kid: "nope" }), JWKS, CLIENT_ID));
  const hs = await new SignJWT({ iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "x", exp: NOW + 60 }).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode("k".repeat(32)));
  await rejects("HS256 (algorithm confusion) → rejected", verifyIdTokenSignature(hs, JWKS, CLIENT_ID));
  const parts = (await idToken()).split(".");
  await rejects("alg none / stripped signature → rejected", verifyIdTokenSignature(`${Buffer.from('{"alg":"none"}').toString("base64url")}.${parts[1]}.`, JWKS, CLIENT_ID));
  await rejects("tampered payload → rejected", verifyIdTokenSignature(`${parts[0]}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], "base64url")), email: "admin@atlasuniversity.edu.in" })).toString("base64url")}.${parts[2]}`, JWKS, CLIENT_ID));
  await rejects("wrong issuer → rejected", verifyIdTokenSignature(await idToken({ iss: "https://evil.example" }), JWKS, CLIENT_ID));
  await rejects("wrong audience (another app's token) → rejected", verifyIdTokenSignature(await idToken({ aud: "other-app" }), JWKS, CLIENT_ID));
  await rejects("expired token → rejected", verifyIdTokenSignature(await idToken({ iat: NOW - 7200, exp: NOW - 3600 }), JWKS, CLIENT_ID));
  check("issuer without https (accounts.google.com) is accepted (Google documents both)", !!(await verifyIdTokenSignature(await idToken({ iss: "accounts.google.com" }), JWKS, CLIENT_ID)));
}

section("Claim policy (validateIdTokenClaims) — required cases 1–6");
{
  check("1. verified user@atlasuniversity.edu.in → allowed", (await claimsOf({})).ok);
  check("2. unverified university email → rejected (unverified)", (await claimsOf({ email_verified: false })).reason === "unverified");
  check("2b. email_verified as string 'true' → rejected (must be boolean true)", (await claimsOf({ email_verified: "true" })).reason === "unverified");
  check("3. user@gmail.com → rejected (domain)", (await claimsOf({ email: "user@gmail.com", hd: undefined })).reason === "domain");
  check("4. user@outlook.com → rejected (domain)", (await claimsOf({ email: "user@outlook.com", hd: undefined })).reason === "domain");
  check("5. user@atlasuniversity.edu.in.example.com → rejected (domain)", (await claimsOf({ email: "user@atlasuniversity.edu.in.example.com" })).reason === "domain");
  const up = await claimsOf({ email: "Mixed.Case@ATLASUNIVERSITY.EDU.IN", hd: "AtlasUniversity.edu.in" });
  check("6. upper-case domain → allowed, email normalised to lower case", up.ok && up.email === "mixed.case@atlasuniversity.edu.in");
  check("university email WITHOUT Workspace hd claim → rejected", (await claimsOf({ hd: undefined })).reason === "hd_mismatch");
  check("hd for another domain → rejected", (await claimsOf({ hd: "gmail.com" })).reason === "hd_mismatch");
  check("nonce mismatch (token from another flow / replay) → rejected", validateIdTokenClaims(await verifyIdTokenSignature(await idToken(), JWKS, CLIENT_ID), { clientId: CLIENT_ID, nonce: "OTHER", nowS: NOW }).reason === "bad_nonce");
  check("missing nonce → rejected", (await claimsOf({ nonce: undefined })).reason === "bad_nonce");
  check("azp of another client → rejected", (await claimsOf({ azp: "other-app" })).reason === "bad_audience");
  check("iat in the future → rejected", (await claimsOf({ iat: NOW + 3600, exp: NOW + 7200 })).reason === "bad_iat");
  check("every reason maps to a user message", ["domain", "hd_mismatch", "identity_mismatch", "unverified", "not_registered", "disabled", "bad_nonce", "???"].every((r) => GOOGLE_NOTICES[noticeForReason(r)]));
  check("required domain message text", GOOGLE_NOTICES.google_domain === "Please sign in using your ATLAS University email account.");
}

// ---- Account matching ---------------------------------------------------------------------------
section("Account matching (decideAccount) — existing accounts only");
{
  const c = { sub: "S1", email: "a@atlasuniversity.edu.in" };
  const u = { id: "U1", email: "a@atlasuniversity.edu.in", status: "ACTIVE", email_confirmed_at: "x" };
  check("first Google login for a registered account → link", JSON.stringify(decideAccount({ claims: c, identity: null, byEmail: u, linkedSub: null })) === JSON.stringify({ ok: true, userId: "U1", link: true, verifyEmail: false }));
  check("later login via linked sub → same user, no new link", decideAccount({ claims: c, identity: u, byEmail: null }).link === false);
  check("no portal account → not_registered (never auto-created)", decideAccount({ claims: c, identity: null, byEmail: null }).reason === "not_registered");
  check("disabled account → refused", decideAccount({ claims: c, identity: null, byEmail: { ...u, status: "DISABLED" } }).reason === "disabled");
  check("account already linked to a DIFFERENT Google sub → refused", decideAccount({ claims: c, identity: null, byEmail: u, linkedSub: "S2" }).reason === "identity_mismatch");
  check("linked sub whose account email changed → refused", decideAccount({ claims: c, identity: { ...u, email: "b@atlasuniversity.edu.in" } }).reason === "identity_mismatch");
  check("registered but never verified → allowed and marked verified (Google proved the email)", decideAccount({ claims: c, identity: null, byEmail: { ...u, email_confirmed_at: null } }).verifyEmail === true);
}

// ---- Callback orchestration -------------------------------------------------------------------------
section("Callback end-to-end (fake MySQL + Google token endpoint)");
{
  const w = world();
  const admin = w.add({ id: "ADMIN-1", email: "faizan.shaikh@atlasuniversity.edu.in", is_admin: true, roles: ["ADMINISTRATOR"] });
  const before = JSON.stringify(admin);
  const r = await callback(w, { email: admin.email, next: "/users" });
  check("7. existing administrator → signed in, sent to requested page", r.outcome === "ok" && r.redirect === "/users" && w.log.sessions[0] === "ADMIN-1");
  check("7. same user id, admin flag + roles byte-for-byte unchanged", JSON.stringify(w.users.get("ADMIN-1")) === before);
  check("7. Google identity linked to the existing id", w.identities.get("1100000000000000001") === "ADMIN-1");
  check("PKCE verifier from the state row is sent to the token endpoint", w.log.exchanged[0][1] === "VERIFIER");
  const again = await callback(w, { email: admin.email });
  check("second login uses the linked identity (no duplicate link)", again.outcome === "ok" && w.log.links.length === 1);

  const gmail = await callback(w, { email: "user@gmail.com", claims: { hd: undefined, sub: "S-g" } });
  check("3. personal gmail → /login?notice=google_domain, no session", gmail.redirect === "/login?notice=google_domain" && w.log.sessions.length === 2);
  const newUni = await callback(w, { email: "newbie@atlasuniversity.edu.in", claims: { sub: "S-new" } });
  check("unregistered university user → google_not_registered, no account/session created", newUni.redirect === "/login?notice=google_not_registered" && w.users.size === 1 && w.log.sessions.length === 2);
  const unv = await callback(w, { email: admin.email, claims: { email_verified: false } });
  check("2. unverified email → google_unverified, no session", unv.redirect === "/login?notice=google_unverified" && w.log.sessions.length === 2);
}

section("Case 9 — invalid / expired / replayed state, CSRF");
{
  const w = world();
  w.add({ id: "U1", email: "user@atlasuniversity.edu.in" });
  const s = w.begin();
  const noCookie = await callback(w, { state: s, cookie: "" });
  check("state cookie missing (login CSRF) → google_failed, code never exchanged", noCookie.outcome === "state_mismatch" && w.log.exchanged.length === 0);
  const mismatched = await callback(w, { state: s, cookie: "someone-elses-state" });
  check("state ≠ browser cookie → rejected", mismatched.outcome === "state_mismatch");
  const unknown = await callback(w, { state: "forged", cookie: "forged" });
  check("unknown state (forged) → rejected before exchange", unknown.outcome === "state_unknown_or_expired" && w.log.exchanged.length === 0);
  const first = await callback(w, { state: s, cookie: s });
  const replay = await callback(w, { state: s, cookie: s });
  check("state is single use: first ok, replay rejected", first.outcome === "ok" && replay.outcome === "state_unknown_or_expired");
  const s2 = w.begin(); w.states.get(s2).exp = Date.now() - 1;
  check("expired state (10 min) → rejected", (await callback(w, { state: s2, cookie: s2 })).outcome === "state_unknown_or_expired");
  const s3 = w.begin();
  check("provider error (user cancelled) → google_failed", (await callback(w, { params: { error: "access_denied", state: s3 }, state: s3, cookie: s3 })).redirect === "/login?notice=google_failed");
  const s4 = w.begin();
  check("missing code → rejected", (await callback(w, { params: { state: s4 }, state: s4, cookie: s4 })).outcome === "no_code");
  const s5 = w.begin();
  const badSig = await completeGoogleCallback({ params: { code: "c", state: s5 }, cookieState: s5 },
    w.deps(async () => ({ id_token: await idToken({}, { key: other.privateKey }) })));
  check("token endpoint returns a token with a bad signature → rejected", badSig.outcome === "token_invalid", badSig.outcome);
  const s6 = w.begin();
  const throwing = await completeGoogleCallback({ params: { code: "c", state: s6 }, cookieState: s6 },
    { ...w.deps(async () => { throw new Error("400 invalid_grant"); }) });
  check("code exchange fails (expired/reused code) → rejected", throwing.outcome === "token_invalid");
  const s7 = w.begin();
  check("no id_token in the response → rejected", (await completeGoogleCallback({ params: { code: "c", state: s7 }, cookieState: s7 }, w.deps(async () => ({ access_token: "x" })))).outcome === "no_id_token");
  check("no session was created by any rejected attempt", w.log.sessions.length === 1, String(w.log.sessions.length));
}

section("Open-redirect safety");
for (const raw of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/api/admin/users", "javascript:alert(1)"]) {
  const w = world(); w.add({ id: "U", email: "user@atlasuniversity.edu.in" });
  check(`next=${JSON.stringify(raw)} → /dashboard`, (await callback(w, { next: raw })).redirect === "/dashboard");
}

section("Authorize URL + redirect URI");
{
  const u = new URL(buildAuthorizeUrl({ clientId: CLIENT_ID, redirectUri: "https://research.atlasskilltech.app/auth/callback", state: "S", nonce: "N", codeChallenge: "C" }));
  check("Google authorize endpoint", u.origin + u.pathname === "https://accounts.google.com/o/oauth2/v2/auth");
  check("code flow + PKCE S256 + state + nonce + openid email scope", u.searchParams.get("response_type") === "code" && u.searchParams.get("code_challenge_method") === "S256" && u.searchParams.get("state") === "S" && u.searchParams.get("nonce") === "N" && /openid/.test(u.searchParams.get("scope")) && /email/.test(u.searchParams.get("scope")));
  check("hd hint = university domain", u.searchParams.get("hd") === GOOGLE_ALLOWED_DOMAIN);
  check("client secret never in the authorize URL", !/secret/i.test(u.toString()));
  check("redirect URI must be <origin>/auth/callback over https", validateRedirectUri("https://research.atlasskilltech.app/auth/callback").ok && !validateRedirectUri("https://research.atlasskilltech.app/auth/other").ok && !validateRedirectUri("http://research.atlasskilltech.app/auth/callback").ok);
  check("http allowed only for localhost", validateRedirectUri("http://localhost:3001/auth/callback").ok);
  check("no Supabase callback URL", !validateRedirectUri("https://x.supabase.co/auth/v1/callback").ok);
}

section("Static guarantees");
{
  const g = read("../lib/googleAuth.js");
  const cb = read("../app/auth/callback/route.js");
  check("Google sign-in never writes roles or the admin flag", !/user_roles|userRoles|isAdmin\s*=|setUserRoles/.test(g + cb));
  check("Google sign-in never creates users", !/INSERT INTO \\`\$\{T\.users\}|createRegisteredUser/.test(g + cb));
  check("client secret only from server env (never NEXT_PUBLIC)", /process\.env\.GOOGLE_CLIENT_SECRET/.test(g) && !/NEXT_PUBLIC_GOOGLE/.test(g + read("../app/auth/google/route.js") + read("../components/auth/GoogleSignInButton.jsx")));
  check("state stored hashed + deleted on use", /sha256Hex\(state\)/.test(g) && /DELETE FROM/.test(g));
  check("callback never trusts a browser-supplied email", !/params\.email|searchParams\.get\(["']email/.test(cb));
  check("no Supabase anywhere in the Google flow", !/supabase/i.test(g + cb + read("../app/auth/google/route.js") + read("../lib/oauthPolicy.js")));
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${total - failures}/${total} checks`);
process.exit(failures === 0 ? 0 : 1);
