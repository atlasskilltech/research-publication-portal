/**
 * Isolated tests for the registration → email → verify → create password →
 * sign-in flow (lib/authFlow.js + the real email templates). NO network and NO
 * database: the MySQL auth store is replaced by an in-memory fake that models the
 * behaviours that matter (single-use, expiring token hashes; a session after
 * verifyOtp; password sign-in). It is a model, not the real service — the live
 * production email link still has to be tested by hand.
 * Run: node scripts/test-auth-flow.mjs
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  parseVerificationParams, classifyVerifyError, emailRedirectUrl, AFTER_VERIFY_PATH,
  validatePasswordPair, passwordStrength, verifyLink, setPassword, resendSetupEmail,
  resendAction, RESEND_NEUTRAL, createRateLimiter, redactSecrets, SETUP_TTL_SECONDS, LINK_MESSAGES,
} from "../lib/authFlow.js";
import { deliverInvite, deliverRecovery } from "../lib/authMailer.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SECRET = "test-secret-not-real";
const PROD = "https://research.atlasskilltech.app";
const LOCAL = "http://localhost:3000";

// ---- Fake auth store (model of lib/authServer.js on MySQL) -------------------
function fakeStore({ now = () => Date.now(), otpTtlMs = 3600_000, siteUrl = PROD } = {}) {
  const users = new Map(); // id → { id, email, confirmed, password }
  const tokens = new Map(); // tokenHash → { userId, type, exp, used }
  const outbox = [];
  let session = null;
  void siteUrl;
  const err =() => ({ data: { user: null, session: null }, error: { status: 403, code: "otp_expired", message: "Email link is invalid or has expired" } });
  return {
    users, tokens, outbox,
    get session() { return session; },
    // generateLink() (lib/authServer.js): creates the user for invites, returns
    // the single-use token, and sends NO email (application-managed delivery).
    generateLink({ type, email, options = {} }) {
      let u = [...users.values()].find((x) => x.email === email);
      if (type === "invite") {
        if (u?.confirmed) return { data: null, error: { status: 422, code: "email_exists", message: "already been registered" } };
        if (!u) { u = { id: crypto.randomUUID(), email, confirmed: false, password: null, meta: options.data || {} }; users.set(u.id, u); }
      } else if (type === "recovery") {
        if (!u) return { data: null, error: { status: 404, code: "user_not_found", message: "User not found" } };
      } else return { data: null, error: { status: 400, message: "unsupported" } };
      const hash = crypto.randomBytes(28).toString("hex");
      tokens.set(hash, { userId: u.id, type, exp: now() + otpTtlMs, used: false });
      return { data: { user: { id: u.id }, properties: { hashed_token: hash, verification_type: type, } }, error: null };
    },
    verifyOtp({ type, token_hash }) {
      const t = tokens.get(token_hash);
      if (!t || t.used || t.exp <= now() || t.type !== type) return err();
      t.used = true;
      const u = users.get(t.userId);
      u.confirmed = true;
      session = { userId: u.id };
      return { data: { user: { id: u.id }, session: { user: { id: u.id } } }, error: null };
    },
    getUser() { return session ? { id: session.userId, email: users.get(session.userId).email } : null; },
    /** Server-side password write for a specific user (lib/authServer updatePassword). */
    setPassword(userId, password) {
      const u = users.get(userId);
      if (!u) return { error: { status: 404, message: "user not found" } };
      u.password = password;
      return { error: null };
    },
    signOut() { session = null; },
    signInWithPassword(email, password) {
      const u = [...users.values()].find((x) => x.email === email);
      return !!u && u.confirmed && u.password !== null && u.password === password;
    },
  };
}
/** deps for lib/authMailer.js: fake generateLink + a mock SMTP sender capturing mail. */
const mailer = (sb, redirectBase, site = PROD, sendResult = { ok: true, id: "re_test" }) => ({
  generateLink: async (a) => sb.generateLink(a),
  sendEmail: async (m) => { sb.outbox.push({ ...m, type: m.purpose }); return typeof sendResult === "function" ? sendResult(m) : sendResult; },
  redirectBase,
  siteUrl: site,
});
const ctaUrl = (html) => {
  const m = html.match(/<a href="([^"]+)"[^>]*>(?:Create|Reset) Your Password<\/a>/);
  return m ? new URL(m[1].replaceAll("&amp;", "&")) : null;
};
/**
 * Model of the server-side SETUP/RESET session (lib/auth/store.mjs): created by
 * a verified link, bound to one user, 30-minute expiry, ended by finish().
 */
