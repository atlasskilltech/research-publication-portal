/**
 * Read-only SMTP diagnosis for the Supabase project. Performs ONLY GET requests
 * against the Management API — it never modifies SMTP, credentials, or auth
 * config, and it NEVER prints a password (secrets are shown only as a boolean
 * "set: true/false"). A password-looking token in any log line is redacted
 * before printing as a defensive measure.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN (PAT). EMAIL_ID is
 * read only to compare it (as a boolean match) against the Supabase SMTP user.
 * Run: node scripts/diagnose-smtp.mjs
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !token) {
  console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ACCESS_TOKEN.\n");
  process.exit(1);
}
const ref = new URL(url).host.split(".")[0];
const api = (p) => `https://api.supabase.com/v1/projects/${ref}${p}`;
const H = { Authorization: `Bearer ${token}` };

// Defensive: never echo a 16-char Google app password even if it surfaced.
const redact = (s) =>
  String(s || "").replace(/\b[a-z]{4}\s?[a-z]{4}\s?[a-z]{4}\s?[a-z]{4}\b/gi, "«redacted»");

console.log(`\n=== SMTP diagnosis for project ${ref} (read-only) ===\n`);

// ---- 1 & 2 & 3: SMTP + URL config -----------------------------------------
let cfg = null;
{
  const r = await fetch(api("/config/auth"), { headers: H });
  console.log(`[1-3] GET /config/auth → HTTP ${r.status}`);
  if (r.ok) {
    cfg = await r.json();
    const show = (k) => console.log("      " + k.padEnd(22), cfg[k]);
    show("external_email_enabled");
    show("mailer_autoconfirm"); // false = confirmation required (correct)
    show("smtp_host");
    show("smtp_port");
    show("smtp_user");
    show("smtp_admin_email"); // the "sender"
    console.log("      smtp_pass set:".padEnd(28), !!cfg.smtp_pass);
    show("smtp_sender_name");
    show("smtp_max_frequency");
    show("site_url");
    console.log("      uri_allow_list".padEnd(28), cfg.uri_allow_list || "(empty)");
  } else {
    console.log("      token cannot read auth config:", (await r.text()).slice(0, 160));
  }
}

// ---- 3: app-side env sanity (no SMTP sending in the app) ------------------
console.log("\n[3] App configuration / env sanity:");
const emailId = (process.env.EMAIL_ID || "").trim().toLowerCase();
console.log("      EMAIL_ID present:".padEnd(28), !!emailId);
if (cfg?.smtp_user) {
  console.log("      EMAIL_ID == Supabase smtp_user:".padEnd(28), emailId === String(cfg.smtp_user).toLowerCase());
}
if (cfg?.smtp_user && cfg?.smtp_admin_email) {
  console.log("      smtp_user == sender:".padEnd(28), String(cfg.smtp_user).toLowerCase() === String(cfg.smtp_admin_email).toLowerCase());
}
console.log("      EMAIL_APP_PASSWORD present:".padEnd(28), !!(process.env.EMAIL_APP_PASSWORD || "").trim());
console.log("      (note: the app never performs SMTP; Supabase GoTrue sends mail — these app vars are tooling-only.)");

// ---- 4: Auth logs for the exact SMTP error --------------------------------
console.log("\n[4] Supabase Auth logs (looking for the exact SMTP error):");
{
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  const sql =
    "select timestamp, event_message from auth_logs order by timestamp desc limit 100";
  const qs = new URLSearchParams({
    sql,
    iso_timestamp_start: start.toISOString(),
    iso_timestamp_end: end.toISOString(),
  });
  const r = await fetch(api(`/analytics/endpoints/logs.all?${qs.toString()}`), { headers: H });
  console.log(`      GET /analytics/endpoints/logs.all → HTTP ${r.status}`);
  if (r.ok) {
    let data = null;
    try { data = await r.json(); } catch {}
    const rows = data?.result || data?.data || [];
    const hits = rows.filter((row) =>
      /smtp|535|mail|send|auth|credential|password not accepted/i.test(JSON.stringify(row)),
    );
    if (!rows.length) console.log("      (no auth log rows returned in the last 7 days)");
    else if (!hits.length) console.log(`      ${rows.length} rows, none SMTP-related in the window.`);
    else {
      console.log(`      ${hits.length} SMTP/mail-related line(s):`);
      hits.slice(0, 12).forEach((row) => console.log("        •", redact(row.event_message).slice(0, 240)));
    }
  } else {
    console.log("      cannot read logs with this token/endpoint:", redact((await r.text()).slice(0, 160)));
    console.log("      → Read these in Dashboard → Logs → Auth (filter the time of a failed send).");
  }
}

console.log("");
