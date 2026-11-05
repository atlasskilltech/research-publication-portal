import "server-only";

import { createRemoteJWKSet } from "jose";
import { db, T } from "@/lib/db";
import { randomToken, sha256B64u, sha256Hex, uuid } from "@/lib/auth/crypto.mjs";
import { findUserByEmail, findUserById, markEmailVerified, touchLastLogin } from "@/lib/repos/users.mjs";
import { startSession } from "@/lib/auth/session";
import {
  GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, OAUTH_FLOW_TTL_SECONDS,
  buildAuthorizeUrl, validateRedirectUri, verifyIdTokenSignature,
} from "@/lib/oauthPolicy";

/**
 * Server side of Google Sign-In (direct OpenID Connect; rules in lib/oauthPolicy.js).
 * Config (server-only env): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 * GOOGLE_REDIRECT_URI (= https://<portal>/auth/callback). The secret never
 * leaves the server. Never logs codes, tokens or emails.
 */
export function googleConfig() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const redirect = validateRedirectUri(process.env.GOOGLE_REDIRECT_URI);
  if (!clientId || !clientSecret || !redirect.ok) return null;
  return { clientId, clientSecret, redirectUri: redirect.url };
}

/**
 * Create a single-use state row and return the Google authorize URL + the raw state.
 * opts.loginHint (optional) pre-selects an account; the author column of
 * migration 004 is never written (Authors don't use Google).
 */
export async function beginGoogleSignIn(next, cfg = googleConfig(), { loginHint = null } = {}) {
  if (!cfg) throw new Error("google sign-in is not configured");
  const state = randomToken(32);
  const nonce = randomToken(32);
  const codeVerifier = randomToken(48); // 64 chars, within RFC 7636's 43–128
  await db.exec(
    `INSERT INTO \`${T.oauthStates}\` (state_hash, nonce, code_verifier, next_path, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [sha256Hex(state), nonce, codeVerifier, next, new Date(), new Date(Date.now() + OAUTH_FLOW_TTL_SECONDS * 1000)],
  );
  const url = buildAuthorizeUrl({
    clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, nonce, codeChallenge: sha256B64u(codeVerifier),
    loginHint,
  });
  return { url, state };
}

/** Read AND delete the state row in one transaction (single use). Expired → null. */
export async function consumeState(state) {
  return db.transaction(async (tx) => {
    const h = sha256Hex(state);
    // SELECT * so this works with or without migration 004's author column.
    const row = await tx.one(`SELECT * FROM \`${T.oauthStates}\` WHERE state_hash = ? FOR UPDATE`, [h]);
    if (!row) return null;
    await tx.exec(`DELETE FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [h]);
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return { nonce: row.nonce, codeVerifier: row.code_verifier, next: row.next_path };
  });
}

/** Authorization code → tokens at Google's token endpoint (client secret + PKCE verifier). */
export async function exchangeCode(code, codeVerifier, cfg = googleConfig()) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, code_verifier: codeVerifier, client_id: cfg.clientId, client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri, grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`token endpoint HTTP ${res.status}`);
  return res.json();
}

let jwks = null;
/** Verify signature (RS256, Google JWKS, cached), issuer, audience, exp/nbf. → payload (throws otherwise). */
export async function verifyIdToken(idToken, cfg = googleConfig()) {
  jwks ||= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return verifyIdTokenSignature(idToken, jwks, cfg.clientId);
}

/** The user linked to a Google `sub` (profile shape) or null. */
export async function findIdentity(sub) {
  const row = await db.one(`SELECT user_id FROM \`${T.userIdentities}\` WHERE provider = 'google' AND subject = ?`, [sub]);
  return row ? findUserById(db, row.user_id) : null;
}

export async function linkedSubFor(userId) {
  const row = await db.one(`SELECT subject FROM \`${T.userIdentities}\` WHERE provider = 'google' AND user_id = ?`, [userId]);
  return row?.subject || null;
}

export const findUser = (email) => findUserByEmail(db, email);

/**
 * Accepted sign-in: link the Google identity on first use, mark the email
 * verified if it wasn't (Google proved ownership), record the login and start
 * an APP session. Never touches roles or the admin flag.
 */
export async function completeSignIn({ userId, link, verifyEmail, claims }) {
  await db.transaction(async (tx) => {
    if (link) {
      await tx.exec(
        `INSERT INTO \`${T.userIdentities}\` (id, user_id, provider, subject, email, created_at, last_login_at) VALUES (?, ?, 'google', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [uuid(), userId, claims.sub, claims.email],
      );
    } else {
      await tx.exec(`UPDATE \`${T.userIdentities}\` SET last_login_at = UTC_TIMESTAMP(3), email = ? WHERE provider = 'google' AND subject = ?`, [claims.email, claims.sub]);
    }
    if (verifyEmail) await markEmailVerified(tx, userId);
    await touchLastLogin(tx, userId);
  });
  await startSession(userId, { purpose: "APP", method: "google" });
}