function setupStore(now = () => Date.now()) {
  let s = null;
  return {
    issue: (userId, flow = "setup") => { s = { userId, flow: flow === "reset" ? "reset" : "setup", exp: now() + SETUP_TTL_SECONDS * 1000 }; },
    read: () => (s && s.exp > now() ? s : null),
    clear: () => { s = null; },
    expireNow: () => { if (s) s.exp = now() - 1; },
  };
}
const setPwDeps = (sb, store, extra = {}) => ({
  getSetupSession: async () => {
    const s = store.read();
    return s ? { user: { id: s.userId, email: sb.users.get(s.userId)?.email }, flow: s.flow } : null;
  },
  updatePassword: async (userId, p) => sb.setPassword(userId, p),
  finish: async () => { store.clear(); sb.signOut(); },
  ...extra,
});

console.log("\n=== Registration & password-setup flow tests ===\n");

// ---------------------------------------------------------------------------
console.log("Root cause reproduced (old link format):");
{
  // What production once received: an implicit-flow redirect with the session in the FRAGMENT.
  const old = new URL(`${PROD}/auth/confirm?next=/create-password#access_token=eyJ.fake&refresh_token=r&type=invite`);
  check("server sees NO token_hash/code in the query → 'missing' (was: link_invalid)", parseVerificationParams(old.searchParams).reason === "missing");
  check("the fragment is never part of what the server receives", !old.search.includes("access_token") && old.hash.includes("access_token"));
}

