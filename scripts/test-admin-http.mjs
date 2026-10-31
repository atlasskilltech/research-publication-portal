/**
 * Integration test of the multi-role admin API against the running app, using
 * REAL admin session cookies. Creates its OWN throwaway users, exercises the
 * role matrix + guards + concurrency, and deletes them. It never demotes/deletes
 * the real/protected admins (only asserts those are refused).
 *
 * Prereq: app running; NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY in env. Run: node scripts/test-admin-http.mjs [baseUrl]
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = process.argv[2] || "http://127.0.0.1:5630";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) { console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY."); process.exit(1); }

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
const tag = crypto.randomBytes(4).toString("hex");
const pw = () => crypto.randomBytes(18).toString("base64url");

let failures = 0;
const cleanup = [];
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };

async function makeUser(kind, { isAdmin = false, baseType = "STUDENT" } = {}) {
  const email = `rpp.adm.${kind}.${tag}.${crypto.randomBytes(2).toString("hex")}@atlasuniversity.edu.in`;
  const password = pw();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: `Adm ${kind}`, base_type: baseType } });
  if (error) throw new Error(`createUser(${kind}): ${error.message}`);
  cleanup.push(data.user.id);
  if (isAdmin) { await admin.from("profiles").update({ is_admin: true }).eq("id", data.user.id); await admin.from("user_roles").upsert({ user_id: data.user.id, role: "ADMINISTRATOR" }); }
  return { id: data.user.id, email, password };
}
async function state(id) {
  const { data: p } = await admin.from("profiles").select("is_admin, base_type").eq("id", id).maybeSingle();
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", id);
  return { is_admin: p?.is_admin, base_type: p?.base_type, roles: (r || []).map((x) => x.role).sort() };
}
const consistent = (s) => s.is_admin === s.roles.includes("ADMINISTRATOR");
async function findAuth(email) {
  for (let p = 1; p <= 50; p++) { const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 }); const u = data.users.find((x) => (x.email || "").toLowerCase() === email.toLowerCase()); if (u) return u; if (data.users.length < 200) break; }
  return null;
}

function jarFrom(res, jar = {}) { (res.headers.getSetCookie?.() || []).forEach((sc) => { const p = sc.split(";")[0]; const i = p.indexOf("="); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1); }); return jar; }
const cookie = (j) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join("; ");
async function login(email, password) { const res = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); if (!res.ok) throw new Error(`login ${email}: HTTP ${res.status}`); return jarFrom(res); }
async function api(method, path, jar, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(jar ? { Cookie: cookie(jar) } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (jar) jarFrom(res, jar);
  let json = {}; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const setRoles = (jar, id, roles) => api("PATCH", `/api/admin/users/${id}`, jar, { roles });
const setType = (jar, id, baseType) => api("PATCH", `/api/admin/users/${id}`, jar, { baseType });

async function main() {
  console.log(`\n=== Multi-role admin API tests (app ${BASE}) ===\n`);
  const A = await makeUser("admin", { isAdmin: true });
  const B = await makeUser("target");                      // STUDENT
  const C = await makeUser("promote");
  const D = await makeUser("nonadmin");
  const F = await makeUser("faculty", { baseType: "FACULTY" });
  const eliz = await findAuth("elizabeth.jerome@atlasuniversity.edu.in");
  const jarA = await login(A.email, A.password);

  console.log("Authorization:");
  check("admin GET → 200", (await api("GET", "/api/admin/users", jarA)).status === 200);
  { const jarD = await login(D.email, D.password);
    check("non-admin GET → 403", (await api("GET", "/api/admin/users", jarD)).status === 403);
    check("non-admin PATCH roles → 403", (await setRoles(jarD, B.id, ["SPOC"])).status === 403); }
  check("unauthenticated GET → 401", (await api("GET", "/api/admin/users", null)).status === 401);

  console.log("\nMultiple roles + independent add/remove:");
  { const r = await setRoles(jarA, B.id, ["SPOC", "EDITOR"]);
    check("assign SPOC+EDITOR → 200", r.status === 200 && sameArr(r.json.roles, ["EDITOR", "SPOC"]), JSON.stringify(r.json.roles));
    check("DB has SPOC+EDITOR, not admin", await okState(B.id, { roles: ["EDITOR", "SPOC"], is_admin: false })); }
  { const r = await setRoles(jarA, B.id, ["SPOC"]);
    check("remove EDITOR, keep SPOC → 200", r.status === 200 && sameArr(r.json.roles, ["SPOC"]), JSON.stringify(r.json.roles)); }

  console.log("\nBase type is IMMUTABLE:");
  { const r = await setType(jarA, B.id, "FACULTY");
    check("PATCH changing baseType → 422 (rejected)", r.status === 422, `status ${r.status}`);
    check("base_type unchanged (still STUDENT)", (await state(B.id)).base_type === "STUDENT"); }
  { // assign ALL FIVE additional roles to a STUDENT → base_type must stay STUDENT
    const all = ["ADMINISTRATOR", "SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"];
    const r = await setRoles(jarA, B.id, all);
    check("assign all 5 roles to a Student → 200", r.status === 200 && sameArr(r.json.roles, all));
    check("Student remains STUDENT after all 5 roles", (await state(B.id)).base_type === "STUDENT");
    const r2 = await setRoles(jarA, B.id, ["SPOC"]); // remove roles (also revokes admin)
    check("removing roles never changes base_type (still STUDENT)", r2.status === 200 && (await state(B.id)).base_type === "STUDENT"); }
  { // a FACULTY member keeps FACULTY through multiple role changes
    const r = await setRoles(jarA, F.id, ["SPOC", "EDITOR", "PEER_REVIEWER"]);
    check("assign multiple roles to Faculty → 200", r.status === 200 && sameArr(r.json.roles, ["EDITOR", "PEER_REVIEWER", "SPOC"]));
    check("Faculty remains FACULTY after multiple roles", (await state(F.id)).base_type === "FACULTY"); }

  console.log("\nAdministrator promote/revoke (atomic is_admin sync):");
  { const r = await setRoles(jarA, C.id, ["ADMINISTRATOR"]);
    check("promote C via ADMINISTRATOR role → 200, isAdmin true", r.status === 200 && r.json.isAdmin === true);
    const s = await state(C.id); check("DB consistent: is_admin ⟺ ADMINISTRATOR row", consistent(s) && s.is_admin === true);
    const jarC = await login(C.email, C.password);
    check("newly-promoted admin C can access admin API", (await api("GET", "/api/admin/users", jarC)).status === 200);
    check("C (admin) demoting protected admin → 403", eliz ? (await setRoles(jarC, eliz.id, [])).status === 403 : false); }
  { const r = await setRoles(jarA, C.id, ["EDITOR"]); // drop ADMINISTRATOR, add EDITOR
    check("revoke admin (roles=[EDITOR]) → 200, isAdmin false", r.status === 200 && r.json.isAdmin === false && sameArr(r.json.roles, ["EDITOR"]));
    check("DB consistent after revoke", consistent(await state(C.id))); }

  console.log("\nGuards:");
  check("self role change (A edits A) → 403", (await setRoles(jarA, A.id, ["SPOC"])).status === 403);
  check("A still admin + consistent", (await state(A.id)).is_admin === true && consistent(await state(A.id)));
  if (eliz) {
    const before = await state(eliz.id);
    check("demote protected admin (roles=[]) → 403", (await setRoles(jarA, eliz.id, [])).status === 403);
    check("delete protected admin → 403", (await api("DELETE", `/api/admin/users/${eliz.id}`, jarA)).status === 403);
    const after = await state(eliz.id);
    check("protected admin unchanged", after.is_admin === true && sameArr(after.roles, before.roles));
  }
  check("invalid role → 422", (await setRoles(jarA, B.id, ["WIZARD"])).status === 422);

  console.log("\nConcurrency (atomic sync holds):");
  { // Fire promote and revoke on C simultaneously; whichever wins, is_admin ⟺ ADMINISTRATOR must hold.
    await Promise.all([setRoles(jarA, C.id, ["ADMINISTRATOR"]), setRoles(jarA, C.id, [])]);
    const s = await state(C.id);
    check("after concurrent promote+revoke, state is consistent (no drift)", consistent(s), JSON.stringify(s)); }

  console.log("\nDeletion + cascade:");
  { const r = await api("DELETE", `/api/admin/users/${B.id}`, jarA);
    check("delete B → 200", r.status === 200 && r.json.ok === true);
    check("B profile gone", (await admin.from("profiles").select("id").eq("id", B.id).maybeSingle()).data == null);
    check("B roles gone (cascade, no orphan)", (await admin.from("user_roles").select("role").eq("user_id", B.id)).data.length === 0);
    check("B can no longer log in", (await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: B.email, password: B.password }) })).status === 401);
    const i = cleanup.indexOf(B.id); if (i >= 0) cleanup.splice(i, 1); }

  console.log("");
}

const sameArr = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort().join() === [...b].sort().join();
async function okState(id, expect) {
  const s = await state(id);
  if (expect.roles && !sameArr(s.roles, expect.roles)) return false;
  if (expect.is_admin !== undefined && s.is_admin !== expect.is_admin) return false;
  if (expect.base_type && s.base_type !== expect.base_type) return false;
  return consistent(s);
}

main()
  .catch((e) => { console.error("✖ Test error:", e?.message || e); failures++; })
  .finally(async () => {
    for (const id of cleanup) { try { await admin.auth.admin.deleteUser(id); } catch {} }
    console.log(`Cleanup: removed ${cleanup.length} throwaway user(s).`);
    console.log(`\n${failures === 0 ? "✓ PASS — multi-role admin management verified." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
