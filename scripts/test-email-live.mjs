/**
 * REAL email delivery test through the portal's SMTP mailbox (EMAIL_ID +
 * EMAIL_APP_PASSWORD), using the same core + SMTP adapter + template the app
 * uses. Sends ONE message to the sender's own mailbox (plus-addressed, so it
 * can't reach anyone else). Prints no credentials.
 *
 * Run: node --env-file=.env.local scripts/test-email-live.mjs
 *      (optional: SMTP_HOST / SMTP_PORT / EMAIL_FROM_NAME overrides)
 */
import nodemailer from "nodemailer";
import { createEmailSender, maskEmail } from "../lib/email/core.js";
import { createSmtpClient } from "../lib/email/smtp.js";
import { editorialNotificationEmail } from "../lib/email/templates.js";

const user = (process.env.EMAIL_ID || "").trim();
const pass = (process.env.EMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
if (!user || !pass) {
  console.error("\n✖ EMAIL_ID and EMAIL_APP_PASSWORD must be set (in .env.local).\n");
  process.exit(1);
}
const host = process.env.SMTP_HOST || "smtp.gmail.com";
const port = Number(process.env.SMTP_PORT || 465);
const [local, domain] = user.split("@");
const to = `${local}+rpp-email-test@${domain}`;

const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 15000 });
try {
  await transport.verify();
  console.log(`\n  ✓ SMTP login OK (${host}:${port} as ${maskEmail(user)})`);
} catch (e) {
  console.error(`\n  ✗ SMTP login failed (${host}:${port}): ${e?.code || "error"} ${e?.responseCode || ""}`);
  process.exit(1);
}

const send = createEmailSender({
  client: createSmtpClient(transport),
  config: { apiKey: pass, credentialName: "EMAIL_APP_PASSWORD", from: user, fromName: process.env.EMAIL_FROM_NAME || "Research Publication Portal" },
  logger: { info: (m, meta) => console.log("   ", m, JSON.stringify(meta)), error: (m, meta) => console.log("   ", m, JSON.stringify(meta)) },
});
const site = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:5630").replace(/\/+$/, "");
const stamp = new Date().toISOString();
const mail = editorialNotificationEmail({
  siteUrl: site,
  subject: `Portal email test ${stamp}`,
  heading: "Email delivery works",
  paragraphs: ["This is an automated delivery test from the Research Publication Portal.", `Sent ${stamp}.`],
  footerNote: "Sent to the portal's own mailbox. No action needed.",
});
const r = await send({ to, ...mail, purpose: "email_test", key: `email-test/${stamp}` });
if (!r.ok) { console.error(`  ✗ delivery failed: ${r.code}\n`); process.exit(1); }
console.log(`  ✓ accepted by SMTP server for ${maskEmail(to)} (message id ${r.id})`);
console.log("\n✓ PASS — check that mailbox's inbox for the subject above.\n");