// ---------------------------------------------------------------------------
console.log("\nEnd-to-end (fake store): register → email → verify → create password → sign in:");
{
  let t = Date.parse("2026-11-01T10:00:00Z");
  const now = () => t;
  const sb = fakeStore({ now });
  const jar = setupStore(now);
  const redirect = emailRedirectUrl(PROD, { production: true });
  check("production redirectTo = https://research.atlasskilltech.app/auth/confirm", redirect.ok && redirect.url === `${PROD}/auth/confirm`);

  const reg = await deliverInvite({ email: "new.student@atlasuniversity.edu.in", data: { name: "New Student", base_type: "STUDENT" } }, mailer(sb, redirect.url));
  const mail = sb.outbox.at(-1);
  check("registration: account created + exactly one email handed to the mailer", reg.ok && reg.emailSent && sb.users.size === 1 && sb.outbox.length === 1 && mail.type === "invite");
  check("email has subject + plain-text alternative", mail.subject === "Complete Your Research Portal Registration" && mail.text.includes("/auth/confirm?token_hash="));
  check("Mailer idempotency key derived from user + token (safe retries)", /^invite\/[a-f0-9]{40}$/.test(mail.key));
  check("email has subject-style heading + CTA", /Welcome to the Research Publication Portal/.test(mail.html) && /Create Your Password/.test(mail.html));
  const link = ctaUrl(mail.html);
  check("CTA points to production /auth/confirm", link && link.origin === PROD && link.pathname === "/auth/confirm", link?.origin + link?.pathname);
  check("CTA carries token_hash + type=invite + flow=setup (nothing else)", link && [...link.searchParams.keys()].join() === "token_hash,type,flow" && link.searchParams.get("type") === "invite" && link.searchParams.get("flow") === "setup");
  check("CTA token is the one generateLink issued", link && sb.tokens.has(link.searchParams.get("token_hash")));
  check("plain-text fallback link present in the email", (mail.html.match(/token_hash=/g) || []).length >= 3);
  check("email never contains a password", !/password:\s*\S|your password is/i.test(mail.html));

  // Opening the page does NOT verify (scanner-safe): only parse happens on GET.
  check("GET-time parse is valid and consumes nothing", parseVerificationParams(link.searchParams).ok && [...sb.tokens.values()].every((x) => !x.used));

  let verifyCalls = 0;
  const deps = {
    verifyOtp: async (a) => { verifyCalls++; return sb.verifyOtp(a); },
    issueSetupProof: async (uid, flow) => jar.issue(uid, flow),
  };
  const v1 = await verifyLink(link.searchParams, deps);
  check("verification succeeds → fixed redirect to /create-password", v1.ok && v1.redirect === AFTER_VERIFY_PATH && AFTER_VERIFY_PATH === "/create-password");
  check("verifyOtp called exactly once", verifyCalls === 1);
  check("user is now verified", [...sb.users.values()][0].confirmed);
  check("SETUP session issued for that user (flow setup)", jar.read()?.userId === [...sb.users.values()][0].id && jar.read()?.flow === "setup");

  const mismatch = await setPassword({ password: "Research#2026ok", confirm: "Research#2026no" }, setPwDeps(sb, jar));
  check("password/confirm mismatch → 422, nothing changed", mismatch.status === 422 && [...sb.users.values()][0].password === null);
  const short = await setPassword({ password: "short", confirm: "short" }, setPwDeps(sb, jar));
  check("too-short password → 422", short.status === 422);

  const ok = await setPassword({ password: "Research#2026ok", confirm: "Research#2026ok" }, setPwDeps(sb, jar));
  check("password set → 200", ok.status === 200 && ok.body.ok === true);
  check("setup session ended + signed out afterwards", jar.read() === null && sb.session === null);
  check("user signs in with email + new password", sb.signInWithPassword("new.student@atlasuniversity.edu.in", "Research#2026ok"));
  check("wrong password still rejected", !sb.signInWithPassword("new.student@atlasuniversity.edu.in", "nope-nope-nope"));

  const again = await verifyLink(link.searchParams, deps);
  check("same link reused → 'expired' (single-use)", !again.ok && again.reason === "expired");

  // Expired link: new invite for another user, then advance past the OTP TTL.
  await deliverInvite({ email: "late@atlasuniversity.edu.in" }, mailer(sb, redirect.url));
  const late = ctaUrl(sb.outbox.at(-1).html);
  t += 3600_000 + 1;
  const exp = await verifyLink(late.searchParams, deps);
  check("expired link → 'expired', no session", !exp.ok && exp.reason === "expired" && sb.session === null);
}

// ---------------------------------------------------------------------------
console.log("\nCallback parameter handling:");
{
  const deps = { verifyOtp: async () => { throw new Error("must not be called"); }, issueSetupProof: async () => {} };
  const hash = "a".repeat(56);
  check("missing token_hash → missing (no database call)", (await verifyLink({ type: "invite" }, deps)).reason === "missing");
  check("missing type → missing", (await verifyLink({ token_hash: hash }, deps)).reason === "missing");
  check("non-hex token → malformed", (await verifyLink({ token_hash: "<script>", type: "invite" }, deps)).reason === "malformed");
  check("unknown type → malformed", (await verifyLink({ token_hash: hash, type: "magic_admin" }, deps)).reason === "malformed");
  check("invalid (unknown) token from the store → expired/invalid, no proof", (await verifyLink({ token_hash: hash, type: "invite" }, {
    verifyOtp: async () => ({ error: { status: 403, code: "otp_expired" } }), issueSetupProof: async () => { throw new Error("no proof on failure"); },
  })).reason === "expired");
  check("other 4xx → invalid", classifyVerifyError({ status: 400, code: "validation_failed" }) === "invalid");
  check("5xx → unavailable", classifyVerifyError({ status: 503 }) === "unavailable");
  check("network throw → unavailable", (await verifyLink({ token_hash: hash, type: "invite" }, { verifyOtp: async () => { throw new Error("ECONNRESET"); }, issueSetupProof: async () => {} })).reason === "unavailable");
  check("success without a user id is treated as invalid", (await verifyLink({ token_hash: hash, type: "invite" }, { verifyOtp: async () => ({ data: {}, error: null }), issueSetupProof: async () => {} })).reason === "invalid");
  check("every outcome has a user-facing message", ["missing", "malformed", "expired", "invalid", "unavailable", "setup_required"].every((k) => LINK_MESSAGES[k]));
  check("redirect destination is fixed (no ?next / open redirect)", !/searchParams\.get\("next"\)|formData\.get\("next"\)/.test(read("../app/auth/confirm/actions.js") + read("../app/auth/confirm/page.js")));
  check("root-page safety net only forwards validated token_hash+type", /parseVerificationParams\(sp\)/.test(read("../app/page.js")) && !/next=/.test(read("../app/page.js")));
}

