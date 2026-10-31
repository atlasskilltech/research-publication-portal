import "server-only";

import nodemailer from "nodemailer";
import { Resend } from "resend";
import { emailConfig } from "@/lib/config/env";
import { createEmailSender } from "@/lib/email/core";
import { createSmtpClient } from "@/lib/email/smtp";

/**
 * Server-only email delivery. Provider:
 *   SMTP   — when EMAIL_ID + EMAIL_APP_PASSWORD are set (the portal's own
 *            Google Workspace mailbox; default).
 *   Resend — only if SMTP isn't configured and RESEND_API_KEY is set.
 * Credentials are read here only, never NEXT_PUBLIC_, never logged or returned.
 * Callers use sendEmail({ to, subject, html, text, purpose, key }) and get
 * { ok, id } | { ok:false, code } — it never throws.
 */
let sender = null;

function getSender() {
  if (sender) return sender;
  const config = emailConfig();
  let client = null;
  if (config.provider === "smtp") {
    client = createSmtpClient(nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    }));
  } else if (config.provider === "resend" && config.apiKey) {
    client = new Resend(config.apiKey);
  }
  sender = createEmailSender({
    client,
    config,
    logger: {
      info: (msg, meta) => console.info(msg, JSON.stringify(meta)),
      error: (msg, meta) => console.error(msg, JSON.stringify(meta)),
    },
  });
  return sender;
}

export function sendEmail(message) {
  return getSender()(message);
}
