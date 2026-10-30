/**
 * Email delivery + confirmation-link test (requires Custom SMTP to be set).
 *
 *  A) Delivery: perform a real signUp (same call the /api/register route makes).
 *     With confirmation enabled, Supabase sends a confirmation email through the
 *     configured SMTP. A clean success means GoTrue handed the message to Gmail
 *     without an SMTP error (a bad SMTP setup makes signUp fail instead).
 *     The address used is a "+alias" of the configured sender, so it is
 *     deliverable to a real mailbox you control — check it to confirm receipt.
 *
 *  B) Link works: admin.generateLink({type:'signup'}) returns the real
 *     confirmation URL WITHOUT sending email; visiting it must flip the user's
 *     email_confirmed_at to set — proving the confirmation link mechanism works.
 *
 * Throwaway users are deleted at the end. No secrets are printed.
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY, EMAIL_ID. Run: npm run supabase:test-email
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const sender = process.env.EMAIL_ID;
if (!url || !anonKey || !secret) {
  console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY.\n");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = () => createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const pw = () => crypto.randomBytes(16).toString("base64url");
const tag = crypto.randomBytes(4).toString("hex");

// Deliverable +alias of the configured sender (falls back to a domain address).
function aliasEmail() {
  if (sender && sender.includes("@")) {
    const [local, domain] = sender.split("@");
    return { addr: `${local}+rpptest${tag}@${domain}`, masked: `${local}+rpptest${tag}@${domain}`.replace(/(.{3}).*(@.*)/, "$1***$2") };
  }
  const addr = `rpp.test.deliver.${tag}@atlasuniversity.edu.in`;
  return { addr, masked: addr };
}

let failures = 0;
const cleanup = [];
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };

async function findByEmail(email) {
  for (let page = 1; page <= 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase());
    if (u || data.users.length < 200) return u || null;
  }
  return null;
}

async function main() {
  console.log(`\n=== Email delivery + confirmation-link test on ${new URL(url).host} ===\n`);

  // ---- A) Delivery via real signUp --------------------------------------
  console.log("A) Delivery (real confirmation email via Gmail SMTP):");
  const { addr, masked } = aliasEmail();
  {
    const { data, error } = await anon().auth.signUp({
      email: addr, password: pw(),
      options: { data: { name: "Delivery Test", base_type: "STUDENT" } },
    });
    if (error) {
      check("signUp accepted + email sent", false, error.message);
    } else {
      check("signUp accepted (no SMTP error ⇒ Gmail took the message)", true, `to ${masked}`);
      check("no session yet (confirmation required)", !data.session);
      const u = await findByEmail(addr);
      if (u) cleanup.push(u.id);
      check("user created, awaiting confirmation", !!u && !u.email_confirmed_at);
    }
  }

  // ---- B) Confirmation link actually confirms ---------------------------
  console.log("\nB) Confirmation link activates the account:");
  const linkEmail = `rpp.test.link.${tag}@atlasuniversity.edu.in`;
  {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "signup", email: linkEmail, password: pw(),
      options: { data: { name: "Link Test", base_type: "STUDENT" } },
    });
    if (error || !data?.properties?.action_link) {
      check("generate confirmation link", false, error?.message || "no action_link");
    } else {
      if (data.user?.id) cleanup.push(data.user.id);
      check("generate confirmation link", true);
      const before = await findByEmail(linkEmail);
      check("user starts unconfirmed", before && !before.email_confirmed_at);

      const r = await fetch(data.properties.action_link, { redirect: "manual" });
      check("visiting link processed by Supabase verify", r.status >= 200 && r.status < 400, `HTTP ${r.status}`);

      const after = await findByEmail(linkEmail);
      check("email_confirmed_at is now SET (link works)", !!after?.email_confirmed_at);
    }
  }

  console.log("");
}

main().finally(async () => {
  for (const id of cleanup) { try { await admin.auth.admin.deleteUser(id); } catch {} }
  console.log(`Cleanup: removed ${cleanup.length} test user(s).`);
  console.log(`${failures === 0 ? "✓ PASS — email send accepted and confirmation link verified." : `✗ ${failures} check(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
});