// ---------------------------------------------------------------------------
console.log("\nUnauthorized password updates:");
{
  const sb = fakeStore();
  const jar = setupStore();
  const body = { password: "Research#2026ok", confirm: "Research#2026ok" };
  const r1 = await setPassword(body, setPwDeps(sb, jar));
  check("no setup session → 401 setup_required", r1.status === 401 && r1.body.code === "setup_required");

  await deliverInvite({ email: "a@atlasuniversity.edu.in" }, mailer(sb, `${PROD}/auth/confirm`));
  await deliverInvite({ email: "b@atlasuniversity.edu.in" }, mailer(sb, `${PROD}/auth/confirm`));
  const [linkA] = sb.outbox.map((m) => ctaUrl(m.html));
  // Verified link, but the setup session was never issued (e.g. a normal APP session).
  await verifyLink(linkA.searchParams, { verifyOtp: async (a) => sb.verifyOtp(a), issueSetupProof: async () => {} });
  const r2 = await setPassword(body, setPwDeps(sb, jar));
  check("ordinary session without a SETUP session → 401 (can't change password here)", r2.status === 401);

  const userA = [...sb.users.values()].find((u) => u.email.startsWith("a@"));
  jar.issue(userA.id, "setup");
  jar.expireNow();
  check("expired setup session (30 min) → 401", (await setPassword(body, setPwDeps(sb, jar))).status === 401);
  check("no password was changed by any of the above", [...sb.users.values()].every((u) => u.password === null));

  jar.issue(userA.id, "setup");
  const weak = await setPassword(body, setPwDeps(sb, jar, { updatePassword: async () => ({ error: { status: 422, code: "weak_password", message: "Password is too weak" } }) }));
  check("password rejected → 422 with guidance, setup session kept for retry", weak.status === 422 && /stronger/.test(weak.body.error) && jar.read() !== null);
  const down = await setPassword(body, setPwDeps(sb, jar, { updatePassword: async () => ({ error: { status: 500 } }) }));
  check("password update failure (5xx) → 500, setup session kept", down.status === 500 && jar.read() !== null);
  const okA = await setPassword(body, setPwDeps(sb, jar));
  check("the password is written for the SETUP-session user only", okA.status === 200 && userA.password === body.password && [...sb.users.values()].filter((u) => u.password).length === 1);

  const route = read("../app/api/set-password/route.js");
  check("set-password route never takes a user id from the request", !/body\??\.(user_?id|id|email)/i.test(route));
  check("set-password uses the server-side setup session deps", /setPasswordDeps/.test(route));
  check("setup session is a SETUP/RESET purpose only (never APP)", /currentSession\(\["SETUP", "RESET"\]\)/.test(read("../lib/session.js")));
  check("create-password page requires the SETUP session (flow setup)", /getSetupSession\(\)/.test(read("../app/create-password/page.js")) && /setup\.flow !== "setup"/.test(read("../app/create-password/page.js")));
  check("password change revokes every session of the user", /finish: \(userId\) => endAllSessions\(userId\)/.test(read("../lib/authServer.js")));
}

