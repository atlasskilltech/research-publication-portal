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
 *      creates accounts and never changes roles or the admin flag.
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

/** User-facing messages, keyed by the ?notice= value on /login. */
export const GOOGLE_NOTICES = Object.freeze({
  google_domain: "Please sign in using your ATLAS University email account.",
  google_unverified:
    "Your Google account email is not verified. Please sign in using your verified ATLAS University email account.",
  google_not_registered:
    "There is no portal account for this ATLAS University email yet. Register first, then sign in with Google.",
  google_disabled: "This account is not active. Please contact the portal administrator.",
  google_failed: "Google sign-in could not be completed or has expired. Please try again.",
  google_unavailable: "Google sign-in is temporarily unavailable. Please try again shortly, or use your email and password if you have created one.",
});

const REASON_NOTICE = Object.freeze({
  domain: "google_domain",
  hd_mismatch: "google_domain",
  identity_mismatch: "google_domain",
  unverified: "google_unverified",
  not_registered: "google_not_registered",
  disabled: "google_disabled",
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
 * explicit and testable. → { ok: true, sub, email } | { ok: false, reason }
 */
export function validateIdTokenClaims(p, { clientId, nonce, nowS = Math.floor(Date.now() / 1000) }) {
  if (!p || typeof p !== "object") return { ok: false, reason: "bad_token" };
  if (!GOOGLE_ISSUERS.includes(p.iss)) return { ok: false, reason: "bad_issuer" };
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!clientId || !aud.includes(clientId)) return { ok: false, reason: "bad_audience" };
  if ((aud.length > 1 || p.azp !== undefined) && p.azp !== clientId) return { ok: false, reason: "bad_audience" };
  if (typeof p.exp !== "number" || p.exp + CLOCK_SKEW_S < nowS) return { ok: false, reason: "expired" };
  if (typeof p.iat !== "number" || p.iat - CLOCK_SKEW_S > nowS) return { ok: false, reason: "bad_iat" };
  if (!nonce || !eq(String(p.nonce || ""), nonce)) return { ok: false, reason: "bad_nonce" };
  if (typeof p.sub !== "string" || !p.sub || p.sub.length > 255) return { ok: false, reason: "bad_token" };
  if (!isUniversityEmail(p.email)) return { ok: false, reason: "domain" };
  if (p.email_verified !== true) return { ok: false, reason: "unverified" };
  if (lower(p.hd) !== GOOGLE_ALLOWED_DOMAIN) return { ok: false, reason: "hd_mismatch" };
  return { ok: true, sub: p.sub, email: p.email.toLowerCase() };
}

/**
 * Match the verified Google identity to an EXISTING account.
 *   identity  — the user linked to this Google `sub` (or null)
 *   byEmail   — the user whose email equals the token email (or null)
 *   linkedSub — the Google sub already linked to byEmail (or null)
 * → { ok: true, userId, link, verifyEmail } | { ok: false, reason }
 */
export function decideAccount({ claims, identity, byEmail, linkedSub }) {
  if (identity) {
    if (lower(identity.email) !== claims.email) return { ok: false, reason: "identity_mismatch" };
    if (identity.status !== "ACTIVE") return { ok: false, reason: "disabled" };
    return { ok: true, userId: identity.id, link: false, verifyEmail: !identity.email_confirmed_at };
  }
  if (!byEmail) return { ok: false, reason: "not_registered" };
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

/** Google authorize URL for the start route. */
export function buildAuthorizeUrl({ clientId, redirectUri, state, nonce, codeChallenge }) {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("hd", GOOGLE_ALLOWED_DOMAIN); // account-chooser hint only; enforced on the token
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
 *   consumeState(state)          → { nonce, codeVerifier, next } | null  (single use)
 *   exchangeCode(code, verifier) → { id_token }                          (throws on failure)
 *   verifyIdToken(idToken)       → payload (signature/iss/aud/exp verified; throws otherwise)
 *   clientId
 *   findIdentity(sub)            → user | null
 *   findUserByEmail(email)       → user | null
 *   linkedSubFor(userId)         → sub | null
 *   completeSignIn({ userId, link, verifyEmail, claims }) → void (link + session)
 *   safeNext(raw)                → path
 * → { redirect, outcome }
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

  let payload;
  try {
    const tokens = await deps.exchangeCode(code, flow.codeVerifier);
    if (!tokens?.id_token) return fail("google_failed", "no_id_token");
    payload = await deps.verifyIdToken(tokens.id_token);
  } catch {
    return fail("google_failed", "token_invalid");
  }

  const claims = validateIdTokenClaims(payload, { clientId: deps.clientId, nonce: flow.nonce, nowS: deps.nowS?.() });
  if (!claims.ok) return fail(noticeForReason(claims.reason), `rejected:${claims.reason}`);

  const identity = await deps.findIdentity(claims.sub);
  const byEmail = identity ? null : await deps.findUserByEmail(claims.email);
  const linkedSub = byEmail ? await deps.linkedSubFor(byEmail.id) : null;
  const decision = decideAccount({ claims, identity, byEmail, linkedSub });
  if (!decision.ok) return fail(noticeForReason(decision.reason), `rejected:${decision.reason}`);

  await deps.completeSignIn({ userId: decision.userId, link: decision.link, verifyEmail: decision.verifyEmail, claims });
  return { redirect: deps.safeNext(flow.next), outcome: "ok", userId: decision.userId };
}
