/**
 * Check the portal's email configuration (same env + same code path as the app).
 *
 *   npm run email:check                       validate only — sends NOTHING
 *   npm run email:check -- --to you@example.edu   also send ONE test email to that address
 *
 * Prints the provider, a masked sender and whether the credential is set —
 * never the API key or password. With --to it sends through the same core +
 * provider adapter the app uses (SendGrid / SMTP / Resend) and prints the
 * provider's message id, or the error class (e.g. "config" when the sender
 * isn't verified in SendGrid).
 */
import nodemailer from "nodemailer";
import { Resend } from "resend";
import sendgridMail from "@sendgrid/mail";
import { resolveEmailConfig, describeEmailConfig } from "../lib/email/config.js";
import { createEmailSender, resolveSender, maskEmail } from "../lib/email/core.js";
import { createSendgridClient } from "../lib/email/sendgrid.js";
import { createSmtpClient } from "../lib/email/smtp.js";
import { editorialNotificationEmail } from "../lib/email/templates.js";

const args = process.argv.slice(2);
const toIdx = args.indexOf("--to");
const to = toIdx >= 0 ? String(args[toIdx + 1] || "").trim() : "";

const cfg = resolveEmailConfig(process.env);
const info = describeEmailConfig(cfg);
console.log("\nEmail configuration:");
console.log(`  provider    ${info.provider}`);
console.log(`  sender      ${info.fromName} <${info.from}>`);
console.log(`  credential  ${info.credential}`);
const verdict = resolveSender(cfg);
if (!verdict.ok) {
  console.log(`\n✗ Not configured: ${verdict.error}\n`);
  process.exit(1);
}
console.log("\n✓ Configuration is complete.");
if (!to) {
  console.log("  (Nothing was sent. Add --to <address> to send one real test email.)\n");
  process.exit(0);
}

let client;
if (cfg.provider === "sendgrid") {
  const svc = new sendgridMail.MailService();
  svc.setApiKey(cfg.apiKey);
  svc.setTimeout(15000);
  client = createSendgridClient(svc);
} else if (cfg.provider === "smtp") {
  client = createSmtpClient(nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass }, connectionTimeout: 15000,
  }));
} else {
  client = new Resend(cfg.apiKey);
}

const lines = [];
const send = createEmailSender({
  client, config: cfg,
  logger: { info: (m, meta) => lines.push(`${m} ${JSON.stringify(meta)}`), error: (m, meta) => lines.push(`${m} ${JSON.stringify(meta)}`) },
});
const site = String(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:5630").replace(/\/+$/, "");
const stamp = new Date().toISOString();
const mail = editorialNotificationEmail({
  siteUrl: site,
  subject: `Research Portal email test ${stamp}`,
  heading: "Email delivery works",
  paragraphs: ["This is a delivery test from the Research Publication Portal.", `Sent ${stamp} via ${cfg.provider}.`],
  footerNote: "Sent by an administrator's email:check command. No action needed.",
});
const r = await send({ to, ...mail, purpose: "email_test", key: `email-test/${stamp}` });
for (const l of lines) console.log(`  ${l}`);
if (!r.ok) {
  console.log(`\n✗ Not delivered to ${maskEmail(to)}: ${r.code}`);
  if (r.code === "config" && cfg.provider === "sendgrid") {
    console.log("  Check that SENDGRID_API_KEY is valid (Mail Send permission) and that EMAIL_FROM is a verified sender or on an authenticated domain in SendGrid.");
  }
  console.log("");
  process.exit(1);
}
console.log(`\n✓ Accepted by ${cfg.provider} for ${maskEmail(to)} (message id ${r.id}).`);
console.log("  Accepted is not the same as delivered: check that inbox (and spam) for the subject above.\n");
