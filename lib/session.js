// Custom server-side sessions over direct MySQL (mysql2). No signing secret:
// a cryptographically random token is sent in an httpOnly cookie, and only its
// SHA-256 hash is stored. Expiry is enforced in SQL to avoid timezone drift.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/db";

export const SESSION_COOKIE = "rpp_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // secure under HTTPS in prod
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Create a session row and return the raw token to place in the cookie. */
export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url"); // 256-bit
  const tokenHash = hashToken(token);
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO `sessions` (`id`, `tokenHash`, `userId`, `expiresAt`) VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))",
    [id, tokenHash, userId, SESSION_TTL_SECONDS],
  );
  return { token };
}

/** Resolve the current request's session to a safe user object, or null. */
export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne(
    `SELECT u.id, u.name, u.email, u.isAdmin, u.baseType
       FROM \`sessions\` s
       JOIN \`users\` u ON u.id = s.userId
      WHERE s.tokenHash = ? AND s.expiresAt > NOW(3)
      LIMIT 1`,
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
  await query("DELETE FROM `sessions` WHERE `tokenHash` = ?", [hashToken(token)]);
}
