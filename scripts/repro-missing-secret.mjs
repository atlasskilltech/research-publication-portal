/**
 * Proves the production symptom: when the SERVER has no SUPABASE_SECRET_KEY,
 * GET /api/admin/users (as a signed-in admin) returns exactly
 *   500 { "error": "Could not load users." }
 * — the "Could not load users." banner seen on production.
 *
 * This script's OWN env has the secret (used only to create/clean a throwaway
 * admin). The SERVER under test must be started WITHOUT the secret. No secret is
 * printed. Run: node scripts/repro-missing-secret.mjs <baseUrl>
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!BASE || !url || !secret) { console.error("Need <baseUrl> arg + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY in THIS process."); process.exit(1); }

const admin = createClient(url, secret, { auth: { persistSession: false } });
const tag = crypto.randomBytes(3).toString("hex");
const email = `rpp.repro.${tag}@atlasuniversity.edu.in`;
const password = crypto.randomBytes(18).toString("base64url");
let id = null, failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };

const jarFrom = (res, jar = {}) => { (res.headers.getSetCookie?.() || []).forEach((sc) => { const p = sc.split(";")[0]; const i = p.indexOf("="); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1); }); return jar; };
const cookie = (j) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join("; ");

try {
  console.log(`\n=== Reproduce "Could not load users" with no server secret (${BASE}) ===\n`);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "Repro Admin", base_type: "FACULTY" } });
  if (error) throw error;
  id = data.user.id;
  await admin.from("profiles").update({ is_admin: true }).eq("id", id);

  const loginRes = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  check("throwaway admin can log in (publishable key path works without secret)", loginRes.ok, `HTTP ${loginRes.status}`);
  const jar = jarFrom(loginRes);

  const res = await fetch(`${BASE}/api/admin/users`, { headers: { Cookie: cookie(jar) } });
  let json = {}; try { json = await res.json(); } catch {}
  check("GET /api/admin/users → 500", res.status === 500, `HTTP ${res.status}`);
  check('error message is exactly "Could not load users."', json.error === "Could not load users.", json.error || "(none)");
} catch (e) {
  console.error("✖", e?.message || e); failures++;
} finally {
  if (id) { try { await admin.auth.admin.deleteUser(id); } catch {} }
  console.log(`\nCleanup: removed ${id ? 1 : 0} throwaway user.`);
  console.log(`${failures === 0 ? "✓ REPRODUCED — missing SUPABASE_SECRET_KEY causes the exact production error." : `✗ ${failures} check(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
