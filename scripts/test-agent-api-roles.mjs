/**
 * IntelligenceOS Agent API — "acts as the signed-in user" (X-IntelligenceOS-User)
 * MySQL/MariaDB integration suite. Every portal role asks the SAME handler the
 * /agent-api route uses, and each must see exactly what the portal shows them:
 *
 *   Administrator · Program Chair · Editor · Peer / Desk Reviewer · SPOC ·
 *   Student / Faculty submitter · AIDC external author · multi-role faculty
 *
 * plus: unknown / disabled / malformed users → 403, per-user manifest, writes
 * limited to admin / the paper's editor, acting user in the request log, and
 * author identity + confidential text never leaving the portal.
 *
 * Safety: creates its OWN throwaway database `rpp_it_roles_<random>`, runs the
 * real migrations, seeds data and drops ONLY that database at the end.
 * Refuses non-local servers unless RPP_IT_ALLOW_REMOTE=yes.
 *
 *   npm run test:agent-api-roles   (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD of a LOCAL server)
 */
import mysql from "mysql2/promise";
import { createDb, createPool } from "../lib/db/core.mjs";
import { T } from "../lib/db/tables.mjs";
import { migrate } from "./db-migrate.mjs";
import { uuid } from "../lib/auth/crypto.mjs";
import { createRegisteredUser } from "../lib/repos/users.mjs";
import { createApiKey } from "../lib/agentApi/keys.mjs";
import { createAgentApi, createKeyRateLimiter } from "../lib/agentApi/handler.mjs";

let failures = 0, total = 0;
const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);

