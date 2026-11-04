// Pure registration / email-verification / password-setup logic. No framework,
// env or network imports: every storage/delivery call is passed in (`deps`), so
// the whole flow — link parsing, verification, setup session, password update,
// resend — is unit-testable without a database (scripts/test-auth-flow.mjs).
//
// GOOGLE-FIRST (registration no longer issues a password-setup link):
//   1. /api/register creates the passwordless account and sends ONE
//      "registration complete — sign in with Google" email (lib/registration.js).
//   2. The user signs in with Google (lib/oauthPolicy.js), which verifies the
//      email. A password is OPTIONAL: addPassword() below, from Account settings,
//      for a signed-in user who has none.
//   3. Email links still exist for password RESET (forgot password) and for
//      setup links that were emailed before this change:
//        lib/authMailer.js builds <site>/auth/confirm?token_hash=…&type=…&flow=…
//      GET /auth/confirm shows a "Continue" button (scanner-safe); its server
//      action calls verifyOtp ON THE SERVER, consumes the token and starts a
//      30-minute SETUP/RESET session that can only open /create-password or
//      /reset-password → /api/set-password → Argon2id → every session revoked.

// ---- Link parameters -------------------------------------------------------
/** OTP types this app's emails produce. Anything else is rejected. */
export const VERIFY_TYPES = ["invite", "recovery", "signup", "email"];
/** setup = first password (registration); reset = forgot password. */
export const FLOWS = ["setup", "reset"];
// Emailed tokens are 64 hex chars (256 bits). Accept a sane hex range and
// reject anything else before touching the database.
const TOKEN_HASH_RE = /^[a-f0-9]{20,128}$/i;

/**
 * Parse /auth/confirm parameters. Accepts URLSearchParams or a plain object.
 * Returns { ok:true, tokenHash, type } or { ok:false, reason: "missing"|"malformed" }.
 */
export function parseVerificationParams(params) {
  const get = (k) => (typeof params?.get === "function" ? params.get(k) : params?.[k]);
  const tokenHash = typeof get("token_hash") === "string" ? get("token_hash").trim() : "";
  const type = typeof get("type") === "string" ? get("type").trim().toLowerCase() : "";
  if (!tokenHash || !type) return { ok: false, reason: "missing" };
  if (!TOKEN_HASH_RE.test(tokenHash) || !VERIFY_TYPES.includes(type)) return { ok: false, reason: "malformed" };
  // flow only selects between two FIXED pages; anything else falls back to the default.
  const rawFlow = typeof get("flow") === "string" ? get("flow").trim().toLowerCase() : "";
  const flow = FLOWS.includes(rawFlow) ? rawFlow : type === "recovery" ? "reset" : "setup";
  return { ok: true, tokenHash, type, flow };
}

/**
 * Classify a verifyOtp error. Expired AND already-used links are reported the
 * same way (code otp_expired, HTTP 403) — one message covers both.
 */
export function classifyVerifyError(err) {
  if (!err) return null;
  const code = String(err.code || "");
  const msg = String(err.message || "");
  if (code === "otp_expired" || err.status === 403 || /expired|invalid or has expired/i.test(msg)) return "expired";
  if (err.status >= 500 || code === "unexpected_failure") return "unavailable";
  return "invalid";
}

/** User-facing copy per outcome. Never includes tokens or account details. */
export const LINK_MESSAGES = {
  missing: "This link is incomplete. Please use the full link from your email, or request a new one.",
  malformed: "This link isn't valid. Please use the link from your most recent email, or request a new one.",
  expired: "This link has expired or has already been used. You don't need it any more: sign in with your ATLAS University Google account.",
  invalid: "This link isn't valid. Sign in with your ATLAS University Google account instead.",
  unavailable: "Verification is temporarily unavailable. Please try again in a few minutes.",
  setup_required: "You don't need a setup link any more: sign in with your ATLAS University Google account. You can add a password later from Account settings.",
  reset_required: "For your security, open the link from your password reset email to choose a new password. You can request a new reset link below.",
};

/** Same outcomes for a password-RESET link (the user wants a new reset email, not Google). */
export const RESET_LINK_MESSAGES = {
  expired: "This password reset link has expired or has already been used. Request a new one below.",
  invalid: "This password reset link isn't valid. Request a new one below.",
  missing: "This link is incomplete. Request a new password reset link below.",
  malformed: "This link isn't valid. Request a new password reset link below.",
};

// ---- Environment-specific redirect ----------------------------------------
/**
 * The base URL of emailed auth links. Must be an absolute http(s) origin; in
 * production it must be https and must not be localhost (so a production
 * email can never point at a developer machine). Returns { ok, url | error }.
 */
export function emailRedirectUrl(siteUrl, { production = false } = {}) {
  let u;
  try { u = new URL(String(siteUrl || "")); } catch { return { ok: false, error: "NEXT_PUBLIC_SITE_URL is not a valid URL." }; }
  if (!["http:", "https:"].includes(u.protocol)) return { ok: false, error: "NEXT_PUBLIC_SITE_URL must be http(s)." };
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (production && local) return { ok: false, error: "NEXT_PUBLIC_SITE_URL points at localhost in production." };
  if (production && u.protocol !== "https:") return { ok: false, error: "NEXT_PUBLIC_SITE_URL must use https in production." };
  return { ok: true, url: `${u.origin}/auth/confirm` };
}

