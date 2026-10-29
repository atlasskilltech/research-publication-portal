import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/db";
import { TABLES } from "@/lib/tables.mjs";
import { loadSessionConfig } from "@/lib/config/env";

/**
 * Server-side sessions over direct MySQL.
 *
 * There is no signing secret to manage: a cryptographically random 256-bit
 * token is sent in an httpOnly cookie, and only its SHA-256 hash is stored, so
 * a leak of the `sessions` table cannot be replayed as a login. Expiry is
 * enforced in SQL (`expiresAt > NOW(3)`) to avoid any client/server clock or
 * timezone drift. Deleting the row (logout, or an admin revoking access) ends
 * the session immediately — the cookie cannot outlive it.
 */

const sessionConfig = loadSessionConfig();

export const SESSION_COOKIE = sessionConfig.cookieName;
export const SESSION_TTL_SECONDS = sessionConfig.ttlSeconds;

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true, // unreadable from JavaScript, so XSS cannot exfiltrate it
    sameSite: "lax", // blocks cross-site POSTs while keeping normal navigation
    secure: process.env.NODE_ENV === "production", // plain HTTP is fine for local XAMPP
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Create a session row and return the raw token to place in the cookie. */
export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url"); // 256-bit
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO \`${TABLES.sessions}\` (\`id\`, \`tokenHash\`, \`userId\`, \`expiresAt\`) ` +
      "VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))",
    [id, hashToken(token), userId, SESSION_TTL_SECONDS],
  );
  // Opportunistic cleanup of this user's expired rows — cheap and keeps the
  // table from accumulating dead sessions.
  await query(`DELETE FROM \`${TABLES.sessions}\` WHERE \`userId\` = ? AND \`expiresAt\` <= NOW(3)`, [userId]);
  return { token };
}

/** Resolve the current request's session to a safe user object, or null. */
export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne(
    "SELECT u.`id`, u.`name`, u.`email`, u.`isAdmin`, u.`baseType` " +
      `FROM \`${TABLES.sessions}\` s JOIN \`${TABLES.users}\` u ON u.\`id\` = s.\`userId\` ` +
      "WHERE s.`tokenHash` = ? AND s.`expiresAt` > NOW(3) LIMIT 1",
    [hashToken(token)],
  );
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isAdmin: !!row.isAdmin,
    baseType: row.baseType,
  };
}

/** Delete the session row for a raw token (used on logout). */
export async function destroySessionByToken(token) {
  if (!token) return;
  await query(`DELETE FROM \`${TABLES.sessions}\` WHERE \`tokenHash\` = ?`, [hashToken(token)]);
}
