/**
 * Account disable / reactivate / safe deletion — HTTP suite against a RUNNING
 * app and its MySQL database (never production: throwaway rpp.it.* accounts and
 * a "[TEST]" paper, all deleted at the end).
 *
 *   node scripts/test-account-status-http.mjs http://localhost:3001
 * Env: DB_* = the app's database.
 */
import { makeHarness } from "./lib/test-db.mjs";
import { uuid } from "../lib/auth/crypto.mjs";
import { createSession, sessionPolicy, SESSION_COOKIE } from "../lib/auth/store.mjs";

const h = makeHarness(process.argv[2]);
const { check } = h;
const T = h.T;

async function main() {
  console.log(`\n=== Account status & safe deletion (app ${h.BASE}) ===\n`);

  // Fixtures: an admin, a second admin, a reviewer with a SUBMITTED review on a paper, a blank account.
  const admin = await h.mkAdmin();
  const admin2 = await h.mkAdmin();
  const author = await h.mkUser({ kind: "author", baseType: "STUDENT" });
  const reviewer = await h.mkUser({ kind: "reviewer" });
  const blank = await h.mkUser({ kind: "blank" });
  await h.grant(admin.id, reviewer.id, ["PEER_REVIEWER"]);
  await h.grant(admin.id, blank.id, ["PEER_REVIEWER"]);
  const paperId = uuid();
  h.manifest.papers.push(paperId);
  await h.db.exec(`INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, status, submitted_by) VALUES (?, '[TEST] status suite', 'x', '[]', 'UNDER_REVIEW', ?)`, [paperId, author.id]);
  await h.db.exec(`INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by) VALUES (?, ?, ?, 'PEER_REVIEWER', ?)`, [uuid(), paperId, reviewer.id, admin.id]);
  const reviewId = uuid();
  await h.db.exec(
    `INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status, recommendation, technical_quality, originality, methodology, clarity, comments_to_author, confidential_to_editor, submitted_at)
     VALUES (?, ?, ?, 0, 'SUBMITTED', 'ACCEPT', 4, 4, 4, 4, 'ok', 'note', UTC_TIMESTAMP(3))`, [reviewId, paperId, reviewer.id]);
  const reviewRow = async () => h.db.one(`SELECT id, reviewer, status, recommendation FROM \`${T.reviews}\` WHERE id = ?`, [reviewId]);
  const reviewBefore = JSON.stringify(await reviewRow());

  const ab = h.browser();
  check("admin signs in", (await ab.login(admin.email, admin.password)) === 200);
  const patch = (b, id, json) => b.api(`/api/admin/users/${id}`, { method: "PATCH", json });
  const del = (b, id) => b.api(`/api/admin/users/${id}`, { method: "DELETE" });

  console.log("Deletion protection:");
  const d1 = await del(ab, reviewer.id);
  check("delete a reviewer with a submitted review → 409 has_history", d1.status === 409 && d1.data?.code === "has_history" && /Disable/.test(d1.data?.error || ""), `HTTP ${d1.status}`);
  check("…review row untouched", JSON.stringify(await reviewRow()) === reviewBefore);
  const d2 = await del(ab, author.id);
  check("delete a paper owner → 409 has_history; paper keeps its owner", d2.status === 409 && (await h.db.one(`SELECT submitted_by FROM \`${T.papers}\` WHERE id = ?`, [paperId])).submitted_by === author.id);
  const d3 = await del(ab, blank.id);
  check("delete an account with no history → 200", d3.status === 200 && !(await h.db.one(`SELECT id FROM \`${T.users}\` WHERE id = ?`, [blank.id])));
  check("delete yourself → 403", (await del(ab, admin.id)).status === 403);

  console.log("\nDisable:");
  const rb = h.browser();
  check("reviewer signs in with a password", (await rb.login(reviewer.email, reviewer.password)) === 200);
  check("…and can reach the dashboard", (await rb.api("/api/dashboard")).status === 200);
  const googleLike = await createSession(h.db, reviewer.id, { purpose: "APP", method: "google", policy: sessionPolicy() });
  const gb = h.browser(); gb.set(SESSION_COOKIE, googleLike.token);
  check("…and has a second (Google) session", (await gb.api("/api/dashboard")).status === 200);
  check("non-admin can't disable anyone → 403", (await patch(rb, author.id, { status: "DISABLED" })).status === 403);
  check("roles + status in one request → 422", (await patch(ab, reviewer.id, { status: "DISABLED", roles: [] })).status === 422);
  check("bad status → 422", (await patch(ab, reviewer.id, { status: "GONE" })).status === 422);
  const dis = await patch(ab, reviewer.id, { status: "DISABLED" });
  check("admin disables the reviewer → 200 DISABLED", dis.status === 200 && dis.data?.status === "DISABLED", `HTTP ${dis.status} ${dis.data?.error || ""}`);
  check("…password session ended (401)", (await rb.api("/api/dashboard")).status === 401);
  check("…Google session ended (401)", (await gb.api("/api/dashboard")).status === 401);
  check("…password sign-in refused (401)", (await h.browser().login(reviewer.email, reviewer.password)) === 401);
  const later = await createSession(h.db, reviewer.id, { purpose: "APP", method: "google", policy: sessionPolicy() });
  const lb = h.browser(); lb.set(SESSION_COOKIE, later.token);
  check("…a session created after disabling (e.g. Google) is refused (401)", (await lb.api("/api/dashboard")).status === 401);
  check("…app pages bounce to sign-in", [302, 303, 307].includes((await lb.req("/dashboard")).status));
  const list = await ab.api("/api/admin/users");
  check("…admin list shows status DISABLED", list.data?.users?.find((u) => u.id === reviewer.id)?.status === "DISABLED");
  check("…review, assignment and roles preserved", JSON.stringify(await reviewRow()) === reviewBefore
    && !!(await h.db.one(`SELECT 1 AS x FROM \`${T.paperAssignments}\` WHERE assignee = ? AND paper_id = ?`, [reviewer.id, paperId]))
    && !!(await h.db.one(`SELECT 1 AS x FROM \`${T.userRoles}\` WHERE user_id = ? AND role = 'PEER_REVIEWER'`, [reviewer.id])));
  const assign = await ab.api(`/api/papers/${paperId}/assign`, { method: "POST", json: { assignee: reviewer.id, role: "PEER_REVIEWER" } });
  check("…a disabled account can't be assigned new work (409)", assign.status === 409, `HTTP ${assign.status}`);
  const fp = await h.browser().api("/api/auth/forgot-password", { method: "POST", json: { email: reviewer.email } });
  check("…forgot password still answers neutrally (200)", fp.status === 200);

  console.log("\nReactivate:");
  const re = await patch(ab, reviewer.id, { status: "ACTIVE" });
  check("admin reactivates → 200 ACTIVE", re.status === 200 && re.data?.status === "ACTIVE");
  const rb2 = h.browser();
  check("…reviewer signs in again with the same password", (await rb2.login(reviewer.email, reviewer.password)) === 200);
  check("…and sees their reviews", (await rb2.api("/api/reviews")).status === 200);
  check("…old sessions stay revoked", (await gb.api("/api/dashboard")).status === 401);
  check("…review still unchanged", JSON.stringify(await reviewRow()) === reviewBefore);

  console.log("\nAdmin protections:");
  check("admin can't disable themself → 403", (await patch(ab, admin.id, { status: "DISABLED" })).status === 403);
  const a2 = await patch(ab, admin2.id, { status: "DISABLED" });
  check("admin can disable another admin when one stays active → 200", a2.status === 200);
  // Now `admin` is the only ACTIVE admin among… everyone in this DB? Only if no other active admins exist.
  const activeAdmins = Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE isAdmin = 1 AND status = 'ACTIVE'`)).n);
  if (activeAdmins === 1) {
    const b2 = h.browser();
    check("disabled admin can't sign in", (await b2.login(admin2.email, admin2.password)) === 401);
  } else {
    check("disabled admin can't sign in", (await h.browser().login(admin2.email, admin2.password)) === 401);
  }
  check("re-enable the second admin → 200", (await patch(ab, admin2.id, { status: "ACTIVE" })).status === 200);
  check("protected original admins can't be disabled (PROTECTED_ADMIN_EMAILS)", await (async () => {
    const prot = await h.db.one(`SELECT id FROM \`${T.users}\` WHERE email = 'elizabeth.jerome@atlasuniversity.edu.in'`);
    if (!prot) return true; // not present in this test database
    return (await patch(ab, prot.id, { status: "DISABLED" })).status === 403;
  })());
}
main().catch(h.fail).finally(() => h.finish("account status & safe deletion"));
