/**
 * Admin paper statistics — HTTP checks against a RUNNING app (MySQL).
 * Admin-only on the server: /api/admin/stats, /api/admin/stats/users/:id and
 * the /statistics page. Every other role (Student, Faculty, Author, Reviewer,
 * Editor, POC) gets 403 / a redirect; anonymous gets 401 / the login page.
 * Also checks the API returns real counts for throwaway data. Self-cleaning.
 *
 *   node scripts/test-paper-stats-http.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import crypto from "node:crypto";
import { makeHarness } from "./lib/test-db.mjs";
import { hashPassword } from "../lib/auth/password.mjs";
import { createAuthorUser, setPasswordHash } from "../lib/repos/users.mjs";
import { uuid } from "../lib/auth/crypto.mjs";

const h = makeHarness(process.argv[2]);
const { check, db, T } = h;
const loc = (r) => r.headers.get("location") || "";

async function signedIn(u) { const b = h.browser(); const st = await b.login(u.email, u.password); return { b, st }; }

async function main() {
  console.log(`\n=== Admin paper statistics HTTP (app ${h.BASE}) ===\n`);
  const admin = await h.mkAdmin();
  const student = await h.mkUser({ kind: "stu", baseType: "STUDENT", applicationNo: `S${h.tag()}` });
  const faculty = await h.mkUser({ kind: "fac" });
  const reviewer = await h.mkUser({ kind: "rev" });
  const editor = await h.mkUser({ kind: "edi" });
  const poc = await h.mkUser({ kind: "poc" });
  await h.grant(admin.id, reviewer.id, ["PEER_REVIEWER", "DESK_REVIEWER"]);
  await h.grant(admin.id, editor.id, ["EDITOR"]);
  await h.grant(admin.id, poc.id, ["SPOC"]);
  const aEmail = `rpp.it.statauthor.${h.tag()}@example-author.org`;
  const aId = await db.transaction((tx) => createAuthorUser(tx, { name: "IT Stat Author", email: aEmail, phone: "+91 90000 00000", organization: "X", current_status: "OTHER", designation: "D", location: "L" }));
  h.manifest.users.push(aId);
  const aPw = `It#${crypto.randomBytes(12).toString("base64url")}`;
  await setPasswordHash(db, aId, await hashPassword(aPw));
  const author = { id: aId, email: aEmail, password: aPw };

  // Data: student submits P (faculty + author co-authors); reviewer DESK+PEER, editor, POC assigned.
  const pid = uuid();
  h.manifest.papers.push(pid);
  await db.exec(`INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, status, submitted_by, current_round) VALUES (?, 'IT stats paper', 'a', '[]', 'UNDER_REVIEW', ?, 0)`, [pid, student.id]);
  let i = 0;
  for (const e of [student.email, faculty.email, aEmail]) await db.exec(`INSERT INTO \`${T.paperAuthors}\` (id, paper_id, full_name, email, is_corresponding, author_order) VALUES (?, ?, 'X', ?, ?, ?)`, [uuid(), pid, e, i === 0 ? 1 : 0, i++]);
  for (const [who, role] of [[reviewer.id, "DESK_REVIEWER"], [reviewer.id, "PEER_REVIEWER"], [editor.id, "EDITOR"], [poc.id, "SPOC"]]) {
    await db.exec(`INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by) VALUES (?, ?, ?, ?, ?)`, [uuid(), pid, who, role, admin.id]);
  }

  console.log("Anonymous:");
  check("GET /api/admin/stats → 401", (await h.browser().api("/api/admin/stats")).status === 401);
  check("GET /api/admin/stats/users/:id → 401", (await h.browser().api(`/api/admin/stats/users/${student.id}`)).status === 401);
  const anonPage = await h.browser().req("/statistics");
  check("/statistics → redirect to /login", [302, 303, 307, 308].includes(anonPage.status) && /\/login/.test(loc(anonPage)));

  console.log("\nNon-admin roles are refused (server-side):");
  for (const [label, u] of [["Student", student], ["Faculty", faculty], ["Author", author], ["Reviewer", reviewer], ["Editor", editor], ["POC (SPOC)", poc]]) {
    const { b, st } = await signedIn(u);
    const s1 = await b.api("/api/admin/stats");
    const s2 = await b.api(`/api/admin/stats/users/${student.id}`);
    const pg = await b.req("/statistics");
    const pgHtml = await pg.text();
    // Next.js streams the server-side redirect() inside the app layout as a
    // refresh to /dashboard (same as the existing /users page); the statistics
    // UI is never rendered and its data only comes from the 403-guarded API.
    const redirected = ([302, 303, 307, 308].includes(pg.status) && /\/dashboard/.test(loc(pg))) || /http-equiv="refresh" content="\d+;url=\/dashboard"/.test(pgHtml);
    check(`${label}: signed in; stats API 403, detail API 403, /statistics redirects to /dashboard without rendering`, st === 200 && s1.status === 403 && s2.status === 403 && redirected && !/User-wise paper overview/.test(pgHtml), `${st}/${s1.status}/${s2.status}/${pg.status}`);
    check(`${label}: no statistics data leaked in the 403 body`, !JSON.stringify(s1.data).includes(student.email) && !("users" in (s1.data || {})));
  }

  console.log("\nAdministrator:");
  const { b: ab } = await signedIn(admin);
  const r = await ab.api(`/api/admin/stats?search=${encodeURIComponent("rpp.it.")}&pageSize=100`);
  check("GET /api/admin/stats → 200 with summary + users", r.status === 200 && r.data?.summary && Array.isArray(r.data.users), `${r.status}`);
  const row = (e) => r.data.users.find((u) => u.email === e);
  check("Student: submitted 1 (submitter + listed author counted once), total 1, under review 1", row(student.email)?.submitted === 1 && row(student.email).total === 1 && row(student.email).underReview === 1);
  check("Faculty co-author: submitted 1", row(faculty.email)?.submitted === 1 && row(faculty.email).total === 1);
  check("Author co-author: submitted 1, role Author", row(aEmail)?.submitted === 1 && row(aEmail).roles.includes("Author"));
  check("Reviewer (desk + peer on the same paper): assigned 1", row(reviewer.email)?.assigned === 1 && row(reviewer.email).total === 1 && row(reviewer.email).roles.includes("Reviewer"));
  check("Editor: assigned 1; POC: assigned 1 (role POC)", row(editor.email)?.assigned === 1 && row(poc.email)?.assigned === 1 && row(poc.email).roles.includes("POC"));
  check("zero-paper user (the admin) listed with 0", row(admin.email)?.total === 0);
  check("Faculty listed by email only → listedCoAuthor 1; Student (submitter) → 0", row(faculty.email)?.listedCoAuthor === 1 && row(student.email)?.listedCoAuthor === 0 && row(aEmail)?.listedCoAuthor === 1);
  const fd = await ab.api(`/api/admin/stats/users/${faculty.id}`);
  check("detail for a listed co-author: label \"Listed as Co-author\", flagged listedCoAuthorOnly", fd.status === 200 && JSON.stringify(fd.data.papers[0]?.relationshipLabels) === '["Listed as Co-author"]' && fd.data.papers[0].listedCoAuthorOnly === true);
  const sd = await ab.api(`/api/admin/stats/users/${student.id}`);
  check("detail for the submitter: only \"Author (submitter)\"", JSON.stringify(sd.data.papers[0]?.relationshipLabels) === '["Author (submitter)"]');
  const off = await h.mkUser({ kind: "off" });
  await db.exec(`UPDATE \`${T.users}\` SET status = 'DISABLED' WHERE id = ?`, [off.id]);
  const offRow = (await ab.api(`/api/admin/stats?search=${encodeURIComponent(off.email)}`)).data?.users?.[0];
  const offDetail = await ab.api(`/api/admin/stats/users/${off.id}`);
  check("disabled account: status DISABLED in the table and the detail view", offRow?.status === "DISABLED" && offDetail.data?.user?.status === "DISABLED");
  check("active account: status ACTIVE", row(student.email)?.status === "ACTIVE");
  const f = await ab.api(`/api/admin/stats?search=${encodeURIComponent("rpp.it.")}&role=REVIEWER&status=UNDER_REVIEW&pageSize=100`);
  check("role + status filters", f.status === 200 && f.data.users.some((u) => u.email === reviewer.email) && f.data.users.every((u) => u.roles.includes("Reviewer")));
  const d = await ab.api(`/api/admin/stats/users/${reviewer.id}`);
  check("user detail: the paper with Desk + Peer reviewer relationship", d.status === 200 && d.data.papers.length === 1 && d.data.papers[0].id === pid && d.data.papers[0].relationshipLabels.join() === "Desk reviewer,Peer reviewer");
  check("user detail: unknown user → 404", (await ab.api("/api/admin/stats/users/00000000-0000-4000-8000-000000000000")).status === 404);
  const pg = await ab.req("/statistics");
  const html = await pg.text();
  check("/statistics renders for the admin", pg.status === 200 && /Paper statistics/.test(html));
  check("existing paper detail page opens for the admin", (await ab.req(`/submissions/${pid}`)).status === 200);
  check("stats are read-only (POST → 405)", (await ab.api("/api/admin/stats", { method: "POST", json: {} })).status === 405);
}

try { await main(); } catch (e) { h.fail(e); } finally { await h.finish("admin paper statistics HTTP"); }
