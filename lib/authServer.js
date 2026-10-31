import "server-only";

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSupabaseSecret, siteUrl } from "@/lib/config/env";
import { sendEmail } from "@/lib/email/send";
import { deliverInvite, deliverRecovery, deliverPasswordChanged } from "@/lib/authMailer";
import {
  SETUP_COOKIE, SETUP_TTL_SECONDS, createSetupToken, emailRedirectUrl, createRateLimiter,
} from "@/lib/authFlow";

/**
 * Server glue for the registration / password-setup flow (see lib/authFlow.js
 * for the rules). Nothing here logs tokens, passwords or email addresses.
 */

/** redirectTo for auth emails: <site>/auth/confirm. Refuses a localhost fallback in production. */
export function authEmailRedirect() {
  const r = emailRedirectUrl(siteUrl(), {
    // Only the ACCIDENTAL case: production with NEXT_PUBLIC_SITE_URL unset,
    // which would otherwise fall back to http://localhost:5630.
    production: process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL,
  });
  if (!r.ok) throw new Error(`auth email redirect misconfigured: ${r.error}`);
  return r.url;
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SETUP_TTL_SECONDS,
});

/** After a successful verifyOtp: prove (for 30 min) that THIS user just verified a link. */
export async function issueSetupProof(userId, flow = "setup") {
  const jar = await cookies();
  jar.set(SETUP_COOKIE, createSetupToken(userId, loadSupabaseSecret(), Date.now(), SETUP_TTL_SECONDS, flow), cookieOptions());
}
export async function readSetupProof() {
  const jar = await cookies();
  return jar.get(SETUP_COOKIE)?.value || null;
}
export async function clearSetupProof() {
  const jar = await cookies();
  jar.set(SETUP_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
export const setupSecret = () => loadSupabaseSecret();

// One limiter per server process: 5 resends / 15 min per IP, 3 / hour per email.
const limiter = createRateLimiter({ ip: [5, 15 * 60 * 1000], email: [3, 60 * 60 * 1000] });
export const resendRateLimit = (keys) => limiter(keys);
// Separate budget for self-registration (each attempt can create an account and send an email).
const registerLimiter = createRateLimiter({ ip: [10, 15 * 60 * 1000], email: [3, 60 * 60 * 1000] });
export const registerRateLimit = (keys) => registerLimiter(keys);

/** Client IP behind the reverse proxy (first X-Forwarded-For hop). */
export function clientIp(request) {
  const xff = request.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : request.headers.get("x-real-ip") || "unknown").trim();
}

/** Look up an account by email (service role): { id, email_confirmed_at } or null. */
export async function findUserByEmail(email) {
  const admin = createAdminClient();
  // Exact match on the normalized (lowercase) address — NOT ilike, whose _ and %
  // wildcards could match a different account.
  const { data: prof } = await admin.from("profiles").select("id").eq("email", email.toLowerCase()).limit(1).maybeSingle();
  if (!prof) return null;
  const { data, error } = await admin.auth.admin.getUserById(prof.id);
  if (error || !data?.user) return null;
  return { id: data.user.id, email_confirmed_at: data.user.email_confirmed_at || null };
}

// ---- Application-managed auth emails (Supabase generates, Resend delivers) ---

function mailerDeps() {
  const admin = createAdminClient();
  return {
    generateLink: (args) => admin.auth.admin.generateLink(args),
    sendEmail,
    redirectBase: authEmailRedirect(),
    siteUrl: siteUrl(),
  };
}

/** Registration: create the invited account + send the branded invite. */
export function registerAndInvite(email, data) {
  return deliverInvite({ email, data }, mailerDeps());
}

/**
 * Re-send an invite to an UNVERIFIED account. Returns { error } ONLY when
 * Supabase refused to generate the invite link (the caller then falls back to
 * a recovery link). An email-delivery failure is NOT an error here: falling
 * back would send a second, different email for the same request.
 */
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
