/**
 * Configure Supabase Custom SMTP (Gmail) via the Management API.
 *
 * Reads the sender address and app password from the environment and PATCHes the
 * project's auth config. It NEVER prints any credential — only non-secret host/
 * port/sender-name and booleans. Email confirmation is explicitly kept ENABLED
 * (mailer_autoconfirm = false).
 *
 * Requires a PAT with Auth config Read+Write scope, plus:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_ACCESS_TOKEN, EMAIL_ID, EMAIL_APP_PASSWORD
 *
 * Run: npm run supabase:configure-smtp
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const senderEmail = process.env.EMAIL_ID;
const appPassword = (process.env.EMAIL_APP_PASSWORD || "").replace(/\s+/g, ""); // Gmail shows the app pw with spaces

for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_ACCESS_TOKEN: token, EMAIL_ID: senderEmail, EMAIL_APP_PASSWORD: appPassword })) {
  if (!v) {
    console.error(`\n✖ Missing required environment variable ${k}.\n`);
    process.exit(1);
  }
}

const ref = new URL(url).host.split(".")[0];
const SENDER_NAME = process.env.SMTP_SENDER_NAME || "ATLAS Research Publication Portal";
const PORT = process.env.SMTP_PORT || "465"; // Gmail SSL; use "587" for STARTTLS

const body = {
  external_email_enabled: true,
  mailer_autoconfirm: false, // keep email confirmation REQUIRED
  smtp_admin_email: senderEmail,
  smtp_host: "smtp.gmail.com",
  smtp_port: String(PORT),
  smtp_user: senderEmail,
  smtp_pass: appPassword,
  smtp_sender_name: SENDER_NAME,
  smtp_max_frequency: 60,
};

async function main() {
  console.log(`\nConfiguring Custom SMTP on project ${ref} …`);
  console.log(`  host=smtp.gmail.com  port=${PORT}  sender_name="${SENDER_NAME}"  confirmation=ENABLED`);
  console.log("  (sender address + app password read from env, not shown)\n");

  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch {}
    if (/auth_config_write|permission/i.test(text)) {
      console.error(`✖ HTTP ${r.status}: ${msg}`);
      console.error("  → The PAT is missing the Auth config Read+Write scope. Add it and retry.\n");
    } else {
      console.error(`✖ HTTP ${r.status}: ${msg}\n`);
    }
    process.exit(1);
  }

  // Confirm (read back, mask secrets).
  const cfg = JSON.parse(text);
  console.log("✓ SMTP applied. Current state:");
  console.log("  smtp_host:        ", cfg.smtp_host);
  console.log("  smtp_port:        ", cfg.smtp_port);
  console.log("  smtp_sender_name: ", cfg.smtp_sender_name);
  console.log("  smtp_admin_email: ", cfg.smtp_admin_email ? "set" : "MISSING");
  console.log("  smtp_user:        ", cfg.smtp_user ? "set" : "MISSING");
  console.log("  smtp_pass:        ", cfg.smtp_pass ? "set" : "MISSING");
  console.log("  mailer_autoconfirm:", cfg.mailer_autoconfirm, "(false = confirmation required ✓)");
  console.log("");
}

main().catch((e) => {
  console.error("\n✖ SMTP configuration failed:", e?.message || e);
  process.exit(1);
});
