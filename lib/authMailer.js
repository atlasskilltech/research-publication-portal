// Auth email orchestration (pure; deps injected). Application-managed delivery:
//
//   authServer → creates the account and GENERATES the one-time token
//                (generateLink — this sends NO email itself)
//   this file  → builds the link to OUR /auth/confirm from the returned
//                token, renders the branded template
//   SMTP       → delivers it (lib/email/send.js — Gmail/Workspace SMTP)
//
// Exactly one sender per event, so no duplicate emails. Tokens are validated
// later by lib/authServer.verifyOtp in /auth/confirm (single use, hashed in MySQL).
import { buildActionLink, VERIFY_TYPES } from "./authFlow.js";
import { idempotencyKey } from "./email/core.js";
import { inviteEmail, setupEmail, resetEmail, passwordChangedEmail, registrationConfirmedEmail, signInInstructionsEmail } from "./email/templates.js";

/** Normalise a generateLink() result → { userId, tokenHash, type } or null. */
export function readGeneratedLink(res, fallbackType) {
  const props = res?.data?.properties;
  const tokenHash = props?.hashed_token;
  const userId = res?.data?.user?.id;
  if (!tokenHash || !userId) return null;
  const type = VERIFY_TYPES.includes(props?.verification_type) ? props.verification_type : fallbackType;
  return { userId, tokenHash, type };
}

/**
 * deps: { generateLink(args) → {data, error}, sendEmail(msg) → {ok, code},
 *         redirectBase: "<site>/auth/confirm", siteUrl }
 */

/**
 * Registration complete (Google-first). One email per new account — the
 * idempotency key is the user id, so retries never send a second copy. It
 * carries no token; the CTA is the plain sign-in page.
 * deps: { sendEmail, siteUrl, isUniversityEmail }
 */
export async function deliverRegistrationConfirmed({ email, name, userId, baseType }, deps) {
  const site = String(deps.siteUrl).replace(/\/+$/, "");
  const googleEligible = deps.isUniversityEmail ? !!deps.isUniversityEmail(email) : true;
  const mail = registrationConfirmedEmail({
    siteUrl: site, loginUrl: `${site}/login`, forgotUrl: `${site}/auth/forgot-password`, name, accountType: baseType, googleEligible,
  });
  const sent = await deps.sendEmail({ to: email, ...mail, purpose: "registration_confirmed", key: idempotencyKey("registered", userId) });
  return { ok: !!sent?.ok, code: sent?.ok ? null : sent?.code || "unknown" };
}

/** "How to sign in" reminder for an existing account (no token, no password link). */
export async function deliverSignInInstructions({ email, userId, at = Date.now() }, deps) {
  const site = String(deps.siteUrl).replace(/\/+$/, "");
  const googleEligible = deps.isUniversityEmail ? !!deps.isUniversityEmail(email) : true;
  const mail = signInInstructionsEmail({ siteUrl: site, loginUrl: `${site}/login`, forgotUrl: `${site}/auth/forgot-password`, googleEligible });
  const sent = await deps.sendEmail({ to: email, ...mail, purpose: "signin_instructions", key: idempotencyKey("signin-instructions", userId, Math.floor(at / 600000)) });
  return { ok: !!sent?.ok, code: sent?.ok ? null : sent?.code || "unknown" };
}

/** LEGACY invite (verify + create password). Registration no longer uses it. */
export async function deliverInvite({ email, data }, deps) {
  const res = await deps.generateLink({ type: "invite", email, options: { ...(data ? { data } : {}), redirectTo: deps.redirectBase } });
  if (res?.error) return { ok: false, stage: "link", error: res.error };
  const gen = readGeneratedLink(res, "invite");
  if (!gen) return { ok: false, stage: "link", error: { message: "no token returned" } };
  const link = buildActionLink(deps.redirectBase, { tokenHash: gen.tokenHash, type: gen.type, flow: "setup" });
  const mail = inviteEmail({ siteUrl: deps.siteUrl, link });
  const sent = await deps.sendEmail({ to: email, ...mail, purpose: "invite", key: idempotencyKey("invite", gen.userId, gen.tokenHash) });
  return { ok: true, userId: gen.userId, emailSent: !!sent?.ok, emailCode: sent?.ok ? null : sent?.code || "unknown" };
}

/** Recovery link: flow "setup" (verified, no password yet) or "reset" (forgot password). */
export async function deliverRecovery({ email, flow }, deps) {
  const res = await deps.generateLink({ type: "recovery", email, options: { redirectTo: deps.redirectBase } });
  if (res?.error) return { ok: false, stage: "link", error: res.error };
  const gen = readGeneratedLink(res, "recovery");
  if (!gen) return { ok: false, stage: "link", error: { message: "no token returned" } };
  const f = flow === "reset" ? "reset" : "setup";
  const link = buildActionLink(deps.redirectBase, { tokenHash: gen.tokenHash, type: gen.type, flow: f });
  const mail = (f === "reset" ? resetEmail : setupEmail)({ siteUrl: deps.siteUrl, link });
  const sent = await deps.sendEmail({ to: email, ...mail, purpose: f === "reset" ? "password_reset" : "password_setup", key: idempotencyKey(`recovery-${f}`, gen.userId, gen.tokenHash) });
  return { ok: true, userId: gen.userId, emailSent: !!sent?.ok, emailCode: sent?.ok ? null : sent?.code || "unknown" };
}

/** Confirmation after the password was created/changed. Contains no token. */
export async function deliverPasswordChanged({ email, firstTime, added = false, userId, at = Date.now() }, deps) {
  const loginUrl = new URL("/login", deps.redirectBase).toString();
  const mail = passwordChangedEmail({ siteUrl: deps.siteUrl, loginUrl, firstTime, added });
  return deps.sendEmail({ to: email, ...mail, purpose: added ? "password_added" : "password_changed", key: idempotencyKey(added ? "password-added" : "password-changed", userId, Math.floor(at / 60000)) });
}