/** Where a verified link goes. Fixed — never taken from the request (no open redirect). */
export const AFTER_VERIFY_PATH = "/create-password";
export const AFTER_VERIFY = { setup: "/create-password", reset: "/reset-password" };

/**
 * Where to send a user after sign-in, from the ?callbackUrl the middleware
 * adds. Only same-origin app paths are accepted (no "//host", no "/\host",
 * no scheme, no auth pages) — anything else falls back to /dashboard, so it can
 * never become an open redirect.
 */
export function safeNextPath(raw, fallback = "/dashboard") {
  if (typeof raw !== "string" || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s]/.test(raw) || /^\/[^/?#]*:/.test(raw)) return fallback;
  if (/^\/(login|register|auth|create-password|reset-password|api)(\/|\?|#|$)/.test(raw)) return fallback;
  return raw;
}

/**
 * The link we email (application-managed delivery). Built ON THE SERVER from
 * the single-use token returned by generateLink() (lib/authServer.js) —
 * we never create tokens ourselves. `redirectBase` is emailRedirectUrl().url.
 */
export function buildActionLink(redirectBase, { tokenHash, type, flow }) {
  if (!TOKEN_HASH_RE.test(String(tokenHash || "")) || !VERIFY_TYPES.includes(type) || !FLOWS.includes(flow)) {
    throw new Error("buildActionLink: invalid parameters");
  }
  const u = new URL(redirectBase);
  u.search = "";
  u.hash = "";
  u.searchParams.set("token_hash", tokenHash);
  u.searchParams.set("type", type);
  u.searchParams.set("flow", flow);
  return u.toString();
}

// ---- Setup session ---------------------------------------------------------------
// A verified email link starts a 30-minute SETUP (first password) or RESET
// (forgot password) session in MySQL — see lib/auth/store.mjs. It is bound to
// the user server-side and can ONLY be used to set the password; it grants no
// access to the app. (Replaces the earlier HMAC "setup proof" cookie.)
export const SETUP_TTL_SECONDS = 30 * 60;

// ---- Password policy (shared with the browser form) ------------------------
import { PASSWORD_MIN, PASSWORD_MAX, validatePasswordPair, passwordStrength } from "./passwordPolicy.js";
export { PASSWORD_MIN, PASSWORD_MAX, validatePasswordPair, passwordStrength };

// ---- Flow cores (deps injected) ----------------------------------------------

/**
 * Verify a link. deps: { verifyOtp({type, token_hash}) → {data, error}, issueSetupProof(userId) }.
 * Returns { ok:true, redirect } or { ok:false, reason }.
 * verifyOtp is called at most once per request.
 */
export async function verifyLink(params, deps) {
  const parsed = parseVerificationParams(params);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  let res;
  try {
    res = await deps.verifyOtp({ type: parsed.type, token_hash: parsed.tokenHash });
  } catch (e) {
    // A thrown error is a transport/runtime failure, not a verdict on the link:
    // never tell the user their link is bad because the database was unreachable.
    return { ok: false, reason: e?.status && e.status < 500 ? classifyVerifyError(e) : "unavailable" };
  }
  if (res?.error) return { ok: false, reason: classifyVerifyError(res.error) };
  const userId = res?.data?.user?.id || res?.data?.session?.user?.id;
  if (!userId) return { ok: false, reason: "invalid" };
  await deps.issueSetupProof(userId, parsed.flow);
  return { ok: true, redirect: AFTER_VERIFY[parsed.flow], flow: parsed.flow };
}

/**
 * Set the password. deps: { getSetupSession() → { user, flow } | null,
 * updatePassword(userId, password) → { error }, finish(userId) (revoke all
 * sessions + clear cookie), notifyPasswordChanged? }.
 * The user is ALWAYS the setup-session user — never an id from the request.
 */
export async function setPassword({ password, confirm }, deps) {
  const v = validatePasswordPair(password, confirm);
  if (!v.ok) return { status: 422, body: { error: v.error, issues: { [v.field]: v.error } } };

  const setup = await deps.getSetupSession();
  if (!setup?.user?.id) {
    return { status: 401, body: { error: "Your setup link has expired. Request a new setup email.", code: "setup_required" } };
  }
  const { user, flow } = setup;

  const { error } = (await deps.updatePassword(user.id, password)) || {};
  if (error) {
    if (!error.status || error.status >= 500) return { status: 500, body: { error: "This is temporarily unavailable. Please try again later." } };
    const weak = error.code === "weak_password" || /weak|short|pwned/i.test(error.message || "");
    return { status: 422, body: { error: weak ? "Choose a stronger password." : "Could not set your password. Please try again." } };
  }
  await deps.finish(user.id); // every session ends; the user signs in with the new password
  // Confirmation email is best-effort: a delivery problem never undoes or fails
  // the password change.
  if (deps.notifyPasswordChanged && user.email) {
    try { await deps.notifyPasswordChanged(user.email, { firstTime: flow === "setup", userId: user.id }); } catch { /* ignore */ }
  }
  return { status: 200, body: { ok: true, flow } };
}

/**
 * What a "resend" / "forgot password" request should do for this account.
 *   reset  → any existing account gets a single-use password-RESET link
 *            (that is the explicit way to create or change a password by email).
 *   setup  → no password link any more: an existing account gets the
 *            "how to sign in (Google)" email. Never creates accounts.
 */
export function resendAction(user, purpose = "setup") {
  if (!user) return "none";
  return purpose === "reset" ? "recovery" : "instructions";
}

export const RESEND_NEUTRAL = "If an account exists for that address, we've emailed sign-in instructions. Please check your inbox (and spam folder).";
export const RESET_NEUTRAL = "If an account exists for that address, we've sent a password reset email. Please check your inbox (and spam folder).";

/**
 * Resend / forgot password. deps: { isApprovedEmail(email), rateLimit(keys) → bool,
 * findUserByEmail(email) → user|null, sendRecovery(email, "reset"),
 * sendSignInInstructions(email) }.
 * The response is identical whether or not the account exists.
 */
export async function resendSetupEmail({ email, ip, purpose = "setup" }, deps) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) {
    return { status: 422, body: { error: "Enter a valid email address." } };
  }
  if (!deps.rateLimit([`ip:${ip || "unknown"}`, `email:${e}`])) {
    return { status: 429, body: { error: "Too many requests. Please wait a few minutes and try again." } };
  }
  const neutral = { status: 200, body: { ok: true, message: purpose === "reset" ? RESET_NEUTRAL : RESEND_NEUTRAL } };
  if (!deps.isApprovedEmail(e)) return neutral;

  try {
    const user = await deps.findUserByEmail(e);
    const action = resendAction(user, purpose);
    if (action === "recovery") await deps.sendRecovery(e, "reset");
    else if (action === "instructions") await deps.sendSignInInstructions(e);
  } catch {
    // Swallow: never reveal existence or upstream state.
  }
  return neutral;
}

// ---- Optional password (signed-in users) ---------------------------------------

/**
 * Add a password to the SIGNED-IN user's account when it has none (typically a
 * user who registered and signs in with Google). Never for an anonymous caller,
 * never for another user, never overwrites an existing password (changing one
 * stays on the reset-by-email path), never touches roles or the admin flag.
 *
 * deps:
 *   getSessionUser()                     → { id, email } | null   (APP session only)
 *   setInitialPassword(userId, password) → { ok: true } | { exists: true }
 *                                          (Argon2id; conditional on "no password yet")
 *   revokeOtherSessions(userId)          → other devices are signed out; this one stays
 *   notifyPasswordAdded?(email, { userId }) best-effort email
 * → { status, body }
 */
export async function addPassword({ password, confirm }, deps) {
  const me = await deps.getSessionUser();
  if (!me?.id) return { status: 401, body: { error: "Please sign in first.", code: "signin_required" } };

  const v = validatePasswordPair(password, confirm);
  if (!v.ok) return { status: 422, body: { error: v.error, issues: { [v.field]: v.error } } };

  const r = (await deps.setInitialPassword(me.id, password)) || {};
  if (r.exists) {
    return {
      status: 409,
      body: { error: "Your account already has a password. To change it, use \"Forgot password\" on the sign-in page.", code: "password_exists" },
    };
  }
  if (!r.ok) return { status: 500, body: { error: "This is temporarily unavailable. Please try again later." } };

  await deps.revokeOtherSessions(me.id);
  if (deps.notifyPasswordAdded && me.email) {
    try { await deps.notifyPasswordAdded(me.email, { userId: me.id }); } catch { /* best-effort */ }
  }
  return { status: 200, body: { ok: true } };
}

// ---- Rate limiting (fixed window, in memory) -----------------------------------
/** Per-process limiter. `limits` = { prefix: [max, windowMs] }. */
export function createRateLimiter(limits, now = () => Date.now()) {
  const hits = new Map();
  return function allow(keys) {
    const t = now();
    const plan = keys.map((k) => {
      const [max, win] = limits[k.split(":")[0]] || [Infinity, 0];
      const h = hits.get(k);
      const fresh = !h || t - h.start >= win;
      return { k, max, count: fresh ? 0 : h.count, start: fresh ? t : h.start };
    });
    if (plan.some((p) => p.count >= p.max)) return false;
    plan.forEach((p) => hits.set(p.k, { start: p.start, count: p.count + 1 }));
    if (hits.size > 10000) { for (const [k, h] of hits) if (t - h.start > 3600000) hits.delete(k); }
    return true;
  };
}

// ---- Log hygiene ----------------------------------------------------------------
/** Strip auth secrets from a URL or string before it is ever logged. */
export function redactSecrets(s) {
  return String(s || "")
    .replace(/(token_hash|token|access_token|refresh_token|provider_token|code)=([^&#\s]+)/gi, "$1=[redacted]")
    .replace(/#.*$/, "#[redacted]");
}
