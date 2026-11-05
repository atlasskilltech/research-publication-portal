/**
 * Google Sign-In policy — PURE (no I/O, no framework imports) so the exact
 * rules run in /auth/callback and in the offline tests
 * (scripts/test-google-auth.mjs).
 *
 * Flow: OpenID Connect Authorization Code + PKCE (S256) directly with Google.
 * The callback, in order:
 *   1. refuses provider errors and any request whose `state` is missing, does
 *      not match the browser's state cookie, or is unknown/expired/already used
 *      in MySQL (single-use; DELETE-on-read) — CSRF, login-CSRF and replay;
 *   2. exchanges the code at Google's token endpoint with the PKCE verifier and
 *      the client secret (server-side only);
 *   3. verifies the ID token's RS256 signature against Google's JWKS + issuer,
 *      audience, expiry (jose), then re-checks every claim here: azp, iat,
 *      nonce (bound to this state), email_verified === true, exact
 *      @atlasuniversity.edu.in email, and Workspace `hd` = the same domain;
 *   4. matches an EXISTING portal account — by the linked Google `sub`, or on
 *      first use by exact email — and refuses everything else. Google never
 *      changes roles or the admin flag.
 *
 * External AUTHORS (AIDC 2026) — the only exception to the university domain:
 *   - a verified NON-university Google email is accepted only for an account
 *     whose base type is AUTHOR (any other account type → "domain", exactly as
 *     before; e.g. the sf48116@gmail.com testing account stays password-only);
 *   - an AUTHOR account is created ONLY when the OAuth flow carries a pending
 *     Author registration (completed form, bound to this browser) whose email
 *     EXACTLY equals the verified Google email. An unregistered Google account
 *     never gets an account, and an existing account is never converted.
 *   - every other check (signature, iss, aud, azp, exp, iat, nonce,
 *     email_verified === true, state/PKCE) is identical for everyone.
 */

import { jwtVerify } from "jose";

export const GOOGLE_ALLOWED_DOMAIN = "atlasuniversity.edu.in";
export const GOOGLE_ISSUERS = Object.freeze(["https://accounts.google.com", "accounts.google.com"]);
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const CLOCK_SKEW_S = 60;

export const OAUTH_STATE_COOKIE = "rpp_oauth_state";
export const OAUTH_FLOW_TTL_SECONDS = 10 * 60;

/** User-facing messages, keyed by the ?notice= value (lib/authNotices.js — client-safe). */
export { GOOGLE_NOTICES } from "./authNotices.js";

const REASON_NOTICE = Object.freeze({
  domain: "google_domain",
  hd_mismatch: "google_domain",
  identity_mismatch: "google_domain",
  unverified: "google_unverified",
  not_registered: "google_not_registered",
  disabled: "google_disabled",
  external_unverified: "google_external_unverified",
  external_not_registered: "google_external_not_registered",
  author_email_mismatch: "author_email_mismatch",
  author_registration_expired: "author_registration_expired",
});
export const noticeForReason = (reason) => REASON_NOTICE[reason] || "google_failed";

/**
 * Strict university-email check: a plain string with exactly one "@" whose
 * domain is EXACTLY the university domain (case-insensitive). Rejects
 * user@gmail.com, user@atlasuniversity.edu.in.example.com,
 * user@sub.atlasuniversity.edu.in, whitespace/control characters, "a@b@…".
 */
export function isUniversityEmail(email) {
  if (typeof email !== "string" || email.length === 0 || email.length > 254) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(email)) return false;
  const e = email.toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0 || at !== e.lastIndexOf("@")) return false;
  return e.slice(at + 1) === GOOGLE_ALLOWED_DOMAIN;
}

/**
 * Any well-formed single address (external authors may use any domain): one
 * "@", a dotted domain, no whitespace/control characters, ≤ 191 chars (the
 * users.email column).
 */
export function isPlainEmail(email) {
  if (typeof email !== "string" || email.length === 0 || email.length > 191) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1);
  return /^[^.]+(\.[^.]+)+$/.test(domain);
}

export const AUTHOR_BASE_TYPE = "AUTHOR";

const lower = (v) => (typeof v === "string" ? v.toLowerCase() : "");

function eq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * Verify an ID token's RS256 signature against `keySet` (Google's JWKS in
 * production — jose createRemoteJWKSet; a local JWKS in tests) plus issuer,
 * audience, exp/nbf. Throws on any failure. → payload
 */
export async function verifyIdTokenSignature(idToken, keySet, clientId) {
  const { payload } = await jwtVerify(idToken, keySet, {
    issuer: [...GOOGLE_ISSUERS], audience: clientId, algorithms: ["RS256"], clockTolerance: CLOCK_SKEW_S,
  });
  return payload;
}

