import "server-only";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, createSession, readSession, revokeSession, revokeAllSessions, sessionPolicy } from "@/lib/auth/store.mjs";

/**
 * Session cookie glue (Next.js request scope). The cookie is httpOnly,
 * SameSite=Lax, Secure in production, path "/", and lives no longer than the
 * session's absolute expiry. Its value is an opaque random token; everything
 * else is server-side in MySQL.
 */
const secure = () => process.env.NODE_ENV === "production";

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value || null;
}

async function setCookie(token, expiresAt) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "lax", path: "/", maxAge: 0 });
}

/**
 * Start a session for userId and set the cookie. Any session the browser
 * already carried is revoked first (no session fixation / stacking).
 * purpose APP | SETUP | RESET; method "password" | "google" | "email_link".
 */
export async function startSession(userId, { purpose = "APP", method = null } = {}) {
  const prev = await sessionToken();
  if (prev) await revokeSession(db, prev);
  const s = await createSession(db, userId, { purpose, method, policy: sessionPolicy() });
  await setCookie(s.token, s.expiresAt);
  return s;
}

/** Current session row (APP by default) or null. Never trusts anything but the cookie. */
export async function currentSession(purposes = ["APP"]) {
  const token = await sessionToken();
  if (!token) return null;
  return readSession(db, token, { purposes, policy: sessionPolicy() });
}

/** Sign out this browser: revoke server-side, then clear the cookie. */
export async function endSession() {
  const token = await sessionToken();
  if (token) await revokeSession(db, token);
  await clearSessionCookie();
}

/** Revoke every session of the user (e.g. after a password change) and clear this cookie. */
export async function endAllSessions(userId) {
  await revokeAllSessions(db, userId);
  await clearSessionCookie();
}
