// Runs once when the Next.js server starts. Validates the email configuration
// and logs one secret-free status line ("email: configured" / "email: not
// configured" + reason), so a missing SENDGRID_API_KEY or EMAIL_FROM shows up in
// the pm2 log at startup instead of at the first failed email. Never blocks or
// crashes startup. (The Node-only import sits inside the NEXT_RUNTIME check so
// the edge build drops it.)
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { checkEmailConfig } = await import("./lib/email/send.js");
      checkEmailConfig();
    } catch {
      console.error("email: startup configuration check could not run");
    }
  }
}
