/**
 * Read the project's Auth config via the Management API (read-only), to see the
 * current email-confirmation + SMTP state and whether this token has the scope.
 * Secrets (e.g. smtp_pass) are NEVER printed — only booleans/host/port/user.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN.
 * Run: npm run supabase:auth-config
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !token) {
  console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN.\n");
  process.exit(1);
}
const ref = new URL(url).host.split(".")[0];

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`\nGET /config/auth → HTTP ${r.status}`);
if (!r.ok) {
  const body = await r.text();
  console.log("  token cannot read auth config:", body.slice(0, 200));
  console.log("  → configuring SMTP via API needs a token with Auth config scope.\n");
  process.exit(0);
}
const c = await r.json();
const show = (k) => console.log("  " + k.padEnd(28), c[k]);
console.log("\nEmail confirmation:");
show("mailer_autoconfirm"); // false = confirmation REQUIRED (what we want)
console.log("\nCurrent SMTP:");
show("smtp_host");
show("smtp_port");
show("smtp_user");
show("smtp_admin_email");
console.log("  smtp_pass set:".padEnd(30), !!c.smtp_pass);
show("smtp_sender_name");
console.log("\nURL configuration (for email/auth redirects):");
show("site_url");
console.log("  uri_allow_list".padEnd(30), c.uri_allow_list || "(empty)");
console.log("");