/**
 * Claim checks on an ID token payload whose SIGNATURE, issuer, audience and
 * expiry were already verified by jose. Re-checked here so the rules are
 * explicit and testable. → { ok: true, sub, email, external } | { ok: false, reason }
 *
 * allowExternal (default false = the original university-only rule): also
 * accept a verified NON-university email, flagged `external: true`. Such
 * claims are only ever honoured for AUTHOR accounts (decideAccount) or to
 * activate a matching pending Author registration (completeGoogleCallback).
 * University emails keep every original check, including `hd`.
 */
export function validateIdTokenClaims(p, { clientId, nonce, nowS = Math.floor(Date.now() / 1000), allowExternal = false }) {
  if (!p || typeof p !== "object") return { ok: false, reason: "bad_token" };
  if (!GOOGLE_ISSUERS.includes(p.iss)) return { ok: false, reason: "bad_issuer" };
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!clientId || !aud.includes(clientId)) return { ok: false, reason: "bad_audience" };
  if ((aud.length > 1 || p.azp !== undefined) && p.azp !== clientId) return { ok: false, reason: "bad_audience" };
  if (typeof p.exp !== "number" || p.exp + CLOCK_SKEW_S < nowS) return { ok: false, reason: "expired" };
  if (typeof p.iat !== "number" || p.iat - CLOCK_SKEW_S > nowS) return { ok: false, reason: "bad_iat" };
  if (!nonce || !eq(String(p.nonce || ""), nonce)) return { ok: false, reason: "bad_nonce" };
  if (typeof p.sub !== "string" || !p.sub || p.sub.length > 255) return { ok: false, reason: "bad_token" };
  if (!isUniversityEmail(p.email)) {
    if (!allowExternal || !isPlainEmail(p.email)) return { ok: false, reason: "domain" };
    if (p.email_verified !== true) return { ok: false, reason: "external_unverified" };
    return { ok: true, sub: p.sub, email: p.email.toLowerCase(), external: true };
  }
  if (p.email_verified !== true) return { ok: false, reason: "unverified" };
  if (lower(p.hd) !== GOOGLE_ALLOWED_DOMAIN) return { ok: false, reason: "hd_mismatch" };
  return { ok: true, sub: p.sub, email: p.email.toLowerCase(), external: false };
}

/**
 * Match the verified Google identity to an EXISTING account.
 *   identity  — the user linked to this Google `sub` (or null)
 *   byEmail   — the user whose email equals the token email (or null)
 *   linkedSub — the Google sub already linked to byEmail (or null)
 * → { ok: true, userId, link, verifyEmail } | { ok: false, reason }
 */
export function decideAccount({ claims, identity, byEmail, linkedSub }) {
  // A non-university Google email may only ever sign in to an AUTHOR account.
  const externalBlocked = (u) => claims.external === true && u.base_type !== AUTHOR_BASE_TYPE;
  if (identity) {
    if (lower(identity.email) !== claims.email) return { ok: false, reason: "identity_mismatch" };
    if (externalBlocked(identity)) return { ok: false, reason: "domain" };
    if (identity.status !== "ACTIVE") return { ok: false, reason: "disabled" };
    return { ok: true, userId: identity.id, link: false, verifyEmail: !identity.email_confirmed_at };
  }
  if (!byEmail) return { ok: false, reason: claims.external === true ? "external_not_registered" : "not_registered" };
  if (externalBlocked(byEmail)) return { ok: false, reason: "domain" };
  if (byEmail.status !== "ACTIVE") return { ok: false, reason: "disabled" };
  // The account is already linked to a DIFFERENT Google account → refuse.
  if (linkedSub && linkedSub !== claims.sub) return { ok: false, reason: "identity_mismatch" };
  return { ok: true, userId: byEmail.id, link: !linkedSub, verifyEmail: !byEmail.email_confirmed_at };
}

/**
 * GOOGLE_REDIRECT_URI must be absolute, end at /auth/callback, and be https
 * (http allowed only for localhost — a local `next start`). Google itself also
 * rejects any redirect URI not registered on the OAuth client.
 */
export function validateRedirectUri(uri) {
  let u;
  try { u = new URL(String(uri || "")); } catch { return { ok: false, error: "GOOGLE_REDIRECT_URI is not a valid URL" }; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.pathname !== "/auth/callback" || u.search || u.hash) return { ok: false, error: "GOOGLE_REDIRECT_URI must be <origin>/auth/callback" };
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return { ok: false, error: "GOOGLE_REDIRECT_URI must use https" };
  return { ok: true, url: u.toString() };
}

/**
 * Google authorize URL for the start route. `external` (Author flows) omits the
 * `hd` account-chooser hint so any Google account can be chosen; `loginHint`
 * pre-selects the registered email. Neither is a security control — every rule
 * is enforced on the verified ID token in the callback.
 */
