// Custom server-side sessions. No signing secret required: a cryptographically
// random token is sent in an httpOnly cookie, and only its SHA-256 hash is
// stored in MySQL. Lookups hash the incoming token and match the stored hash.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

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
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await prisma.session.create({ data: { tokenHash, userId, expiresAt } });
  return { token, expiresAt };
}

/** Resolve the current request's session to a safe user object, or null. */
export async function getSessionUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    try {
      await prisma.session.delete({ where: { id: session.id } });
    } catch {
      /* best-effort cleanup */
    }
    return null;
  }

  const u = session.user;
  return { id: u.id, name: u.name, email: u.email, isAdmin: u.isAdmin, baseType: u.baseType };
}

/** Delete the session row for a raw token (used on logout). */
export async function destroySessionByToken(token) {
  if (!token) return;
  try {
    await prisma.session.delete({ where: { tokenHash: hashToken(token) } });
  } catch {
    /* already gone */
  }
}
