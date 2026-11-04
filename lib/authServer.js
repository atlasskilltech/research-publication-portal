import "server-only";

import { db, isDuplicate } from "@/lib/db";
import { siteUrl } from "@/lib/config/env";
import { sendEmail } from "@/lib/email/send";
import { deliverInvite, deliverRecovery, deliverPasswordChanged } from "@/lib/authMailer";
import { emailRedirectUrl, createRateLimiter } from "@/lib/authFlow";
import { issueToken, consumeToken } from "@/lib/auth/store.mjs";
import { hashPassword } from "@/lib/auth/password.mjs";
import { startSession, endAllSessions } from "@/lib/auth/session";
import { getSetupSession } from "@/lib/session";
import {
  findUserByEmail as repoFindUserByEmail, createRegisteredUser, markEmailVerified, setPasswordHash,
} from "@/lib/repos/users.mjs";

/**
 * Server glue for registration, email verification and password setup/reset —
 * application-managed on MySQL (lib/authFlow.js holds the rules).
 *
 *   generateLink  — create the invited account (registration) and/or a single-use
 *                   token; returns the same shape lib/authMailer.js consumes.
 *   verifyOtp     — consume the token (once), mark the email verified, and start a
 *                   30-minute SETUP/RESET session that can ONLY set a password.
 *   updatePassword — Argon2id hash, then every session of the user is revoked.
 * Nothing here logs tokens, passwords or email addresses.
 */

/** redirectTo for auth emails: <site>/auth/confirm. Refuses a localhost fallback in production. */
export function authEmailRedirect() {
  const r = emailRedirectUrl(siteUrl(), {
    production: process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!r.ok) throw new Error(`auth email redirect misconfigured: ${r.error}`);
  return r.url;
}

// One limiter per server process: 5 resends / 15 min per IP, 3 / hour per email.
const limiter = createRateLimiter({ ip: [5, 15 * 60 * 1000], email: [3, 60 * 60 * 1000] });
export const resendRateLimit = (keys) => limiter(keys);
const registerLimiter = createRateLimiter({ ip: [10, 15 * 60 * 1000], email: [3, 60 * 60 * 1000] });
export const registerRateLimit = (keys) => registerLimiter(keys);
// Sign-in: 10 failures-or-attempts / 15 min per account, 50 per IP.
const loginLimiter = createRateLimiter({ ip: [50, 15 * 60 * 1000], email: [10, 15 * 60 * 1000] });
export const loginRateLimit = (keys) => loginLimiter(keys);

/** Client IP behind the reverse proxy (first X-Forwarded-For hop). */
export function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : request.headers.get("x-real-ip") || "unknown").trim();
}

/** Look up an account by email: { id, email_confirmed_at } or null. */
export async function findUserByEmail(email) {
  const u = await repoFindUserByEmail(db, email);
  return u ? { id: u.id, email_confirmed_at: u.email_confirmed_at || null } : null;
}

const VERIFY_PURPOSE = { invite: "INVITE", signup: "INVITE", email: "INVITE", recovery: "RECOVERY" };

/**
 * Create the account (registration) and/or a single-use token (sends NO email).
 *   invite   + data → registration: creates the unverified, passwordless,
 *                     non-admin account, then an INVITE token (one transaction).
 *   invite (no data) → re-invite of an existing UNVERIFIED account.
 *   recovery         → RECOVERY token for an existing account.
 * → { data: { user: { id }, properties: { hashed_token, verification_type } } } | { error }
 */
export async function generateLink({ type, email, options = {} }) {
  try {
    return await db.transaction(async (tx) => {
      let user = await repoFindUserByEmail(tx, email);
      if (type === "invite") {
        if (user && user.email_confirmed_at) return { error: { status: 422, code: "email_exists", message: "A user with this email address has already been registered" } };
        if (!user) {
          const d = options.data;
          if (!d) return { error: { status: 404, code: "user_not_found", message: "User not found" } };
          const id = await createRegisteredUser(tx, {
            name: d.name, email, baseType: d.base_type, schoolCode: d.school_code || null, applicationNo: d.application_no || null,
          });
          user = { id };
        }
        const raw = await issueToken(tx, user.id, "INVITE");
        return { data: { user: { id: user.id }, properties: { hashed_token: raw, verification_type: "invite" } }, error: null };
      }
      if (type === "recovery") {
        if (!user) return { error: { status: 404, code: "user_not_found", message: "User not found" } };
        const raw = await issueToken(tx, user.id, "RECOVERY");
        return { data: { user: { id: user.id }, properties: { hashed_token: raw, verification_type: "recovery" } }, error: null };
      }
      return { error: { status: 400, message: "unsupported link type" } };
    });
  } catch (e) {
    if (isDuplicate(e)) return { error: { status: 409, code: "email_exists", message: "already registered" } };
    throw e;
  }
}

/**
 * verifyOtp({ token_hash, type }) for /auth/confirm:
 * consume the single-use token and mark the email verified.
 * → { data: { user: { id } } } | { error: { code, status } }
 */
export async function verifyOtp({ type, token_hash }) {
  const purpose = VERIFY_PURPOSE[type];
  if (!purpose) return { data: null, error: { code: "invalid", status: 400 } };
  return db.transaction(async (tx) => {
    const r = await consumeToken(tx, token_hash, [purpose]);
    if (r.error === "expired") return { data: null, error: { code: "otp_expired", status: 403 } };
    if (r.error) return { data: null, error: { code: "invalid", status: 400 } };
    await markEmailVerified(tx, r.userId);
    return { data: { user: { id: r.userId } }, error: null };
  });
}

/** After a successful verifyOtp: a SETUP/RESET session that can only set the password. */
export async function issueSetupProof(userId, flow = "setup") {
  await startSession(userId, { purpose: flow === "reset" ? "RESET" : "SETUP", method: "email_link" });
}

/** deps for lib/authFlow.setPassword. */
export const setPasswordDeps = {
  getSetupSession,
  updatePassword: async (userId, password) => {
    const hash = await hashPassword(password);
    const ok = await setPasswordHash(db, userId, hash);
    return ok ? { error: null } : { error: { status: 404, message: "user not found" } };
  },
  // Password set/changed → every session (incl. this setup session) ends; the
  // user signs in again with the new password.
  finish: (userId) => endAllSessions(userId),
};

// ---- Application-managed auth emails (token generated here, SMTP delivers) ----

function mailerDeps() {
  return { generateLink, sendEmail, redirectBase: authEmailRedirect(), siteUrl: siteUrl() };
}

/** Registration: create the invited account + send the branded invite. */
export function registerAndInvite(email, data) {
  return deliverInvite({ email, data }, mailerDeps());
}

/** Re-send an invite to an UNVERIFIED account. { error } only if no link could be generated. */
export async function sendInvite(email) {
  const r = await deliverInvite({ email }, mailerDeps());
  if (!r.ok) return { error: r.error || { message: "link generation failed" } };
  return { error: null, delivered: r.emailSent };
}

/** Recovery link — flow "setup" (verified, no password yet) or "reset" (forgot password). */
export async function sendRecovery(email, flow = "setup") {
  const r = await deliverRecovery({ email, flow }, mailerDeps());
  return r.ok && r.emailSent ? { error: null } : { error: r.error || { code: r.emailCode } };
}

/** Best-effort "your password was set/changed" confirmation. */
export function notifyPasswordChanged(email, { firstTime, userId }) {
  return deliverPasswordChanged({ email, firstTime, userId }, mailerDeps());
}