export function buildAuthorizeUrl({ clientId, redirectUri, state, nonce, codeChallenge, external = false, loginHint = null }) {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (!external) u.searchParams.set("hd", GOOGLE_ALLOWED_DOMAIN); // account-chooser hint only; enforced on the token
  if (loginHint && isPlainEmail(loginHint)) u.searchParams.set("login_hint", loginHint);
  u.searchParams.set("prompt", "select_account");
  u.searchParams.set("access_type", "online");
  return u.toString();
}

/**
 * The OAuth callback as a pure orchestration over injected effects, so the
 * security-relevant ordering is unit-testable. The route only wires real I/O.
 *
 * input: { params (query), cookieState (rpp_oauth_state cookie value) }
 * deps:
 *   consumeState(state)          → { nonce, codeVerifier, next, authorRegistrationId? } | null  (single use)
 *   exchangeCode(code, verifier) → { id_token }                          (throws on failure)
 *   verifyIdToken(idToken)       → payload (signature/iss/aud/exp verified; throws otherwise)
 *   clientId
 *   findIdentity(sub)            → user | null
 *   findUserByEmail(email)       → user | null
 *   linkedSubFor(userId)         → sub | null
 *   completeSignIn({ userId, link, verifyEmail, claims }) → void (link + session)
 *   safeNext(raw)                → path
 *   Author flows only (flow.authorRegistrationId set):
 *   findAuthorRegistration(id)   → { id, email, name, ... } | null (unexpired)
 *   activateAuthor({ registration, claims }) → userId | null
 *                                  (one transaction: AUTHOR account + profile + Google link,
 *                                   pending row consumed; null if it was already used)
 *   sendAuthorConfirmation({ userId, email, name }) → { ok }  (best-effort)
 * → { redirect, outcome, userId?, created? }
 */
export async function completeGoogleCallback({ params, cookieState }, deps) {
  const fail = (notice, outcome) => ({ redirect: `/login?notice=${notice}`, outcome });
  if (params?.error) return fail("google_failed", "provider_error");

  const state = typeof params?.state === "string" ? params.state : "";
  const code = typeof params?.code === "string" ? params.code : "";
  if (!state || state.length > 128 || !eq(state, String(cookieState || ""))) return fail("google_failed", "state_mismatch");
  if (!code || code.length > 2048) return fail("google_failed", "no_code");

  let flow;
  try { flow = await deps.consumeState(state); } catch { flow = null; }
  if (!flow) return fail("google_failed", "state_unknown_or_expired");

  // Author registration flows report back to the Author form; everything else to /login.
  const authorFlow = typeof flow.authorRegistrationId === "string" && flow.authorRegistrationId.length > 0;
  const refuse = (reason) => {
    const notice = noticeForReason(reason);
    return authorFlow
      ? { redirect: `/register?type=author&notice=${notice}`, outcome: `rejected:${reason}` }
      : fail(notice, `rejected:${reason}`);
  };

  let payload;
  try {
    const tokens = await deps.exchangeCode(code, flow.codeVerifier);
    if (!tokens?.id_token) return fail("google_failed", "no_id_token");
    payload = await deps.verifyIdToken(tokens.id_token);
  } catch {
    return fail("google_failed", "token_invalid");
  }

  const claims = validateIdTokenClaims(payload, { clientId: deps.clientId, nonce: flow.nonce, nowS: deps.nowS?.(), allowExternal: true });
  if (!claims.ok) return refuse(claims.reason);

  // ---- Author registration: the verified email must EXACTLY match the form ----
  let registration = null;
  if (authorFlow) {
    try { registration = await deps.findAuthorRegistration(flow.authorRegistrationId); } catch { registration = null; }
    if (!registration) return refuse("author_registration_expired");
    if (!eq(lower(registration.email), claims.email)) return refuse("author_email_mismatch");
  }

  const identity = await deps.findIdentity(claims.sub);
  const byEmail = identity ? null : await deps.findUserByEmail(claims.email);

  // New AUTHOR account: only with a matching pending registration, and only
  // when neither this Google account nor this email is already registered.
  if (registration && !identity && !byEmail) {
    let userId = null;
    try { userId = await deps.activateAuthor({ registration, claims }); } catch { userId = null; }
    if (!userId) return refuse("author_registration_expired");
    await deps.completeSignIn({ userId, link: false, verifyEmail: false, claims });
    try {
      await deps.sendAuthorConfirmation?.({ userId, email: claims.email, name: registration.name });
    } catch {
      // best-effort: a delivery failure never undoes the registration
    }
    return { redirect: "/dashboard", outcome: "ok", userId, created: true };
  }

  // Existing account (normal sign-in — never converts or re-roles an account).
  const linkedSub = byEmail ? await deps.linkedSubFor(byEmail.id) : null;
  const decision = decideAccount({ claims, identity, byEmail, linkedSub });
  if (!decision.ok) return refuse(decision.reason);

  await deps.completeSignIn({ userId: decision.userId, link: decision.link, verifyEmail: decision.verifyEmail, claims });
  return { redirect: deps.safeNext(flow.next), outcome: "ok", userId: decision.userId };
}