const env = process.env;
const conn = {
  host: env.IT_DB_HOST || env.DB_HOST || "localhost",
  port: Number(env.IT_DB_PORT || env.DB_PORT || 3306),
  user: env.IT_DB_USER || env.DB_USER || "root",
  password: env.IT_DB_PASSWORD ?? env.DB_PASSWORD ?? "",
};
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(conn.host) && env.RPP_IT_ALLOW_REMOTE !== "yes") {
  console.error(`Refusing to create a test database on non-local host ${conn.host}.`);
  process.exit(2);
}
const DB_NAME = `rpp_it_roles_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const server = await mysql.createConnection({ ...conn });
await server.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const db = createDb(createPool({ ...conn, database: DB_NAME, connectionLimit: 4 }));
console.log(`Agent API roles suite — ${(await db.one("SELECT VERSION() AS v")).v} — throwaway database ${DB_NAME}`);

const SECRETS = ["Secret Author", "secret.author", "CONF-", "storage-key", "manuscript.pdf"];
const leaks = (body) => SECRETS.filter((s) => JSON.stringify(body).includes(s));

try {
  await migrate(db, { log: () => {} });
  section("Migration 011:");
  check("research_agent_api_log.acting_email exists", !!(await db.one(
    "SELECT 1 AS x FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'acting_email'", [T.agentApiLog])));

  // ---- People -----------------------------------------------------------------------
  const tag = uuid().slice(0, 6);
  const mk = async (key, name, baseType = "FACULTY") => {
    const email = `it.${key}.${tag}@atlasuniversity.edu.in`;
    const id = await createRegisteredUser(db, { name, email, baseType: baseType === "STUDENT" ? "STUDENT" : "FACULTY", schoolCode: "ISDI" });
    if (baseType === "AUTHOR") await db.exec(`UPDATE \`${T.users}\` SET baseType = 'AUTHOR' WHERE id = ?`, [id]);
    return { id, email, name };
  };
  const role = (u, r) => db.exec(`INSERT INTO \`${T.userRoles}\` (user_id, role) VALUES (?, ?)`, [u.id, r]);
  const U = {
    admin: await mk("admin", "Asha Admin"),
    chair: await mk("chair", "Chitra Chair"),
    editor: await mk("editor", "Eshan Editor"),
    rev1: await mk("rev1", "Ravi Reviewer"),
    rev2: await mk("rev2", "Rhea Reviewer"),
    desk: await mk("desk", "Dev Desk"),
    spoc: await mk("spoc", "Sona Spoc"),
    student: await mk("student", "Sam Student", "STUDENT"),
    faculty: await mk("faculty", "Farah Faculty"), // submitter AND peer reviewer
    aidc: await mk("aidc", "Aidc Author", "AUTHOR"),
    off: await mk("off", "Off User"),
  };
  await db.exec(`UPDATE \`${T.users}\` SET isAdmin = 1 WHERE id IN (?)`, [[U.admin.id, U.aidc.id]]); // aidc: a hand-edited row — must be ignored
  await db.exec(`UPDATE \`${T.users}\` SET status = 'DISABLED' WHERE id = ?`, [U.off.id]);
  await role(U.admin, "ADMINISTRATOR");
  await role(U.chair, "PROGRAM_CHAIR");
  await role(U.editor, "EDITOR");
  for (const u of [U.rev1, U.rev2, U.faculty]) await role(u, "PEER_REVIEWER");
  await role(U.desk, "DESK_REVIEWER");
  await role(U.spoc, "SPOC");
  const chairEmails = [U.chair.email];

  // ---- Papers ------------------------------------------------------------------------
  const P = {};
  const paper = async (k, ref, owner, status, at, round = 0) => {
    const id = uuid();
    await db.exec(
      `INSERT INTO \`${T.papers}\` (id, ref_id, title, abstract, keywords, school_code, status, submitted_by, current_round, created_at)
       VALUES (?, ?, ?, 'Abstract', '["ai"]', 'ISDI', ?, ?, ?, ?)`, [id, ref, `Paper ${k}`, status, owner.id, round, at]);
    await db.exec(`INSERT INTO \`${T.paperAuthors}\` (id, paper_id, full_name, email, is_corresponding, author_order) VALUES (?, ?, 'Secret Author', 'secret.author@example.org', 1, 0)`, [uuid(), id]);
    await db.exec(`INSERT INTO \`${T.paperManuscripts}\` (id, paper_id, version, storage_key, original_filename, mime_type, byte_size, sha256) VALUES (?, ?, 0, ?, 'manuscript.pdf', 'application/pdf', 10, ?)`, [uuid(), id, `storage-key-${k}`, "a".repeat(64)]);
    await db.exec(`INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail, created_at) VALUES (?, ?, ?, 'SUBMITTED', '{}', ?)`, [uuid(), id, owner.id, at]);
    P[k] = { id, ref };
    return id;
  };
  const assign = async (k, u, r) => {
    await db.exec(`INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by, due_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), P[k].id, u.id, r, U.admin.id, new Date(Date.now() - 86400000)]); // due yesterday
    await db.exec(`INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail) VALUES (?, ?, ?, 'ASSIGNED', ?)`, [uuid(), P[k].id, U.admin.id, JSON.stringify({ assignee: u.id, role: r })]);
  };
  const review = async (k, u, status, rec = null, label = "x", round = 0) => {
    const id = uuid();
    if (status === "SUBMITTED") {
      await db.exec(
        `INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status, recommendation, technical_quality, originality, methodology, clarity,
           comments_to_author, confidential_to_editor, submitted_at) VALUES (?, ?, ?, ?, 'SUBMITTED', ?, 4, 4, 4, 4, ?, ?, UTC_TIMESTAMP(3))`,
        [id, P[k].id, u.id, round, rec, `C2A-${label}`, `CONF-${label}`]);
      await db.exec(`INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail) VALUES (?, ?, ?, 'REVIEW_SUBMITTED', '{}')`, [uuid(), P[k].id, u.id]);
    } else {
      await db.exec(`INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status, confidential_to_editor) VALUES (?, ?, ?, ?, 'DRAFT', ?)`, [id, P[k].id, u.id, round, `CONF-draft-${label}`]);
    }
    return id;
  };

  await paper("P1", "ISDI-2026-0001", U.student, "REVISION", "2026-01-10 10:00:00");
  await paper("P2", "ISDI-2026-0002", U.student, "SUBMITTED", "2026-02-10 10:00:00");
  await paper("P3", "ISDI-2026-0003", U.faculty, "UNDER_REVIEW", "2026-03-10 10:00:00");
  await paper("P4", "ISDI-2026-0004", U.aidc, "SUBMITTED", "2026-04-10 10:00:00");
  await paper("P5", "ISDI-2026-0005", U.admin, "UNDER_REVIEW", "2026-05-10 10:00:00");
  await paper("P6", "ISDI-2026-0006", U.student, "PUBLISHED", "2025-06-10 10:00:00");
  await paper("P7", "ISDI-2026-0007", U.faculty, "ACCEPTED", "2025-07-10 10:00:00");

  await assign("P1", U.editor, "EDITOR");
  await assign("P1", U.rev1, "PEER_REVIEWER");
  await assign("P1", U.faculty, "PEER_REVIEWER");
  await assign("P1", U.desk, "DESK_REVIEWER");
  await assign("P3", U.rev2, "PEER_REVIEWER");
  await assign("P4", U.spoc, "SPOC");
  await assign("P5", U.rev1, "PEER_REVIEWER");
  await assign("P7", U.editor, "EDITOR");

  const r1 = await review("P1", U.rev1, "SUBMITTED", "MINOR_REVISION", "R1");
  await review("P1", U.desk, "SUBMITTED", "ACCEPT", "DESK");
  await review("P1", U.faculty, "DRAFT", null, "FAC");
  await review("P3", U.rev2, "SUBMITTED", "ACCEPT", "R2");

  // P1: released MINOR_REVISION (approved by chair) + revision round 1
  const rev1Id = uuid();
  await db.exec(
    `INSERT INTO \`${T.paperRevisions}\` (id, paper_id, round, revision_type, instructions, due_at, status, review_ids, responses, requested_by)
     VALUES (?, ?, 1, 'MINOR', 'Fix section 2', ?, 'REVISION_REQUESTED', ?, '[]', ?)`,
    [rev1Id, P.P1.id, new Date(Date.now() + 7 * 86400000), JSON.stringify([r1]), U.editor.id]);
  const d1 = uuid();
  await db.exec(
    `INSERT INTO \`${T.editorialDecisions}\` (id, paper_id, round, decision, summary, confidential_note, review_ids, revision_id, decided_by, released_at, released_by)
     VALUES (?, ?, 0, 'MINOR_REVISION', 'MSG-P1 please revise', 'CONF-decision', ?, ?, ?, UTC_TIMESTAMP(3), ?)`,
    [d1, P.P1.id, JSON.stringify([r1]), rev1Id, U.editor.id, U.editor.id]);
  await db.exec(`INSERT INTO \`${T.decisionApprovals}\` (id, paper_id, decision_id, round, decision, decision_version, status, requested_by, acted_by, acted_at, comment)
     VALUES (?, ?, ?, 0, 'MINOR_REVISION', 1, 'APPROVED', ?, ?, UTC_TIMESTAMP(3), 'Fine')`, [uuid(), P.P1.id, d1, U.editor.id, U.chair.id]);
  await db.exec(`INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail) VALUES (?, ?, ?, 'DECISION_COMMUNICATED', '{"decision":"MINOR_REVISION"}')`, [uuid(), P.P1.id, U.editor.id]);
  await db.exec(`INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail) VALUES (?, ?, ?, 'REVISION_REQUESTED', '{"round":1}')`, [uuid(), P.P1.id, U.editor.id]);

  // P3: unreleased ACCEPT waiting for the chair
  const d3 = uuid();
  await db.exec(
    `INSERT INTO \`${T.editorialDecisions}\` (id, paper_id, round, decision, summary, confidential_note, review_ids, decided_by)
     VALUES (?, ?, 0, 'ACCEPT', 'MSG-P3 accepted', 'CONF-decision-3', '[]', ?)`, [d3, P.P3.id, U.admin.id]);
  await db.exec(`INSERT INTO \`${T.decisionApprovals}\` (id, paper_id, decision_id, round, decision, decision_version, status, requested_by)
     VALUES (?, ?, ?, 0, 'ACCEPT', 1, 'PENDING', ?)`, [uuid(), P.P3.id, d3, U.admin.id]);

  // Publications: vol 1 published (P6), vol 2 draft with P7 scheduled
  const v1 = uuid(), i1 = uuid(), v2 = uuid(), i2 = uuid();
  await db.exec(`INSERT INTO \`${T.volumes}\` (id, volume_number, year, title, description, status, published_at) VALUES (?, 1, 2025, 'Vol One', '', 'PUBLISHED', UTC_TIMESTAMP(3))`, [v1]);
  await db.exec(`INSERT INTO \`${T.issues}\` (id, volume_id, issue_number, title, description, publication_date, status, published_at) VALUES (?, ?, 1, 'Issue One', '', '2025-09-01', 'PUBLISHED', UTC_TIMESTAMP(3))`, [i1, v1]);
  await db.exec(`INSERT INTO \`${T.volumes}\` (id, volume_number, year, title, description, status) VALUES (?, 2, 2026, 'Vol Two', '', 'DRAFT')`, [v2]);
  await db.exec(`INSERT INTO \`${T.issues}\` (id, volume_id, issue_number, title, description, status) VALUES (?, ?, 1, 'Draft Issue', '', 'DRAFT')`, [i2, v2]);
  await db.exec(`INSERT INTO \`${T.publications}\` (id, paper_id, volume_id, issue_id, title, abstract, authors, keywords, page_start, page_end, doi, publication_date, status, published_at)
     VALUES (?, ?, ?, ?, 'Published Paper Six', 'Abs', '[{"name":"Secret Author","email":"secret.author@example.org"}]', '["ai"]', 1, 10, '10.1/six', '2025-09-01', 'PUBLISHED', UTC_TIMESTAMP(3))`, [uuid(), P.P6.id, v1, i1]);
  await db.exec(`INSERT INTO \`${T.publications}\` (id, paper_id, volume_id, issue_id, title, abstract, authors, keywords, status)
     VALUES (?, ?, ?, ?, 'Scheduled Paper Seven', 'Abs', '[{"name":"Secret Author"}]', '["ai"]', 'SCHEDULED')`, [uuid(), P.P7.id, v2, i2]);

  // Achievements: faculty × 2, rev2 × 1
  const ach = (u, type, title, date, amount = null) => db.exec(
    `INSERT INTO \`${T.achievements}\` (id, user_id, type, school_code, title, achievement_date, amount_inr, details, status) VALUES (?, ?, ?, 'ISDI', ?, ?, ?, ?, 'SUBMITTED')`,
    [uuid(), u.id, type, title, date, amount, JSON.stringify({ funding_agency: "DST" })]);
  await ach(U.faculty, "GRANT", "Grant A", "2026-01-05", 500000);
  await ach(U.faculty, "AWARD", "Award B", "2026-02-05");
  await ach(U.rev2, "GRANT", "Grant C", "2026-03-05", 100000);

  // AIDC author profile + one unfinished registration
  await db.exec(`INSERT INTO \`${T.authorProfiles}\` (user_id, phone, organization, current_status, designation, location) VALUES (?, '+910000000000', 'Org', 'STUDENT', 'MSc', 'Mumbai')`, [U.aidc.id]);
  await db.exec(`INSERT INTO \`${T.authorRegistrations}\` (id, token_hash, email, name, phone, organization, current_status, designation, location, expires_at)
     VALUES (?, ?, 'pending.person@example.org', 'Pending Person', '+911111111111', 'Org', 'STUDENT', 'BSc', 'Pune', ?)`, [uuid(), "b".repeat(64), new Date(Date.now() + 86400000)]);

  // ---- Keys + API ----------------------------------------------------------------------
  const ro = await createApiKey(db, { name: "IOS read", scopes: ["research.read"], createdBy: U.admin.id });
  const rw = await createApiKey(db, { name: "IOS rw", scopes: ["research.read", "research.write"], createdBy: U.admin.id });
  const api = createAgentApi({ db, limiter: createKeyRateLimiter({ limit: 10_000 }), chairEmails: () => chairEmails });
  const allBodies = [];
  const as = async (who, method, path, { query = {}, body, key = ro.key } = {}) => {
    const h = new Headers({ Authorization: `Bearer ${key}`, "X-IntelligenceOS-Agent": "Roles agent", "X-IntelligenceOS-Run": "run-roles" });
    if (who !== null) h.set("X-IntelligenceOS-User", typeof who === "string" ? who : who.email);
    const r = await api({ method, path, query: new URLSearchParams(query), headers: h, body: body === undefined ? "" : JSON.stringify(body), ip: "127.0.0.1" });
    if (who !== null) allBodies.push(r.body);
    return r;
  };
  const refs = (r) => (r.body.submissions || []).map((s) => s.refId).sort().join();
  const ids = (r) => r.body.actions.map((a) => a.id);

  // ---- Identity --------------------------------------------------------------------------
  section("Acting user — identity:");
  let r = await as("nobody@example.org", "GET", "/manifest");
  check("unknown email → 403 with a plain reason", r.status === 403 && /no ATLAS Research portal account/.test(r.body.error));
  r = await as(U.off, "GET", "/submissions");
  check("disabled account → 403", r.status === 403 && /not active/.test(r.body.error));
  r = await as("not-an-email", "GET", "/manifest");
  check("malformed email → 403", r.status === 403);
  r = await as(U.student.email.toUpperCase(), "GET", "/me");
  check("email matched case-insensitively", r.status === 200 && r.body.actingAs.name === "Sam Student");
  r = await as(null, "GET", "/me");
  check("no header → key acts on its own", r.status === 200 && r.body.actingAs === null);
  r = await api({ method: "GET", path: "/manifest", query: new URLSearchParams(), headers: new Headers({ "X-IntelligenceOS-User": U.admin.email }), body: "", ip: null });
  check("a user header never replaces the key (no key → 401)", r.status === 401);

  // ---- Manifests ---------------------------------------------------------------------------
  section("Per-user manifest:");
  r = await as(U.admin, "GET", "/manifest", { key: rw.key });
  check("admin + rw key: all 17 actions, user block", r.status === 200 && r.body.actions.length === 17 && r.body.user.email === U.admin.email);
  r = await as(U.student, "GET", "/manifest", { key: rw.key });
  const stu = ids(r);
  check("student: no people / AIDC stats / approvals / writes", !stu.includes("list_users") && !stu.includes("registration_stats") && !stu.includes("list_approvals") && !stu.includes("add_review_note") && !stu.includes("update_submission_status"), stu.join());
  check("student: own submissions, revisions, decisions, achievements, publications", ["list_submissions", "get_submission", "list_revisions", "list_decisions", "list_achievements", "list_publications", "whoami"].every((x) => stu.includes(x)));
  r = await as(U.aidc, "GET", "/manifest", { key: rw.key });
  const aidc = ids(r);
  check("AIDC author (even with isAdmin=1 in the row): no achievements, review assignments, people", !aidc.includes("list_achievements") && !aidc.includes("list_review_assignments") && !aidc.includes("list_users") && !aidc.includes("add_review_note"), aidc.join());
  r = await as(U.editor, "GET", "/manifest", { key: rw.key });
  check("editor + rw key: write actions offered", ids(r).includes("add_review_note") && ids(r).includes("update_submission_status") && !ids(r).includes("list_users"));
  r = await as(U.editor, "GET", "/manifest", { key: ro.key });
  check("editor + read-only key: still no writes (key scopes ∩ user)", !ids(r).includes("add_review_note"));
  r = await as(U.chair, "GET", "/manifest");
  check("Program Chair: approvals offered", ids(r).includes("list_approvals"));
  r = await as(U.student, "GET", "/users");
  check("student calling list_users anyway → 403", r.status === 403 && /can't use/.test(r.body.error));
  r = await as(U.aidc, "GET", "/achievements");
  check("AIDC author calling list_achievements → 403", r.status === 403);

  // ---- Student (submitter) ------------------------------------------------------------------------
  section("Student — own papers, author view:");
  r = await as(U.student, "GET", "/submissions");
  check("sees only own papers P1, P2, P6", refs(r) === "ISDI-2026-0001,ISDI-2026-0002,ISDI-2026-0006" && r.body.total === 3, refs(r));
  check("each row says myRoles = SUBMITTER", r.body.submissions.every((s) => s.myRoles.join() === "SUBMITTER"));
  r = await as(U.student, "GET", `/submissions/${P.P1.ref}`);
  const sp1 = r.body.submission;
  check("P1 → owner view", r.status === 200 && sp1.view === "owner");
  check("released decision + message + revision instructions", sp1.decisions.length === 1 && sp1.decisions[0].message.startsWith("MSG-P1") && sp1.revisions[0].instructions === "Fix section 2");
  check("reviewer comments for the author: only released review, anonymous", sp1.decisions[0].reviewerComments.length === 1 && sp1.decisions[0].reviewerComments[0].comments === "C2A-R1" && sp1.decisions[0].reviewerComments[0].reviewer === "Reviewer 1");
  const blob1 = JSON.stringify(r.body);
  check("no reviewer names, editors, notes, desk review or assignment history", !blob1.includes("Ravi") && !blob1.includes("Eshan") && !blob1.includes("Dev Desk") && !blob1.includes("C2A-DESK") && !("reviewers" in sp1) && !("notes" in sp1) && !sp1.statusHistory.some((h) => h.event === "ASSIGNED"));
  check("history only has author-visible events", sp1.statusHistory.map((h) => h.event).sort().join() === "DECISION_COMMUNICATED,REVISION_REQUESTED,SUBMITTED", sp1.statusHistory.map((h) => h.event).join());
  r = await as(U.student, "GET", `/submissions/${P.P3.ref}`);
  check("someone else's paper → 404 (existence not confirmed)", r.status === 404);
  r = await as(U.student, "GET", "/stats/submissions");
  check("stats cover only own papers", r.body.total === 3 && r.body.scope === "mine");
  r = await as(U.student, "GET", "/revisions");
  check("revisions: own P1 only", r.body.total === 1 && r.body.revisions[0].submission.refId === P.P1.ref && r.body.revisions[0].mine === true);
  r = await as(U.student, "GET", "/decisions");
  check("decisions: own released only, message not internal summary", r.body.total === 1 && r.body.decisions[0].mine === true && r.body.decisions[0].message.startsWith("MSG-P1") && !("decidedBy" in r.body.decisions[0]));
  r = await as(U.student, "GET", "/reviews");
  check("review assignments: none (authors don't see reviewers)", r.status === 200 && r.body.assignments.length === 0);
  r = await as(U.student, "GET", "/activity");
  check("activity: own milestones only, never ASSIGNED, no names", r.body.activity.length === 5 && r.body.activity.every((a) => a.event !== "ASSIGNED" && a.event !== "REVIEW_SUBMITTED" && (!a.by || a.by === "You")), r.body.activity.map((a) => a.event).join());
  r = await as(U.student, "GET", "/publications");
  check("publications: public P6 (+ none scheduled of others)", r.body.total === 1 && r.body.publications[0].title === "Published Paper Six" && !("authors" in r.body.publications[0]));
  r = await as(U.student, "GET", "/volumes");
  check("volumes: only published", r.body.total === 1 && r.body.volumes[0].status === "PUBLISHED" && r.body.volumes[0].issues[0].papers === 1);
  r = await as(U.student, "GET", "/achievements");
  check("achievements: own (none)", r.status === 200 && r.body.total === 0);
  r = await as(U.student, "GET", "/submissions", { query: { myRole: "EDITOR" } });
  check("myRole=EDITOR → nothing", r.body.total === 0);

  // ---- Peer reviewer -----------------------------------------------------------------------------
  section("Peer reviewer — assigned papers, own review only:");
  r = await as(U.rev1, "GET", "/submissions");
  check("sees P1 + P5 (assigned), myRoles PEER_REVIEWER", refs(r) === "ISDI-2026-0001,ISDI-2026-0005" && r.body.submissions.every((s) => s.myRoles.includes("PEER_REVIEWER")), refs(r));
  r = await as(U.rev1, "GET", `/submissions/${P.P1.id}`);
  const rp1 = r.body.submission;
  check("P1 → reviewer view with own assignment + own review", rp1.view === "reviewer" && rp1.myAssignments[0].role === "PEER_REVIEWER" && rp1.myReviews[0].recommendation === "MINOR_REVISION");
  check("never other reviewers, desk review, decisions or history", !("reviewers" in rp1) && !("decisions" in rp1) && !("statusHistory" in rp1) && !JSON.stringify(rp1).includes("Dev Desk") && !JSON.stringify(rp1).includes("MSG-P1"));
  r = await as(U.rev1, "GET", "/reviews");
  check("review assignments: only own rows, shown as You, overdue counted", r.body.assignments.length === 2 && r.body.assignments.every((a) => a.reviewer === "You") && r.body.totals.overdue === 1 && r.body.totals.submitted === 1, JSON.stringify(r.body.totals));
  r = await as(U.rev1, "GET", "/reviews", { query: { reviewStatus: "NOT_STARTED" } });
  check("filter NOT_STARTED → P5", r.body.assignments.length === 1 && r.body.assignments[0].submission.refId === P.P5.ref);
  r = await as(U.rev1, "GET", "/decisions");
  check("decisions: none (not an editor)", r.body.total === 0);
  r = await as(U.rev1, "GET", "/activity");
  check("activity: only own actions", r.body.activity.length === 1 && r.body.activity[0].event === "REVIEW_SUBMITTED" && r.body.activity[0].by === "You");
  r = await as(U.rev1, "GET", "/me");
  check("whoami: paper roles + reviews still to submit", r.body.actingAs.paperRoles.join() === "PEER_REVIEWER" && r.body.myAssignments.PEER_REVIEWER === 2 && r.body.reviewsToSubmit === 1);

  // ---- Desk + SPOC -------------------------------------------------------------------------------
  section("Desk reviewer + SPOC:");
  r = await as(U.desk, "GET", `/submissions/${P.P1.ref}`);
  check("desk reviewer: reviewer view of P1, own desk review", r.body.submission.view === "reviewer" && r.body.submission.myAssignments[0].role === "DESK_REVIEWER" && !JSON.stringify(r.body).includes("Ravi"));
  r = await as(U.spoc, "GET", "/submissions");
  check("SPOC: only P4", refs(r) === "ISDI-2026-0004");
  r = await as(U.spoc, "GET", `/submissions/${P.P4.ref}`);
  check("SPOC: reviewer view (no author)", r.body.submission.view === "reviewer" && r.body.submission.myRoles.join() === "SPOC");

  // ---- Multi-role faculty ---------------------------------------------------------------------------
  section("Multi-role faculty (submitter on P3/P7, peer reviewer on P1):");
  r = await as(U.faculty, "GET", "/submissions");
  check("sees own P3, P7 and assigned P1", refs(r) === "ISDI-2026-0001,ISDI-2026-0003,ISDI-2026-0007", refs(r));
  const byRef = Object.fromEntries(r.body.submissions.map((s) => [s.refId, s.myRoles.join()]));
  check("roles per paper", byRef[P.P1.ref] === "PEER_REVIEWER" && byRef[P.P3.ref] === "SUBMITTER" && byRef[P.P7.ref] === "SUBMITTER", JSON.stringify(byRef));
  r = await as(U.faculty, "GET", "/submissions", { query: { myRole: "PEER_REVIEWER" } });
  check("myRole=PEER_REVIEWER → P1", refs(r) === P.P1.ref);
  r = await as(U.faculty, "GET", "/submissions", { query: { myRole: "SUBMITTER" } });
  check("myRole=SUBMITTER → P3, P7", refs(r) === "ISDI-2026-0003,ISDI-2026-0007");
  r = await as(U.faculty, "GET", `/submissions/${P.P3.ref}`);
  check("own P3 → owner view: unreleased ACCEPT hidden, reviewer hidden", r.body.submission.view === "owner" && r.body.submission.decisions.length === 0 && !JSON.stringify(r.body).includes("Rhea") && !JSON.stringify(r.body).includes("MSG-P3"));
  r = await as(U.faculty, "GET", `/submissions/${P.P1.ref}`);
  check("assigned P1 → reviewer view, own DRAFT review", r.body.submission.view === "reviewer" && r.body.submission.myReviews[0].status === "DRAFT");
  r = await as(U.faculty, "GET", "/publications");
  check("publications: public P6 + own scheduled P7", r.body.total === 2);
  r = await as(U.faculty, "GET", "/achievements");
  check("achievements: own 2, with details, no faculty name", r.body.total === 2 && r.body.achievements.every((a) => !("faculty" in a)) && r.body.achievements.some((a) => a.details.some((d) => d.value === "DST")));
  r = await as(U.faculty, "GET", "/stats/achievements");
  check("achievement stats: own (2, grant 5,00,000)", r.body.total === 2 && r.body.byType.GRANT.amountInr === 500000 && r.body.scope === "mine");

  // ---- Editor -------------------------------------------------------------------------------------
  section("Editor — manager of P1 and P7:");
  r = await as(U.editor, "GET", "/submissions");
  check("sees P1 + P7", refs(r) === "ISDI-2026-0001,ISDI-2026-0007");
  r = await as(U.editor, "GET", `/submissions/${P.P1.ref}`);
  const ep1 = r.body.submission;
  check("manager view: all reviewers with names + progress", ep1.view === "manager" && ep1.reviewers.length === 3 && ep1.reviewers.some((x) => x.name === "Ravi Reviewer" && x.review.recommendation === "MINOR_REVISION"));
  check("decisions with approval status + revisions", ep1.decisions[0].finalApproval.status === "APPROVED" && ep1.decisions[0].decidedBy === "Eshan Editor" && ep1.revisions.length === 1);
  r = await as(U.editor, "GET", "/reviews");
  check("review assignments: every reviewer on P1 with names", r.body.assignments.length === 3 && r.body.assignments.some((a) => a.reviewer === "Dev Desk"));
  r = await as(U.editor, "GET", "/decisions");
  check("decisions on managed papers", r.body.total === 1 && r.body.decisions[0].decidedBy === "Eshan Editor");
  r = await as(U.editor, "GET", "/approvals");
  check("approvals → 403 (chair/admin only)", r.status === 403);
  r = await as(U.editor, "GET", "/volumes");
  check("volumes: drafts too (editor)", r.body.total === 2);
  r = await as(U.editor, "GET", "/publications");
  check("publications: P6 + scheduled P7", r.body.total === 2);
  r = await as(U.editor, "GET", "/activity", { query: { submission: P.P1.ref } });
  check("activity on P1: everything, with names", r.body.activity.some((a) => a.event === "ASSIGNED" && a.by === "Asha Admin") && r.body.activity.some((a) => a.event === "REVIEW_SUBMITTED"));
  r = await as(U.editor, "POST", `/submissions/${P.P1.id}/notes`, { key: rw.key, body: { note: "Chasing reviewer" } });
  check("write on own-edited paper → 201", r.status === 201);
  const n = await db.one(`SELECT actor, detail FROM \`${T.paperActivity}\` WHERE paper_id = ? AND action = 'AGENT_NOTE_ADDED'`, [P.P1.id]);
  const nd = typeof n.detail === "string" ? JSON.parse(n.detail) : n.detail;
  check("…recorded as the editor, on behalf of their email", n.actor === U.editor.id && nd.onBehalfOf === U.editor.email);
  r = await as(U.editor, "POST", `/submissions/${P.P2.id}/notes`, { key: rw.key, body: { note: "x" } });
  check("write on a paper they don't edit → 404", r.status === 404);
  r = await as(U.rev1, "POST", `/submissions/${P.P1.id}/notes`, { key: rw.key, body: { note: "x" } });
  check("reviewer write → 403", r.status === 403);
  r = await as(U.faculty, "POST", `/submissions/${P.P1.id}/status`, { key: rw.key, body: { status: "ARCHIVED" } });
  check("…and status change by a reviewer → 403, unchanged", r.status === 403 && (await db.one(`SELECT status FROM \`${T.papers}\` WHERE id = ?`, [P.P1.id])).status === "REVISION");

  // ---- Program Chair -------------------------------------------------------------------------------
  section("Program Chair — papers sent for final approval:");
  r = await as(U.chair, "GET", "/submissions");
  check("sees P1 + P3 (approval requests)", refs(r) === "ISDI-2026-0001,ISDI-2026-0003" && r.body.submissions.every((s) => s.myRoles.includes("PROGRAM_CHAIR")));
  r = await as(U.chair, "GET", "/approvals", { query: { status: "PENDING" } });
  check("pending approvals: P3 ACCEPT, requested by Asha Admin", r.body.total === 1 && r.body.approvals[0].submission.refId === P.P3.ref && r.body.approvals[0].requestedBy === "Asha Admin");
  r = await as(U.chair, "GET", `/submissions/${P.P3.ref}`);
  check("P3 → manager view with reviewers", r.body.submission.view === "manager" && r.body.submission.reviewers[0].name === "Rhea Reviewer");
  r = await as(U.chair, "GET", "/me");
  check("whoami: programChair + approvalsPending", r.body.actingAs.programChair === true && r.body.approvalsPending === 1);
  chairEmails.length = 0;
  r = await as(U.chair, "GET", "/submissions");
  check("email removed from the allowlist → no chair access at once", r.body.total === 0);
  r = await as(U.chair, "GET", "/approvals");
  check("…and approvals → 403", r.status === 403);
  chairEmails.push(U.chair.email);

  // ---- Administrator ---------------------------------------------------------------------------------
  section("Administrator — everything, but never manages their own paper:");
  r = await as(U.admin, "GET", "/submissions");
  check("sees all 7 papers", r.body.total === 7);
  r = await as(U.admin, "GET", `/submissions/${P.P5.ref}`);
  check("own P5 → owner view (reviewer hidden)", r.body.submission.view === "owner" && !JSON.stringify(r.body).includes("Ravi"));
  r = await as(U.admin, "GET", `/submissions/${P.P3.ref}`);
  check("other paper → manager view", r.body.submission.view === "manager");
  r = await as(U.admin, "POST", `/submissions/${P.P5.id}/notes`, { key: rw.key, body: { note: "x" } });
  check("write on own paper → 403", r.status === 403);
  r = await as(U.admin, "GET", "/reviews");
  check("review assignments: all except on own P5", r.body.assignments.length === 4 && !r.body.assignments.some((a) => a.submission.refId === P.P5.ref));
  r = await as(U.admin, "GET", "/users");
  check("people: faculty/students only, no emails, AIDC counted", r.body.people.length === 10 && !r.body.people.some((p) => p.name === "Aidc Author") && r.body.accounts.AUTHOR === 1 && !JSON.stringify(r.body).includes("@"));
  r = await as(U.admin, "GET", "/users", { query: { role: "PEER_REVIEWER" } });
  check("people filter by role", r.body.total === 3);
  r = await as(U.admin, "GET", "/stats/registrations");
  check("AIDC stats: numbers only", r.body.authors === 1 && r.body.byCurrentStatus.STUDENT === 1 && r.body.registrationsInProgress === 1 && r.body.papers.total === 1 && !JSON.stringify(r.body).includes("Pending Person") && !JSON.stringify(r.body).includes("+91"));
  r = await as(U.admin, "GET", "/achievements");
  check("achievements: everyone's, with faculty names", r.body.total === 3 && r.body.achievements.some((a) => a.faculty === "Farah Faculty"));
  r = await as(U.admin, "GET", "/stats/achievements");
  check("achievement stats: university-wide", r.body.total === 3 && r.body.byType.GRANT.amountInr === 600000 && r.body.scope === "all");

  // ---- AIDC author ------------------------------------------------------------------------------------
  section("AIDC external author:");
  r = await as(U.aidc, "GET", "/submissions");
  check("only own P4 (isAdmin=1 in the row ignored)", refs(r) === P.P4.ref);
  r = await as(U.aidc, "GET", "/me");
  check("whoami: not administrator, no roles", r.body.actingAs.administrator === false && r.body.actingAs.paperRoles.length === 0 && !("myAchievements" in r.body));

  // ---- Leaks + log --------------------------------------------------------------------------------------
  section("Never leaves the portal:");
  const leaked = allBodies.flatMap(leaks);
  check("no author names/emails, confidential comments/notes, file names in ANY acting-user response", leaked.length === 0, [...new Set(leaked)].join(", "));
  check("no user ids in ANY acting-user response", !allBodies.some((b) => Object.values(U).some((u) => JSON.stringify(b).includes(u.id))));

  section("Request log:");
  const logs = await db.query(`SELECT acting_email, status, action FROM \`${T.agentApiLog}\``);
  check("acting user recorded (lower-cased)", logs.some((l) => l.acting_email === U.student.email && l.status === 200));
  check("refused users recorded too", logs.some((l) => l.acting_email === "nobody@example.org" && l.status === 403 && l.action === "manifest"));
  check("key-only calls have no acting user", logs.some((l) => l.acting_email === null && l.status === 200));
} catch (e) {
  failures++;
  console.error("✗ Suite error:", e);
} finally {
  await db.end();
  await server.query(`DROP DATABASE \`${DB_NAME}\``);
  await server.end();
}

console.log(`\n${total - failures}/${total} checks passed${failures ? ` — ${failures} FAILED` : ""}.`);
process.exit(failures ? 1 : 0);
