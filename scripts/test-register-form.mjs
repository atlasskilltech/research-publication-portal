/**
 * Exercises the REAL registration form path against the running app, proving the
 * student Application-Number verification now works end-to-end and that invalid
 * numbers are still rejected. Self-cleaning: any account it creates is deleted.
 *
 * Checks:
 *   /api/student-check 2629885  → 200 ok           (valid, through the app)
 *   /api/student-check 0000000  → 422              (invalid rejected)
 *   /api/register STUDENT 2629885 → 201            (full form submit succeeds)
 *       → profile has application_no, is_admin=false; then the user is DELETED
 *   /api/register STUDENT 0000000 → 422, no account created (invalid rejected)
 *
 * Prereq: app running with the corrected STUDENT_CHECK_API_KEY.
 * Run: node scripts/test-register-form.mjs [baseUrl]
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const base = process.argv[2] || "http://127.0.0.1:5630";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const sender = process.env.EMAIL_ID;
if (!url || !secret) { console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY."); process.exit(1); }

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const tag = crypto.randomBytes(4).toString("hex");
const alias = (n) => {
  if (sender && sender.includes("@")) { const [l, d] = sender.split("@"); return `${l}+rppform${n}${tag}@${d}`; }
  return `rpp.form.${n}.${tag}@atlasuniversity.edu.in`;
};

let failures = 0;
const cleanup = [];
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };

async function post(path, body) {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let json = {}; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
async function findByEmail(email) {
  for (let p = 1; p <= 50; p++) {
    const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase());
    if (u) return u; if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  console.log(`\n=== Registration form path tests (app ${base}) ===\n`);

  console.log("Verification pre-check (/api/student-check):");
  { const r = await post("/api/student-check", { applicationNo: "2629885" });
    check("valid 2629885 → 200 ok", r.status === 200 && r.json.ok === true, `status ${r.status}`); }
  { const r = await post("/api/student-check", { applicationNo: "0000000" });
    check("invalid 0000000 → 422 not found", r.status === 422, `status ${r.status}`); }

  console.log("\nFull registration submit (/api/register):");
  const goodEmail = alias("ok");
  { const r = await post("/api/register", { name: "Form Test", email: goodEmail, baseType: "STUDENT", school: "ISDI", applicationNo: "2629885" });
    check("valid student 2629885 → 201 created", r.status === 201 && r.json.ok === true, `status ${r.status} ${r.json.error || ""}`);
    const u = await findByEmail(goodEmail);
    if (u) cleanup.push(u.id);
    const { data: prof } = u ? await admin.from("profiles").select("application_no, is_admin, base_type").eq("id", u.id).maybeSingle() : { data: null };
    check("account created, unconfirmed (awaiting email verify)", !!u && !u.email_confirmed_at);
    check("profile.application_no = 2629885", prof?.application_no === "2629885", String(prof?.application_no));
    check("is_admin forced false", prof?.is_admin === false);
    check("base_type STUDENT", prof?.base_type === "STUDENT");
  }
  const badEmail = alias("bad");
  { const r = await post("/api/register", { name: "Bad App", email: badEmail, baseType: "STUDENT", school: "ISDI", applicationNo: "0000000" });
    check("invalid application number → 422 (registration refused)", r.status === 422, `status ${r.status}`);
    const u = await findByEmail(badEmail);
    if (u) cleanup.push(u.id);
    check("no account created for the invalid attempt", !u);
  }

  console.log("");
}

main()
  .catch((e) => { console.error("✖ Test error:", e?.message || e); failures++; })
  .finally(async () => {
    for (const id of cleanup) { try { await admin.auth.admin.deleteUser(id); } catch {} }
    console.log(`Cleanup: removed ${cleanup.length} test user(s) (frees application number 2629885).`);
    console.log(`\n${failures === 0 ? "✓ PASS — registration form verification works; invalid rejected." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
