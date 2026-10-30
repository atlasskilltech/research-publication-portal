/**
 * Integration test of the admin user-management API against the running app,
 * using REAL admin session cookies. Creates its OWN throwaway users (a test
 * admin + targets), exercises promote/revoke/delete and every guard, and deletes
 * them. It NEVER demotes or deletes the real/protected admins (it only asserts
 * those actions are REFUSED, then confirms the protected admin is unchanged).
 *
 * Prereq: app running; NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY in env. Run: node scripts/test-admin-http.mjs [baseUrl]
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] || "http://127.0.0.1:3001";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) { console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY."); process.exit(1); }

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const tag = crypto.randomBytes(4).toString("hex");
const pw = () => crypto.randomBytes(18).toString("base64url");

let failures = 0;
const cleanup = [];
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };

async function makeUser(kind, { isAdmin = false } = {}) {
  const email = `rpp.adm.${kind}.${tag}.${crypto.randomBytes(2).toString("hex")}@atlasuniversity.edu.in`;
  const password = pw();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: `Adm ${kind}`, base_type: "STUDENT" } });
  if (error) throw new Error(`createUser(${kind}): ${error.message}`);
  cleanup.push(data.user.id);
  if (isAdmin) await admin.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
  return { id: data.user.id, email, password };
}
const profileOf = async (id) => (await admin.from("profiles").select("is_admin, base_type").eq("id", id).maybeSingle()).data;
async function findAuth(email) {
  for (let p = 1; p <= 50; p++) { const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 }); const u = data.users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase()); if (u) return u; if (data.users.length < 200) break; }
  return null;
}

function jarFrom(res, jar = {}) {
  const list = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const sc of list) { const pair = sc.split(";")[0]; const i = pair.indexOf("="); if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1); }
  return jar;
}
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

async function login(email, password) {
  const res = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`login failed for ${email}: HTTP ${res.status}`);
  return jarFrom(res);
}
async function api(method, path, jar, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(jar ? { Cookie: cookieHeader(jar) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (jar) jarFrom(res, jar); // absorb refreshed cookies
  let json = {}; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  console.log(`\n=== Admin management HTTP tests (app ${BASE}) ===\n`);

  const A = await makeUser("admin", { isAdmin: true }); // throwaway admin (actor)
  const B = await makeUser("target");                   // normal user (base-type + delete)
  const C = await makeUser("promote");                  // to promote → revoke
  const D = await makeUser("nonadmin");                 // normal user (authorization test)
  const eliz = await findAuth("elizabeth.jerome@atlasuniversity.edu.in"); // protected admin (never modified)

  const jarA = await login(A.email, A.password);

  console.log("Authorization:");
  { const r = await api("GET", "/api/admin/users", jarA); check("admin GET /api/admin/users → 200", r.status === 200 && Array.isArray(r.json.users), `status ${r.status}`); }
  { const jarD = await login(D.email, D.password); const r = await api("GET", "/api/admin/users", jarD); check("non-admin GET → 403", r.status === 403, `status ${r.status}`);
    const r2 = await api("PATCH", `/api/admin/users/${B.id}`, jarD, { isAdmin: true }); check("non-admin PATCH → 403", r2.status === 403, `status ${r2.status}`);
    const r3 = await api("DELETE", `/api/admin/users/${B.id}`, jarD); check("non-admin DELETE → 403", r3.status === 403, `status ${r3.status}`); }
  { const r = await api("GET", "/api/admin/users", null); check("unauthenticated GET → 401", r.status === 401, `status ${r.status}`); }

  console.log("\nBase type:");
  { const r = await api("PATCH", `/api/admin/users/${B.id}`, jarA, { baseType: "FACULTY" }); check("change B → FACULTY → 200", r.status === 200 && r.json.baseType === "FACULTY");
    check("DB reflects FACULTY", (await profileOf(B.id))?.base_type === "FACULTY"); }

  console.log("\nPromote / revoke admin:");
  { const r = await api("PATCH", `/api/admin/users/${C.id}`, jarA, { isAdmin: true }); check("promote C → 200", r.status === 200 && r.json.isAdmin === true);
    check("DB: C is_admin true", (await profileOf(C.id))?.is_admin === true);
    const jarC = await login(C.email, C.password); const r2 = await api("GET", "/api/admin/users", jarC); check("newly-promoted admin C can access admin API", r2.status === 200, `status ${r2.status}`);
    // C (admin) must NOT be able to demote a protected admin.
    if (eliz) { const r3 = await api("PATCH", `/api/admin/users/${eliz.id}`, jarC, { isAdmin: false }); check("C demoting protected admin → 403", r3.status === 403, `status ${r3.status}`); } }
  { const r = await api("PATCH", `/api/admin/users/${C.id}`, jarA, { isAdmin: false }); check("revoke C → 200", r.status === 200 && r.json.isAdmin === false);
    check("DB: C is_admin false", (await profileOf(C.id))?.is_admin === false); }

  console.log("\nSelf-action guards:");
  { const r = await api("PATCH", `/api/admin/users/${A.id}`, jarA, { isAdmin: false }); check("A demoting SELF → 403", r.status === 403, `status ${r.status}`);
    check("A still admin", (await profileOf(A.id))?.is_admin === true);
    const r2 = await api("DELETE", `/api/admin/users/${A.id}`, jarA); check("A deleting SELF → 403", r2.status === 403, `status ${r2.status}`); }

  console.log("\nProtected original admin:");
  if (eliz) { const r = await api("PATCH", `/api/admin/users/${eliz.id}`, jarA, { isAdmin: false }); check("demote protected admin → 403", r.status === 403, `status ${r.status}`);
    const r2 = await api("DELETE", `/api/admin/users/${eliz.id}`, jarA); check("delete protected admin → 403", r2.status === 403, `status ${r2.status}`);
    check("protected admin still admin + present", (await profileOf(eliz.id))?.is_admin === true); }
  else check("protected admin lookup", false, "elizabeth not found");

  console.log("\nPermanent deletion:");
  { const r = await api("DELETE", `/api/admin/users/${B.id}`, jarA); check("delete normal user B → 200", r.status === 200 && r.json.ok === true, `status ${r.status}`);
    check("B profile gone (no orphan)", (await profileOf(B.id)) == null);
    check("B auth user gone", (await findAuth(B.email)) == null);
    const relog = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: B.email, password: B.password }) });
    check("deleted user B can no longer log in", relog.status === 401, `status ${relog.status}`);
    const idx = cleanup.indexOf(B.id); if (idx >= 0) cleanup.splice(idx, 1); }

  console.log("");
}

main()
  .catch((e) => { console.error("✖ Test error:", e?.message || e); failures++; })
  .finally(async () => {
    for (const id of cleanup) { try { await admin.auth.admin.deleteUser(id); } catch {} }
    console.log(`Cleanup: removed ${cleanup.length} throwaway user(s).`);
    console.log(`\n${failures === 0 ? "✓ PASS — admin management + guards verified." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
