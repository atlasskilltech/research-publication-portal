/**
 * External AUTHOR data (AIDC 2026) — pending registrations + profiles (MySQL).
 * Pure data access; every function takes `q` (db or transaction handle).
 * Pending registrations hold only the SHA-256 of the browser token.
 */
import { T } from "../db/tables.mjs";
import { randomToken, sha256Hex, uuid } from "../auth/crypto.mjs";

/**
 * Store a pending registration (no account yet). Expired rows are purged and
 * any earlier pending row for the SAME email from this browser flow is
 * replaced, so a person can simply re-submit the form. → { id, token }
 */
export async function createPendingAuthorRegistration(q, data, { ttlSeconds }) {
  const id = uuid();
  const token = randomToken(32);
  await q.exec(`DELETE FROM \`${T.authorRegistrations}\` WHERE expires_at < UTC_TIMESTAMP(3)`);
  await q.exec(
    `INSERT INTO \`${T.authorRegistrations}\`
       (id, token_hash, email, name, phone, organization, current_status, designation, location, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
    [id, sha256Hex(token), data.email, data.name, data.phone, data.organization, data.currentStatus, data.designation, data.location,
      new Date(Date.now() + ttlSeconds * 1000)],
  );
  return { id, token };
}

const PENDING_COLS = "id, email, name, phone, organization, current_status, designation, location, expires_at";

/** Pending registration for the raw browser token (unexpired), or null. */
export async function findPendingAuthorRegistrationByToken(q, token) {
  if (typeof token !== "string" || token.length < 16 || token.length > 128) return null;
  return q.one(
    `SELECT ${PENDING_COLS} FROM \`${T.authorRegistrations}\` WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP(3)`,
    [sha256Hex(token)],
  );
}

/** Pending registration by id (unexpired), or null. */
export async function findPendingAuthorRegistration(q, id) {
  if (typeof id !== "string" || !id) return null;
  return q.one(`SELECT ${PENDING_COLS} FROM \`${T.authorRegistrations}\` WHERE id = ? AND expires_at > UTC_TIMESTAMP(3)`, [id]);
}

/**
 * Lock + delete a pending registration (single use) inside a transaction, and
 * drop any other pending rows for the same email. → the row, or null when it
 * was already used or has expired.
 */
export async function consumePendingAuthorRegistration(tx, id) {
  const row = await tx.one(`SELECT ${PENDING_COLS} FROM \`${T.authorRegistrations}\` WHERE id = ? FOR UPDATE`, [id]);
  if (!row) return null;
  await tx.exec(`DELETE FROM \`${T.authorRegistrations}\` WHERE id = ? OR email = ?`, [id, row.email]);
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

/** The author profile for a user (or null; also null before migration 004). */
export async function findAuthorProfile(q, userId) {
  try {
    return await q.one(
      `SELECT phone, organization, current_status, designation, location, conference, created_at FROM \`${T.authorProfiles}\` WHERE user_id = ?`,
      [userId],
    );
  } catch (e) {
    if (e?.code === "ER_NO_SUCH_TABLE") return null;
    throw e;
  }
}
