/**
 * Email-restriction policy test — ZERO side effects (no account created, no
 * email sent). It submits STUDENT registrations with a deliberately invalid
 * application number, so the request is rejected BEFORE any invite. By checking
 * WHICH field the 422 cites we learn whether the email itself was accepted:
 *   - email rejected  → issues.email present
 *   - email accepted  → issues.applicationNo present, issues.email absent
 *
 * Proves: sf48116@gmail.com is accepted; an unrelated Gmail is rejected; the
 * university domain still works.
 *
 * Run: node scripts/test-email-policy.mjs [baseUrl]   (SUPABASE_SECRET_KEY optional,
 * used only to double-check that no account was created.)
 */
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] || "http://127.0.0.1:3001";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const admin = url && secret ? createClient(url, secret, { auth: { persistSession: false } }) : null;

let failures = 0;
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };

async function register(email) {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Policy Test", email, baseType: "STUDENT", school: "ISDI", applicationNo: "0000000" }),
  });
  let json = {}; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
async function noUser(email) {
  if (!admin) return true;
  for (let p = 1; p <= 50; p++) { const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 }); if (data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase())) return false; if (data.users.length < 200) break; }
  return true;
}

async function main() {
  console.log(`\n=== Email-restriction policy tests (app ${BASE}) ===\n`);

  { const email = "someone.random.999@gmail.com"; const r = await register(email);
    check("unrelated Gmail rejected by email policy", r.status === 422 && !!r.json.issues?.email, `status ${r.status}, issue=${r.json.issues?.email ? "email" : Object.keys(r.json.issues || {}).join(",")}`);
    check("  → no account created", await noUser(email)); }

  { const email = "sf48116@gmail.com"; const r = await register(email);
    check("sf48116@gmail.com ACCEPTED by email policy (fails only on app no.)", r.status === 422 && !!r.json.issues?.applicationNo && !r.json.issues?.email, `status ${r.status}, issue=${Object.keys(r.json.issues || {}).join(",") || "none"}`);
    check("  → no account created (invalid app no.)", await noUser(email)); }

  { const email = `policy.uni.test.${Date.now()}@atlasuniversity.edu.in`; const r = await register(email);
    check("university email accepted by policy (fails only on app no.)", r.status === 422 && !!r.json.issues?.applicationNo && !r.json.issues?.email, `status ${r.status}, issue=${Object.keys(r.json.issues || {}).join(",") || "none"}`);
    check("  → no account created", await noUser(email)); }

  console.log(`\n${failures === 0 ? "✓ PASS — email allowlist behaves exactly as specified." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("✖ Test error:", e?.message || e); process.exit(1); });
