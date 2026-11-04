/**
 * Multi-role admin API over HTTP (running app, MySQL): authorization, multiple
 * roles, immutable base type, atomic isAdmin ⟺ ADMINISTRATOR sync (incl. under
 * concurrency), self / protected-admin / invalid-role guards, EDITOR removal
 * dropping editor assignments, and deletion cascades.
 *
 * Throwaway rpp.it.* accounts only. The protected real admin is only ever the
 * target of a REFUSED demotion (checked byte-for-byte unchanged afterwards); no
 * real account is logged in as, deleted or modified.
 *
 * Run: node scripts/test-admin-http.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import { makeHarness } from "./lib/test-db.mjs";
import { uuid } from "../lib/auth/crypto.mjs";

const h = makeHarness(process.argv[2]);
const { check, db, T } = h;
const sameArr = (a, b) => Array.isArray(a) && a.length === b.length && [...a].sort().join() === [...b].sort().join();
async function state(id) {
  const u = await db.one(`SELECT isAdmin, baseType FROM \`${T.users}\` WHERE id = ?`, [id]);
  const r = await db.query(`SELECT role FROM \`${T.userRoles}\` WHERE user_id = ? ORDER BY role`, [id]);
  return { is_admin: u?.isAdmin, base_type: u?.baseType, roles: r.map((x) => x.role) };
}
const consistent = (s) => s.is_admin === s.roles.includes("ADMINISTRATOR");
const setRoles = (b, id, roles) => b.api(`/api/admin/users/${id}`, { method: "PATCH", json: { roles } });

async function main() {
  console.log(`\n=== Multi-role admin API tests (app ${h.BASE}) ===\n`);
  const A = await h.mkAdmin();
  const B = await h.mkUser({ kind: "target", baseType: "STUDENT" });
  const C = await h.mkUser({ kind: "promote" });
  const D = await h.mkUser({ kind: "nonadmin" });
  const F = await h.mkUser({ kind: "faculty", baseType: "FACULTY" });
  const bA = h.browser(); check("throwaway admin logs in", (await bA.login(A.email, A.password)) === 200);

  console.log("Authorization:");
  check("admin GET → 200", (await bA.api("/api/admin/users")).status === 200);
  { const bD = h.browser(); await bD.login(D.email, D.password);
    check("non-admin GET → 403", (await bD.api("/api/admin/users")).status === 403);
    check("non-admin PATCH roles → 403", (await setRoles(bD, B.id, ["SPOC"])).status === 403);
    check("non-admin DELETE → 403", (await bD.api(`/api/admin/users/${B.id}`, { method: "DELETE" })).status === 403);
    check("non-admin cannot self-promote → 403", (await setRoles(bD, D.id, ["ADMINISTRATOR"])).status === 403 && (await state(D.id)).is_admin === false); }
  check("unauthenticated GET → 401", (await h.browser().api("/api/admin/users")).status === 401);
  check("cross-site PATCH (foreign Origin) → 403", (await bA.api(`/api/admin/users/${B.id}`, { method: "PATCH", json: { roles: ["SPOC"] }, headers: { Origin: "https://evil.example" } })).status === 403 && (await state(B.id)).roles.length === 0);

  console.log("\nMultiple roles + independent add/remove:");
  { const r = await setRoles(bA, B.id, ["SPOC", "EDITOR"]);
    check("assign SPOC+EDITOR → 200", r.status === 200 && sameArr(r.data.roles, ["EDITOR", "SPOC"]), JSON.stringify(r.data?.roles));
    const s = await state(B.id); check("DB has SPOC+EDITOR, not admin", sameArr(s.roles, ["EDITOR", "SPOC"]) && s.is_admin === false && consistent(s)); }
  {
    // An EDITOR assignment on a throwaway paper must disappear when EDITOR is removed.
    const pid = uuid(); h.manifest.papers.push(pid);
    await db.exec(`INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, submitted_by) VALUES (?, 'IT paper', '', '[]', ?)`, [pid, D.id]);
    await db.exec(`INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by) VALUES (?, ?, ?, 'EDITOR', ?)`, [uuid(), pid, B.id, A.id]);
    const r = await setRoles(bA, B.id, ["SPOC"]);
    check("remove EDITOR, keep SPOC → 200", r.status === 200 && sameArr(r.data.roles, ["SPOC"]));
    check("…and B's per-paper EDITOR assignment is dropped + audited", !(await db.one(`SELECT 1 AS x FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = 'EDITOR'`, [B.id])) &&
      !!(await db.one(`SELECT 1 AS x FROM \`${T.paperActivity}\` WHERE paper_id = ? AND action = 'UNASSIGNED'`, [pid])));
  }

  console.log("\nBase type is IMMUTABLE:");
  { const r = await bA.api(`/api/admin/users/${B.id}`, { method: "PATCH", json: { baseType: "FACULTY" } });
    check("PATCH changing baseType → 422", r.status === 422, `status ${r.status}`);
    check("base_type unchanged (STUDENT)", (await state(B.id)).base_type === "STUDENT"); }
  { const all = ["ADMINISTRATOR", "SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"];
    const r = await setRoles(bA, B.id, all);
    check("assign all 5 roles to a Student → 200", r.status === 200 && sameArr(r.data.roles, all));
    check("Student remains STUDENT after all 5 roles", (await state(B.id)).base_type === "STUDENT");
    const r2 = await setRoles(bA, B.id, ["SPOC"]);
    check("removing roles never changes base_type", r2.status === 200 && (await state(B.id)).base_type === "STUDENT" && consistent(await state(B.id))); }
  { const r = await setRoles(bA, F.id, ["SPOC", "EDITOR", "PEER_REVIEWER"]);
    check("Faculty: multiple roles → 200, stays FACULTY", r.status === 200 && (await state(F.id)).base_type === "FACULTY"); }

  console.log("\nAdministrator promote/revoke (atomic isAdmin sync):");
  { const r = await setRoles(bA, C.id, ["ADMINISTRATOR"]);
    check("promote C → 200, isAdmin true", r.status === 200 && r.data.isAdmin === true);
    check("DB consistent: isAdmin ⟺ ADMINISTRATOR row", consistent(await state(C.id)) && (await state(C.id)).is_admin === true);
    const bC = h.browser(); await bC.login(C.email, C.password);
    check("newly-promoted admin C can access admin API", (await bC.api("/api/admin/users")).status === 200);
    const eliz = await db.one(`SELECT id FROM \`${T.users}\` WHERE email = 'elizabeth.jerome@atlasuniversity.edu.in'`);
    if (eliz) {
      const before = JSON.stringify(await state(eliz.id));
      check("demote protected real admin → 403 (refused)", (await setRoles(bC, eliz.id, [])).status === 403);
      check("protected real admin byte-for-byte unchanged", JSON.stringify(await state(eliz.id)) === before);
    } }
  { const r = await setRoles(bA, C.id, ["EDITOR"]);
    check("revoke admin (roles=[EDITOR]) → 200, isAdmin false", r.status === 200 && r.data.isAdmin === false && sameArr(r.data.roles, ["EDITOR"]));
    check("DB consistent after revoke", consistent(await state(C.id)));
    const bC2 = h.browser(); await bC2.login(C.email, C.password);
    check("revoked admin loses admin API access (403)", (await bC2.api("/api/admin/users")).status === 403); }

  console.log("\nGuards:");
  check("self role change → 403", (await setRoles(bA, A.id, ["SPOC"])).status === 403);
  check("self delete → refused", (await bA.api(`/api/admin/users/${A.id}`, { method: "DELETE" })).status >= 400 && !!(await db.one(`SELECT 1 AS x FROM \`${T.users}\` WHERE id = ?`, [A.id])));
  check("A still admin + consistent", (await state(A.id)).is_admin === true && consistent(await state(A.id)));
  check("invalid role → 422", (await setRoles(bA, B.id, ["WIZARD"])).status === 422);
  check("unknown user → 404", (await setRoles(bA, uuid(), ["SPOC"])).status === 404);

  console.log("\nConcurrency:");
  await Promise.all([setRoles(bA, C.id, ["ADMINISTRATOR"]), setRoles(bA, C.id, []), setRoles(bA, C.id, ["ADMINISTRATOR", "EDITOR"])]);
  check("concurrent promote/revoke → consistent (no drift)", consistent(await state(C.id)), JSON.stringify(await state(C.id)));

  console.log("\nDeletion + cascade:");
  const bB = h.browser(); await bB.login(B.email, B.password);
  { const r = await bA.api(`/api/admin/users/${B.id}`, { method: "DELETE" });
    check("delete B → 200", r.status === 200 && r.data?.ok === true);
    check("B account gone", !(await db.one(`SELECT 1 AS x FROM \`${T.users}\` WHERE id = ?`, [B.id])));
    check("B roles + sessions gone (cascade)", !(await db.one(`SELECT 1 AS x FROM \`${T.userRoles}\` WHERE user_id = ?`, [B.id])) && !(await db.one(`SELECT 1 AS x FROM \`${T.sessions}\` WHERE userId = ?`, [B.id])));
    check("B's open session stops working immediately", (await bB.api("/api/dashboard")).status === 401);
    check("B can no longer log in", (await h.browser().login(B.email, B.password)) === 401); }
}
main().catch(h.fail).finally(() => h.finish("multi-role admin API"));