// ---------------------------------------------------------------------------
console.log("\nResend (sign-in instructions) & existing accounts:");
{
  const sent = [];
  const accounts = {
    "pending@atlasuniversity.edu.in": { id: "u1", email_confirmed_at: null },
    "verified@atlasuniversity.edu.in": { id: "u2", email_confirmed_at: "2026-10-30T00:00:00Z" },
  };
  const deps = (over = {}) => ({
    isApprovedEmail: (e) => e.endsWith("@atlasuniversity.edu.in"),
    rateLimit: () => true,
    findUserByEmail: async (e) => accounts[e] || null,
    sendSignInInstructions: async (e) => { sent.push(["instructions", e]); return { error: null }; },
    sendRecovery: async (e, flow) => { sent.push(["recovery", e, flow]); return { error: null }; },
    sendInvite: async () => { throw new Error("must never send a password-setup invite"); },
    ...over,
  });
  const r = (email, d = deps()) => resendSetupEmail({ email, ip: "1.2.3.4" }, d);

  const unknown = await r("nobody@atlasuniversity.edu.in");
  check("unknown address → neutral 200, nothing sent", unknown.status === 200 && unknown.body.message === RESEND_NEUTRAL && sent.length === 0);
  const pend = await r("Pending@AtlasUniversity.edu.in");
  check("unverified account → sign-in instructions (email normalised), NO password link", sent.at(-1)?.join() === "instructions,pending@atlasuniversity.edu.in" && pend.body.message === RESEND_NEUTRAL);
  await r("verified@atlasuniversity.edu.in");
  check("verified account → sign-in instructions, NO password link", sent.at(-1)?.join() === "instructions,verified@atlasuniversity.edu.in" && !sent.some((x) => x[0] === "recovery"));
  check("identical response for existing vs unknown (no enumeration)", JSON.stringify(unknown) === JSON.stringify(pend));
  const n = sent.length;
  check("disallowed domain → neutral, nothing sent", (await r("x@gmail-not-allowed.com")).status === 200 && sent.length === n);
  check("upstream error → still neutral 200", (await r("pending@atlasuniversity.edu.in", deps({ findUserByEmail: async () => { throw new Error("db down"); } }))).body.message === RESEND_NEUTRAL);
  check("invalid email → 422", (await r("not-an-email")).status === 422);
  check("resend never creates accounts", resendAction(null) === "none" && resendAction(null, "reset") === "none");
  check("resend → instructions; forgot password → recovery (reset)", resendAction({}, "setup") === "instructions" && resendAction({}, "reset") === "recovery");

  let t = 0;
  const limiter = createRateLimiter({ ip: [5, 15 * 60_000], email: [3, 60 * 60_000] }, () => t);
  const ld = deps({ rateLimit: limiter });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await resendSetupEmail({ email: "pending@atlasuniversity.edu.in", ip: "9.9.9.9" }, ld)).status);
  check("per-email limit: 3 allowed then 429", codes.join() === "200,200,200,429", codes.join());
  const ipCodes = [];
  for (let i = 0; i < 6; i++) ipCodes.push((await resendSetupEmail({ email: `u${i}@atlasuniversity.edu.in`, ip: "8.8.8.8" }, ld)).status);
  check("per-IP limit: 5 allowed then 429", ipCodes.slice(0, 5).every((c) => c === 200) && ipCodes[5] === 429);
  t += 60 * 60_000 + 1;
  check("limits reset after the window", (await resendSetupEmail({ email: "pending@atlasuniversity.edu.in", ip: "9.9.9.9" }, ld)).status === 200);

  // Re-registering an existing verified account doesn't duplicate it (fake mirrors the store).
  const sb = fakeStore();
  await deliverInvite({ email: "dup@atlasuniversity.edu.in" }, mailer(sb, `${PROD}/auth/confirm`));
  await verifyLink(ctaUrl(sb.outbox[0].html).searchParams, { verifyOtp: async (a) => sb.verifyOtp(a), issueSetupProof: async () => {} });
  const dup = await deliverInvite({ email: "dup@atlasuniversity.edu.in" }, mailer(sb, `${PROD}/auth/confirm`));
  check("existing verified account: no duplicate user, no second email", !dup.ok && dup.error?.code === "email_exists" && sb.users.size === 1 && sb.outbox.length === 1);
  const reg = read("../lib/registration.js");
  check("registration checks for an existing account BEFORE creating one", reg.indexOf("deps.findUserByEmail(email)") > -1 && reg.indexOf("deps.findUserByEmail(email)") < reg.indexOf("deps.createAccount("));
  check("register route points duplicates to Google sign-in", /Sign in with your ATLAS University Google account/.test(reg));
}

