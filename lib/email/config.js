// Email provider configuration — PURE (no server-only, no SDK imports), so the
// app (lib/config/env.js → lib/email/send.js), the CLI check
// (scripts/email-check.mjs) and the offline tests resolve the provider the same
// way. Everything comes from environment variables; nothing is hard-coded.
//
//   EMAIL_PROVIDER   sendgrid | smtp | resend   (optional; see below)
//   EMAIL_FROM       sender address (must be verified with the provider)
//   EMAIL_FROM_NAME  sender display name (default "Research Publication Portal")
//   EMAIL_REPLY_TO   optional reply-to address
//   sendgrid: SENDGRID_API_KEY
//   smtp:     EMAIL_ID, EMAIL_APP_PASSWORD, SMTP_HOST (smtp.gmail.com), SMTP_PORT (465)
//   resend:   RESEND_API_KEY
//
// When EMAIL_PROVIDER is unset the previous behaviour is kept: SMTP if its
// credentials are present, else SendGrid if SENDGRID_API_KEY is present, else
// Resend. An unknown EMAIL_PROVIDER value is a configuration error (emails are
// then not sent; the app keeps running).

export const EMAIL_PROVIDERS = Object.freeze(["sendgrid", "smtp", "resend"]);

const str = (v) => (typeof v === "string" ? v.trim() : "");

/**
 * → { provider, credentialName, apiKey, from, fromName, replyTo, smtp?, error? }
 * `apiKey` is only ever checked for presence by lib/email/core.js; it is never
 * logged or returned to a client.
 */
export function resolveEmailConfig(env = process.env) {
  const fromName = str(env.EMAIL_FROM_NAME) || "Research Publication Portal";
  const replyTo = str(env.EMAIL_REPLY_TO);
  const requested = str(env.EMAIL_PROVIDER).toLowerCase();
  const smtpUser = str(env.EMAIL_ID);
  // App Passwords are shown as "abcd efgh ijkl mnop"; the spaces aren't part of it.
  const smtpPass = String(env.EMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  const sendgridKey = str(env.SENDGRID_API_KEY);

  const sendgrid = () => ({
    provider: "sendgrid",
    credentialName: "SENDGRID_API_KEY",
    apiKey: sendgridKey,
    from: str(env.EMAIL_FROM),
    fromName,
    replyTo,
  });
  const smtp = () => ({
    provider: "smtp",
    credentialName: "EMAIL_APP_PASSWORD",
    apiKey: smtpPass, // presence check only
    // Gmail only sends as the authenticated mailbox (or its verified aliases).
    from: str(env.EMAIL_FROM) || smtpUser,
    fromName,
    replyTo,
    smtp: {
      host: str(env.SMTP_HOST) || "smtp.gmail.com",
      port: Number(env.SMTP_PORT || 465),
      user: smtpUser,
      pass: smtpPass,
    },
  });
  const resend = () => ({
    provider: "resend",
    credentialName: "RESEND_API_KEY",
    apiKey: str(env.RESEND_API_KEY),
    from: str(env.EMAIL_FROM),
    fromName,
    replyTo,
  });

  if (requested) {
    if (requested === "sendgrid") return sendgrid();
    if (requested === "smtp") return smtp();
    if (requested === "resend") return resend();
    return {
      provider: "invalid",
      credentialName: "EMAIL_PROVIDER",
      apiKey: "",
      from: str(env.EMAIL_FROM),
      fromName,
      replyTo,
      error: `EMAIL_PROVIDER must be one of: ${EMAIL_PROVIDERS.join(", ")}.`,
    };
  }
  if (smtpUser && smtpPass) return smtp();
  if (sendgridKey) return sendgrid();
  return resend();
}

/** Secret-free one-line summary for logs and the CLI check. */
export function describeEmailConfig(cfg) {
  return {
    provider: cfg.provider,
    from: cfg.from ? cfg.from.replace(/^(.).*(@.*)$/, "$1***$2") : "(not set)",
    fromName: cfg.fromName,
    credential: `${cfg.credentialName} ${cfg.apiKey ? "set" : "NOT set"}`,
  };
}
