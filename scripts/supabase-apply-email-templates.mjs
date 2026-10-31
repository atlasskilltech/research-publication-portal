/**
 * Push the portal's auth email templates (supabase/templates/*.html) and add the
 * app's /auth/confirm URLs to the redirect allow-list, via the Supabase
 * Management API.
 *
 *   DEFAULT = DRY RUN: prints what WOULD change (no network call at all).
 *   --apply           : actually PATCHes /v1/projects/<ref>/config/auth.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN (for --apply).
 * Never prints tokens or secrets.
 *
 *   node --env-file-if-exists=.env.local scripts/supabase-apply-email-templates.mjs
 *   node --env-file-if-exists=.env.local scripts/supabase-apply-email-templates.mjs --apply
 */
import { readFileSync } from "node:fs";

const apply = process.argv.includes("--apply");
const read = (f) => readFileSync(new URL(`../supabase/templates/${f}`, import.meta.url), "utf8");
const REDIRECTS = ["https://research.atlasskilltech.app/auth/confirm", "http://localhost:3000/auth/confirm", "http://localhost:3001/auth/confirm", "http://localhost:5630/auth/confirm"];

const patch = {
  mailer_subjects_invite: "Complete Your Research Portal Registration",
  mailer_templates_invite_content: read("invite.html"),
  mailer_subjects_recovery: "Set Your Research Portal Password",
  mailer_templates_recovery_content: read("recovery.html"),
};

for (const [k, v] of Object.entries(patch)) {
  if (k.endsWith("_content") && !/\{\{ \.TokenHash \}\}/.test(v)) { console.error(`✖ ${k} has no {{ .TokenHash }}`); process.exit(1); }
  if (k.endsWith("_content") && /ConfirmationURL/.test(v)) { console.error(`✖ ${k} still uses {{ .ConfirmationURL }}`); process.exit(1); }
}

console.log(`\nAuth email templates — ${apply ? "APPLY" : "DRY RUN (no changes)"}\n`);
for (const [k, v] of Object.entries(patch)) console.log(`  ${k.padEnd(36)} ${k.endsWith("_content") ? `${v.length} chars` : JSON.stringify(v)}`);
console.log(`  uri_allow_list (ensure present)      ${REDIRECTS.join(", ")}`);

if (!apply) {
  console.log("\nNothing was changed. Re-run with --apply to update the project.\n");
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !token) { console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN.\n"); process.exit(1); }
const ref = new URL(url).host.split(".")[0];
const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const cur = await fetch(api, { headers });
if (!cur.ok) { console.error(`\n✖ GET config/auth → HTTP ${cur.status}\n`); process.exit(1); }
const conf = await cur.json();
const allow = new Set(String(conf.uri_allow_list || "").split(",").map((s) => s.trim()).filter(Boolean));
REDIRECTS.forEach((r) => allow.add(r));

const res = await fetch(api, { method: "PATCH", headers, body: JSON.stringify({ ...patch, uri_allow_list: [...allow].join(",") }) });
console.log(`\nPATCH config/auth → HTTP ${res.status}`);
if (!res.ok) { console.error((await res.text()).slice(0, 300)); process.exit(1); }
console.log("✓ Templates and redirect allow-list updated. Site URL left unchanged.\n");