// ---------------------------------------------------------------------------
console.log("\nEnvironment-specific redirect URLs:");
{
  check("production → https://research.atlasskilltech.app/auth/confirm", emailRedirectUrl(`${PROD}/`, { production: true }).url === `${PROD}/auth/confirm`);
  check("local → http://localhost:3000/auth/confirm", emailRedirectUrl(LOCAL).url === `${LOCAL}/auth/confirm`);
  check("trailing slash / path ignored (origin only)", emailRedirectUrl(`${PROD}/some/path/`).url === `${PROD}/auth/confirm`);
  check("production + localhost → refused", !emailRedirectUrl("http://localhost:5630", { production: true }).ok);
  check("production + plain http → refused", !emailRedirectUrl("http://research.atlasskilltech.app", { production: true }).ok);
  check("garbage URL → refused", !emailRedirectUrl("research.atlasskilltech.app").ok && !emailRedirectUrl("javascript:alert(1)").ok);
  const sbLocal = fakeStore({ siteUrl: PROD });
  await deliverInvite({ email: "dev@atlasuniversity.edu.in" }, mailer(sbLocal, emailRedirectUrl(LOCAL).url, LOCAL));
  const localLink = ctaUrl(sbLocal.outbox[0].html);
  check("local registration email links to localhost (not production)", localLink.origin === LOCAL);
  const sbProd = fakeStore();
  await deliverInvite({ email: "p@atlasuniversity.edu.in" }, mailer(sbProd, emailRedirectUrl(PROD, { production: true }).url));
  check("production email contains no localhost link", !/localhost|127\.0\.0\.1/.test(sbProd.outbox[0].html));
  const authServer = read("../lib/authServer.js");
  check("server refuses the accidental localhost fallback in production", /production: process\.env\.NODE_ENV === "production" && !process\.env\.NEXT_PUBLIC_SITE_URL/.test(authServer));
  check("all token emails share one redirect helper (mailerDeps → authEmailRedirect)", /redirectBase: authEmailRedirect\(\)/.test(authServer) && /registrationDeps\(\)/.test(read("../app/api/register/route.js")));
  check("auth emails have a single sender (the app's SMTP mailer)", !/inviteUserByEmail|resetPasswordForEmail|supabase/i.test(authServer + read("../app/api/register/route.js")));
}

// ---------------------------------------------------------------------------
console.log("\nPassword policy & guidance:");
check("10+ chars and matching → ok", validatePasswordPair("abcdefghij", "abcdefghij").ok);
check("9 chars → rejected", validatePasswordPair("abcdefghi", "abcdefghi").field === "password");
check("over 200 chars → rejected", !validatePasswordPair("x".repeat(201), "x".repeat(201)).ok);
check("mismatch reported on confirm field", validatePasswordPair("abcdefghij", "abcdefghik").field === "confirm");
check("strength: short → 'Too short'", passwordStrength("abc").label === "Too short");
check("strength: long mixed → 'Strong'", passwordStrength("Research#Portal2026").label === "Strong");
check("server policy matches client policy (10 chars)", /password\.length < 10/.test(read("../lib/validation.js")));

