import "server-only";

import nodemailer from "nodemailer";
import { Resend } from "resend";
import sendgridMail from "@sendgrid/mail";
import { emailConfig } from "@/lib/config/env";
import { createEmailSender, resolveSender } from "@/lib/email/core";
import { createSmtpClient } from "@/lib/email/smtp";
import { createSendgridClient } from "@/lib/email/sendgrid";
import { describeEmailConfig } from "@/lib/email/config";

/**
 * Server-only email delivery. The provider comes from the environment
 * (lib/email/config.js):
 *   EMAIL_PROVIDER=sendgrid → SendGrid (official @sendgrid/mail SDK, SENDGRID_API_KEY)
 *   EMAIL_PROVIDER=smtp     → SMTP (EMAIL_ID + EMAIL_APP_PASSWORD)
 *   EMAIL_PROVIDER=resend   → Resend (RESEND_API_KEY)
 *   unset                   → SMTP if configured, else SendGrid if its key is set, else Resend
 * Credentials are read here only, never NEXT_PUBLIC_, never logged or returned.
 * Callers use sendEmail({ to, subject, html, text, purpose, key }) and get
 * { ok, id } | { ok:false, code } — it never throws. A missing or invalid
 * configuration makes every send return { ok:false, code:"config" } (logged
 * once per send, without secrets) instead of crashing the app.
 */
let sender = null;

const logger = {
  info: (msg, meta) => console.info(msg, JSON.stringify(meta)),
  error: (msg, meta) => console.error(msg, JSON.stringify(meta)),
};

function buildClient(config) {
  if (config.provider === "sendgrid" && config.apiKey) {
    const svc = new sendgridMail.MailService();
    svc.setApiKey(config.apiKey);
    svc.setTimeout(15000);
    return createSendgridClient(svc);
  }
  if (config.provider === "smtp" && config.smtp?.user && config.smtp?.pass) {
    return createSmtpClient(nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    }));
  }
  if (config.provider === "resend" && config.apiKey) return new Resend(config.apiKey);
  return null;
}

/**
 * Validate the email configuration and log a one-line, secret-free status.
 * Called once at server start (instrumentation.js) and when the mailer is first
 * built. Never throws. → { ok, provider, error? }
 */
export function checkEmailConfig() {
  try {
    const config = emailConfig();
    const verdict = resolveSender(config);
    const info = describeEmailConfig(config);
    if (verdict.ok) logger.info("email: configured", info);
    else logger.error("email: not configured", { ...info, reason: verdict.error });
    return { ok: verdict.ok, provider: config.provider, ...(verdict.ok ? {} : { error: verdict.error }) };
  } catch (e) {
    logger.error("email: configuration check failed", { reason: e?.name || "error" });
    return { ok: false, provider: "unknown", error: "configuration check failed" };
  }
}

function getSender() {
  if (sender) return sender;
  const config = emailConfig();
  checkEmailConfig();
  let client = null;
  try {
    client = buildClient(config);
  } catch (e) {
    logger.error("email: provider client could not be created", { provider: config.provider, reason: e?.name || "error" });
  }
  sender = createEmailSender({ client, config, logger });
  return sender;
}

export function sendEmail(message) {
  return getSender()(message);
}
