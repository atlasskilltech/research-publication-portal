// Auth email orchestration (pure; deps injected). Application-managed delivery:
//
//   Supabase  → creates the account and GENERATES the one-time token
//               (auth.admin.generateLink — this sends NO email itself)
//   this file → builds the link to OUR /auth/confirm from the returned
//               hashed_token, renders the branded template
//   SMTP      → delivers it (lib/email/send.js; Resend only as fallback)
//
// Exactly one sender per event, so no duplicate emails. Tokens are validated
// later by Supabase (verifyOtp in /auth/confirm); we never mint tokens.
import { buildActionLink, VERIFY_TYPES } from "./authFlow.js";
import { idempotencyKey } from "./email/core.js";
import { inviteEmail, setupEmail, resetEmail, passwordChangedEmail } from "./email/templates.js";

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

/** Registration (or re-invite of an unverified account). */
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
export async function deliverPasswordChanged({ email, firstTime, userId, at = Date.now() }, deps) {
  const loginUrl = new URL("/login", deps.redirectBase).toString();
  const mail = passwordChangedEmail({ siteUrl: deps.siteUrl, loginUrl, firstTime });
  return deps.sendEmail({ to: email, ...mail, purpose: "password_changed", key: idempotencyKey("password-changed", userId, Math.floor(at / 60000)) });
}