// ---------------------------------------------------------------------------
console.log("\nNo sensitive token leakage:");
{
  const leak = `${PROD}/auth/confirm?token_hash=${"ab".repeat(28)}&type=invite#access_token=eyJsecret&refresh_token=r1`;
  const red = redactSecrets(leak);
  check("redactSecrets removes token_hash, access & refresh tokens", !/abab|eyJsecret|r1\b/.test(red) && /token_hash=\[redacted\]/.test(red));
  const files = ["../app/auth/confirm/actions.js", "../app/auth/confirm/page.js", "../app/api/set-password/route.js", "../app/api/auth/resend/route.js", "../lib/authServer.js", "../lib/authFlow.js"];
  for (const f of files) {
    const src = read(f);
    const logs = src.match(/console\.(log|error|warn|info)\([^)]*\)/g) || [];
    check(`${f.replace("../", "")}: no logging of tokens/passwords/emails`, logs.every((l) => !/token|password|email|hash|body|formData|proof/i.test(l.replace(/"[^"]*"/g, ""))), logs.join(" | ") || "no logs");
  }
  check("email templates contain no hard-coded token values", !/token_hash=[a-f0-9]{20,}/i.test(read("../lib/email/templates.js")));
  check("session cookie is httpOnly + sameSite=lax + secure in production", /httpOnly: true/.test(read("../lib/auth/session.js")) && /sameSite: "lax"/.test(read("../lib/auth/session.js")) && /secure: secure\(\)/.test(read("../lib/auth/session.js")));
  check("only the SHA-256 of tokens is stored", /sha256Hex\(token\)/.test(read("../lib/auth/store.mjs")) && /sha256Hex\(raw\)/.test(read("../lib/auth/store.mjs")));
  {
    const scrub = read("../components/auth/FragmentScrubber.jsx");
    check("old fragments are scrubbed from the address bar (tokens never used)",
      /replaceState/.test(scrub) && !/setSession|exchangeCodeForSession|new URLSearchParams\(\s*window\.location\.hash/.test(scrub) && !/@\/lib\/supabase/.test(scrub));
  }
  check("no server/db import in client components", !/@\/lib\/db|@\/lib\/auth\/|mysql2|server-only/.test(read("../components/auth/CreatePasswordForm.jsx") + read("../components/auth/ResendSetupForm.jsx") + read("../components/auth/FragmentScrubber.jsx")));
  check("client form imports the crypto-free policy module only", /@\/lib\/passwordPolicy/.test(read("../components/auth/CreatePasswordForm.jsx")) && !/@\/lib\/authFlow/.test(read("../components/auth/CreatePasswordForm.jsx")));
}

// ---------------------------------------------------------------------------
console.log("\nPassword recovery end-to-end (fake store + real mailer/templates):");
{
  let t = Date.parse("2026-11-01T12:00:00Z");
  const now = () => t;
  const sb = fakeStore({ now });
  const base = `${PROD}/auth/confirm`;
  const jar = setupStore(now);
  // An existing, verified user with a password.
  await deliverInvite({ email: "reset.me@atlasuniversity.edu.in" }, mailer(sb, base));
  await verifyLink(ctaUrl(sb.outbox.at(-1).html).searchParams, { verifyOtp: async (a) => sb.verifyOtp(a), issueSetupProof: async (uid, flow) => jar.issue(uid, flow) });
  await setPassword({ password: "Original#Pass2026", confirm: "Original#Pass2026" }, setPwDeps(sb, jar));
  check("precondition: user signs in with original password", sb.signInWithPassword("reset.me@atlasuniversity.edu.in", "Original#Pass2026"));

  const accounts = { "reset.me@atlasuniversity.edu.in": { id: [...sb.users.values()][0].id, email_confirmed_at: "2026-11-01T00:00:00Z" } };
  const before = sb.outbox.length;
  const forgot = await resendSetupEmail({ email: "reset.me@atlasuniversity.edu.in", ip: "5.5.5.5", purpose: "reset" }, {
    isApprovedEmail: () => true, rateLimit: () => true,
    findUserByEmail: async (e) => accounts[e] || null,
    sendInvite: async () => { throw new Error("must not invite a verified user"); },
    sendRecovery: async (e, flow) => deliverRecovery({ email: e, flow }, mailer(sb, base)),
  });
  const mail = sb.outbox.at(-1);
  check("forgot password → neutral reset message", forgot.status === 200 && /password reset email/.test(forgot.body.message));
  check("exactly one RESET email (purpose password_reset)", sb.outbox.length === before + 1 && mail.purpose === "password_reset" && mail.subject === "Reset Your Research Portal Password");
  const link = ctaUrl(mail.html);
  check("reset link: type=recovery + flow=reset → our /auth/confirm", link.pathname === "/auth/confirm" && link.searchParams.get("type") === "recovery" && link.searchParams.get("flow") === "reset");

  let flowSeen = null;
  const v = await verifyLink(link.searchParams, { verifyOtp: async (a) => sb.verifyOtp(a), issueSetupProof: async (uid, flow) => { flowSeen = flow; jar.issue(uid, flow); } });
  check("verified → dedicated /reset-password page (not create-password)", v.ok && v.redirect === "/reset-password" && flowSeen === "reset");

  const notified = [];
  const r = await setPassword({ password: "Brand#NewPass2026", confirm: "Brand#NewPass2026" }, setPwDeps(sb, jar, { notifyPasswordChanged: async (email, o) => { notified.push([email, o.firstTime]); } }));
  check("new password saved → 200 (flow reset)", r.status === 200 && r.body.flow === "reset");
  check("'password changed' confirmation requested (firstTime=false)", notified.length === 1 && notified[0][1] === false);
  check("old password no longer works; new one does", !sb.signInWithPassword("reset.me@atlasuniversity.edu.in", "Original#Pass2026") && sb.signInWithPassword("reset.me@atlasuniversity.edu.in", "Brand#NewPass2026"));
  check("reset link is single-use", (await verifyLink(link.searchParams, { verifyOtp: async (a) => sb.verifyOtp(a), issueSetupProof: async () => {} })).reason === "expired");
  check("invite links can't be replayed as recovery (type mismatch rejected)", (await verifyLink({ token_hash: link.searchParams.get("token_hash"), type: "invite" }, { verifyOtp: async (a) => sb.verifyOtp(a), issueSetupProof: async () => {} })).ok === false);

  {
    // Fresh recovery session + proof, then the confirmation email THROWS.
    const g = sb.generateLink({ type: "recovery", email: "reset.me@atlasuniversity.edu.in" });
    sb.verifyOtp({ type: "recovery", token_hash: g.data.properties.hashed_token });
    jar.issue(g.data.user.id, "reset");
    const notifyFail = await setPassword({ password: "Third#Pass20266", confirm: "Third#Pass20266" }, setPwDeps(sb, jar, { notifyPasswordChanged: async () => { throw new Error("resend down"); } }));
    check("confirmation-email failure never fails the password change (200, password updated)", notifyFail.status === 200 && sb.signInWithPassword("reset.me@atlasuniversity.edu.in", "Third#Pass20266"));
  }

  const unknown = await resendSetupEmail({ email: "ghost@atlasuniversity.edu.in", ip: "5.5.5.6", purpose: "reset" }, {
    isApprovedEmail: () => true, rateLimit: () => true, findUserByEmail: async () => null,
    sendInvite: async () => ({}), sendRecovery: async () => { throw new Error("must not send"); },
  });
  check("forgot password for unknown address → same neutral message, nothing sent", unknown.body.message === forgot.body.message);
  check("flow param can only pick a fixed page (unknown flow → default)", parseVerificationParams({ token_hash: "a".repeat(56), type: "recovery", flow: "https://evil.example" }).flow === "reset");
  check("reset page requires the RESET session (flow reset)", /getSetupSession\(\)/.test(read("../app/reset-password/page.js")) && /setup\.flow !== "reset"/.test(read("../app/reset-password/page.js")));
  check("forgot-password route uses purpose 'reset' and the shared limiter", /purpose: "reset"/.test(read("../app/api/auth/forgot-password/route.js")) && /rateLimit: resendRateLimit/.test(read("../app/api/auth/forgot-password/route.js")));
}

console.log(`\n${failures === 0 ? "✓ PASS — registration & password-setup flow is sound (isolated model)." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
