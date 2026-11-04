/**
 * Session + one-time-token storage in MySQL (pure data layer; the cookie glue
 * lives in lib/auth/session.js).
 *
 * Sessions: the browser holds an opaque 256-bit random token; MySQL stores only
 * its SHA-256 (a database leak yields no usable cookies). A session is valid
 * only if: not revoked, before its absolute expiry, used within the idle
 * window, purpose matches, and the account is ACTIVE.
 *   purpose APP   — normal signed-in session (password or Google)
 *   purpose SETUP — 30-minute session created by an email-verification link;
 *                   ONLY usable on /create-password (never for the app)
 *   purpose RESET — same, for /reset-password
 *
 * One-time tokens (email verification / password reset): the emailed link
 * carries a random 256-bit hex token; MySQL stores its SHA-256. Consuming is a
 * single conditional UPDATE, so a token can never be used twice, even under
 * concurrent requests.
 */
import { T } from "../db/tables.mjs";
import { randomHex, randomToken, sha256Hex, uuid } from "./crypto.mjs";

export const SESSION_COOKIE = "rpp_sid";

export function sessionPolicy(env = process.env) {
  const hours = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    absoluteMs: hours(env.SESSION_TTL_HOURS, 24 * 7) * 3600_000, // 7 days
    idleMs: hours(env.SESSION_IDLE_HOURS, 72) * 3600_000, // 3 days without activity
    setupMs: 30 * 60_000,
    touchEveryMs: 5 * 60_000,
  };
}

export const TOKEN_TTL_MS = Object.freeze({ INVITE: 24 * 3600_000, RECOVERY: 3600_000 });

/** Create a session → { token (cookie value), id, expiresAt (Date) }. */
export async function createSession(q, userId, { purpose = "APP", method = null, policy = sessionPolicy(), now = Date.now() } = {}) {
  const token = randomToken(32);
  const id = uuid();
  const ttl = purpose === "APP" ? policy.absoluteMs : policy.setupMs;
  const expiresAt = new Date(now + ttl);
  await q.exec(
    `INSERT INTO \`${T.sessions}\` (id, tokenHash, userId, expiresAt, createdAt, lastSeenAt, purpose, authMethod)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, sha256Hex(token), userId, expiresAt, new Date(now), new Date(now), purpose, method],
  );
  return { token, id, expiresAt };
}

/**
 * Resolve a cookie token → { session, user } or null. `purposes` limits which
 * session kinds are accepted (default: APP only). Slides `lastSeenAt` at most
 * every few minutes (cheap, no cookie rewrite needed).
 */
export async function readSession(q, token, { purposes = ["APP"], policy = sessionPolicy(), now = Date.now() } = {}) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const row = await q.one(
    `SELECT s.id, s.userId AS user_id, s.expiresAt AS expires_at, s.lastSeenAt AS last_seen_at, s.createdAt AS created_at,
            s.revokedAt AS revoked_at, s.purpose, s.authMethod AS auth_method, u.status
       FROM \`${T.sessions}\` s JOIN \`${T.users}\` u ON u.id = s.userId
      WHERE s.tokenHash = ?`,
    [sha256Hex(token)],
  );
  if (!row || row.revoked_at || row.status !== "ACTIVE") return null;
  if (!purposes.includes(row.purpose)) return null;
  if (Date.parse(row.expires_at) <= now) return null;
  const lastSeen = Date.parse(row.last_seen_at || row.created_at);
  if (row.purpose === "APP" && now - lastSeen > policy.idleMs) return null;
  if (now - lastSeen > policy.touchEveryMs) {
    await q.exec(`UPDATE \`${T.sessions}\` SET lastSeenAt = ? WHERE id = ?`, [new Date(now), row.id]);
  }
  return row;
}

export async function revokeSession(q, token) {
  if (typeof token !== "string" || !token) return;
  await q.exec(`UPDATE \`${T.sessions}\` SET revokedAt = UTC_TIMESTAMP(3) WHERE tokenHash = ? AND revokedAt IS NULL`, [sha256Hex(token)]);
}

/** Revoke every live session of a user (password change/reset, account removal). */
export async function revokeAllSessions(q, userId, { exceptToken = null } = {}) {
  const r = exceptToken
    ? await q.exec(`UPDATE \`${T.sessions}\` SET revokedAt = UTC_TIMESTAMP(3) WHERE userId = ? AND revokedAt IS NULL AND tokenHash <> ?`, [userId, sha256Hex(exceptToken)])
    : await q.exec(`UPDATE \`${T.sessions}\` SET revokedAt = UTC_TIMESTAMP(3) WHERE userId = ? AND revokedAt IS NULL`, [userId]);
  return r.affectedRows;
}

// ---- One-time email tokens ---------------------------------------------------------

/**
 * Issue a token → raw hex (goes in the email link). Older unconsumed tokens of
 * the same purpose for this user are invalidated, so only the newest link works.
 */
export async function issueToken(q, userId, purpose, { now = Date.now() } = {}) {
  if (!TOKEN_TTL_MS[purpose]) throw new Error("issueToken: bad purpose");
  const raw = randomHex(32);
  await q.exec(`UPDATE \`${T.authTokens}\` SET consumed_at = UTC_TIMESTAMP(3) WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`, [userId, purpose]);
  await q.exec(
    `INSERT INTO \`${T.authTokens}\` (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [sha256Hex(raw), userId, purpose, new Date(now + TOKEN_TTL_MS[purpose]), new Date(now)],
  );
  return raw;
}

/**
 * Consume a token exactly once. → { userId, purpose } or { error: "expired"|"invalid" }.
 * Already-used and expired tokens both report "expired" (same user message).
 */
export async function consumeToken(q, raw, purposes, { now = Date.now() } = {}) {
  if (typeof raw !== "string" || !/^[a-f0-9]{64}$/i.test(raw)) return { error: "invalid" };
  const h = sha256Hex(raw.toLowerCase());
  const row = await q.one(`SELECT user_id, purpose, expires_at, consumed_at FROM \`${T.authTokens}\` WHERE token_hash = ?`, [h]);
  if (!row || !purposes.includes(row.purpose)) return { error: "invalid" };
  if (row.consumed_at || Date.parse(row.expires_at) <= now) return { error: "expired" };
  const r = await q.exec(
    `UPDATE \`${T.authTokens}\` SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    [new Date(now), h, new Date(now)],
  );
  if (r.affectedRows !== 1) return { error: "expired" }; // lost a race with another request
  return { userId: row.user_id, purpose: row.purpose };
}

/** Housekeeping: delete expired OAuth states (sessions/tokens are kept for audit). */
export async function purgeExpired(q, now = Date.now()) {
  await q.exec(`DELETE FROM \`${T.oauthStates}\` WHERE expires_at < ?`, [new Date(now)]);
}
