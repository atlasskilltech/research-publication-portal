/**
 * Admin paper statistics — MySQL/MariaDB integration suite (lib/repos/paperStats.mjs).
 *
 * Safety: creates its OWN throwaway database `rpp_it_stats_<random>`, runs the
 * real migrations, seeds a known dataset and drops ONLY that database at the end.
 * Refuses non-local servers unless RPP_IT_ALLOW_REMOTE=yes.
 *
 *   npm run test:paper-stats   (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD of a LOCAL server)
 */
import mysql from "mysql2/promise";
import { createDb, createPool } from "../lib/db/core.mjs";
import { T } from "../lib/db/tables.mjs";
import { migrate } from "./db-migrate.mjs";
import { uuid } from "../lib/auth/crypto.mjs";
import { createRegisteredUser, createAuthorUser, setUserRoles } from "../lib/repos/users.mjs";
import { normalizeStatsQuery, statsSummary, userPaperStats, userPapers, displayRoles } from "../lib/repos/paperStats.mjs";

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
const DB_NAME = `rpp_it_stats_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const admin = await mysql.createConnection({ ...conn });
await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const db = createDb(createPool({ ...conn, database: DB_NAME, connectionLimit: 4 }));
const version = (await db.one("SELECT VERSION() AS v")).v;
console.log(`Paper statistics suite — ${version} — throwaway database ${DB_NAME}`);

// Count queries issued by the repository (N+1 guard).
let queries = 0;
const counted = { query: (...a) => { queries++; return db.query(...a); }, one: (...a) => { queries++; return db.one(...a); } };

const Q = (o = {}) => normalizeStatsQuery({ pageSize: "100", ...o });
const byEmail = (res, e) => res.users.find((u) => u.email === e);

try {
  await migrate(db, { log: () => {} });

  // ---- Fixture -------------------------------------------------------------
  const mk = (email, baseType = "FACULTY", name) => createRegisteredUser(db, { name: name || email.split("@")[0], email, baseType });
  const ADM = await mk("admin@atlasuniversity.edu.in", "FACULTY", "Ada Admin");
  await db.exec(`UPDATE \`${T.users}\` SET isAdmin = 1 WHERE id = ?`, [ADM]);
  await db.exec(`INSERT INTO \`${T.userRoles}\` (user_id, role) VALUES (?, 'ADMINISTRATOR')`, [ADM]);
  const STU = await mk("stu@atlasuniversity.edu.in", "STUDENT", "Sam Student");
  const FAC = await mk("fac@atlasuniversity.edu.in", "FACULTY", "Fay Faculty");
  const AUT = await db.transaction((tx) => createAuthorUser(tx, { name: "Aru Author", email: "aru@gmail.com", phone: "+91 90000 00000", organization: "NID", current_status: "RESEARCHER", designation: "R", location: "Pune" }));
  const POC = await mk("poc@atlasuniversity.edu.in", "FACULTY", "Pia POC");
  const REV = await mk("rev@atlasuniversity.edu.in", "FACULTY", "Ravi Reviewer");
  const REV2 = await mk("rev2@atlasuniversity.edu.in", "FACULTY", "Rhea Reviewer");
  const EDI = await mk("edi@atlasuniversity.edu.in", "FACULTY", "Eli Editor");
  const ZERO = await mk("zero@atlasuniversity.edu.in", "STUDENT", "Zed Zero");
  const grant = (id, roles) => db.transaction((tx) => setUserRoles(tx, { actorId: ADM, targetId: id, roles }));
  await grant(POC, ["SPOC"]);
  await grant(REV, ["DESK_REVIEWER", "PEER_REVIEWER"]);
  await grant(REV2, ["PEER_REVIEWER"]);
  await grant(EDI, ["EDITOR"]);

  const paper = async (title, status, submitter, authors = []) => {
    const id = uuid();
    await db.exec(`INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, status, submitted_by, current_round) VALUES (?, ?, 'a', '[]', ?, ?, 0)`, [id, title, status, submitter]);
    let i = 0;
    for (const a of authors) await db.exec(`INSERT INTO \`${T.paperAuthors}\` (id, paper_id, full_name, email, is_corresponding, author_order) VALUES (?, ?, ?, ?, ?, ?)`, [uuid(), id, a.name || "X", a.email ?? null, i === 0 ? 1 : 0, i++]);
    return id;
  };
  const assign = (pid, who, role) => db.exec(`INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by) VALUES (?, ?, ?, ?, ?)`, [uuid(), pid, who, role, ADM]);

  // P1: Student submits; Student ALSO listed as author; Faculty + Author co-authors (MULTIPLE AUTHORS).
  const P1 = await paper("P1 multi-author", "UNDER_REVIEW", STU, [{ email: "stu@atlasuniversity.edu.in" }, { email: "fac@atlasuniversity.edu.in" }, { email: "ARU@gmail.com" }, { name: "No email" }]);
  // P2: Faculty submits, accepted.
  const P2 = await paper("P2 faculty accepted", "ACCEPTED", FAC, [{ email: "fac@atlasuniversity.edu.in" }]);
  // P3: Author submits, rejected.
  const P3 = await paper("P3 author rejected", "REJECTED", AUT, [{ email: "aru@gmail.com" }]);
  // P4: Student submits, published (counts as accepted).
  const P4 = await paper("P4 student published", "PUBLISHED", STU, [{ email: "stu@atlasuniversity.edu.in" }]);
  // P5: Faculty submits, just submitted.
  const P5 = await paper("P5 faculty submitted", "SUBMITTED", FAC, []);
  // Assignments: POC on P1, P2, P5. REV as DESK + PEER on P1 (MULTIPLE ASSIGNMENTS, same paper), PEER on P3.
  for (const p of [P1, P2, P5]) await assign(p, POC, "SPOC");
  await assign(P1, REV, "DESK_REVIEWER");
  await assign(P1, REV, "PEER_REVIEWER");
  await assign(P3, REV, "PEER_REVIEWER");
  await assign(P1, REV2, "PEER_REVIEWER"); // second reviewer on the same paper
  await assign(P2, EDI, "EDITOR");
  await assign(P1, EDI, "EDITOR");

  // ---- Summary ---------------------------------------------------------------
  section("Summary cards (actual database records)");
  const s = await statsSummary(db);
  check("total papers = 5", s.totalPapers === 5, JSON.stringify(s));
  check("under review = 1 (P1)", s.underReview === 1);
  check("accepted = 2 (P2 accepted + P4 published)", s.accepted === 2);
  check("Author accounts = 1", s.authorAccounts === 1);
  check("users who authored papers = 3 (student, faculty, author)", s.usersWithPapers === 3);
  check("reviewers = 2 (desk/peer role holders)", s.reviewers === 2);
  check("POCs = 1 (SPOC role holders)", s.pocs === 1);

  // ---- Per-user counts ---------------------------------------------------------
  section("User-wise counts");
  queries = 0;
  const all = await userPaperStats(counted, Q());
  check("one page = exactly 2 queries (aggregate + roles), no N+1", queries === 2, `${queries}`);
  check("every user listed, incl. zero-paper users", all.total === 9 && all.users.length === 9);
  const stu = byEmail(all, "stu@atlasuniversity.edu.in");
  check("Student: submitted 2 (P1, P4) — P1 counted once though submitter AND listed author", stu.submitted === 2 && stu.total === 2, JSON.stringify(stu));
  check("Student: under review 1, accepted 1 (published), rejected 0, assigned 0", stu.underReview === 1 && stu.accepted === 1 && stu.rejected === 0 && stu.assigned === 0);
  const fac = byEmail(all, "fac@atlasuniversity.edu.in");
  check("Faculty: 3 papers (co-author on P1, submitted P2 + P5)", fac.submitted === 3 && fac.total === 3 && fac.accepted === 1 && fac.underReview === 1, JSON.stringify(fac));
  const aut = byEmail(all, "aru@gmail.com");
  check("Author: 2 papers (co-author on P1 by case-insensitive email, submitted P3)", aut.submitted === 2 && aut.total === 2 && aut.rejected === 1, JSON.stringify(aut));
  const poc = byEmail(all, "poc@atlasuniversity.edu.in");
  check("POC (SPOC assignments): assigned 3, total 3, submitted 0", poc.assigned === 3 && poc.total === 3 && poc.submitted === 0, JSON.stringify(poc));
  const rev = byEmail(all, "rev@atlasuniversity.edu.in");
  check("Reviewer: DESK + PEER on P1 counted once → assigned 2 (P1, P3)", rev.assigned === 2 && rev.total === 2 && rev.underReview === 1 && rev.rejected === 1, JSON.stringify(rev));
  const rev2 = byEmail(all, "rev2@atlasuniversity.edu.in");
  check("second reviewer on the same paper counted independently (1)", rev2.assigned === 1 && rev2.total === 1);
  const edi = byEmail(all, "edi@atlasuniversity.edu.in");
  check("Editor: assigned 2 (P1, P2)", edi.assigned === 2 && edi.total === 2 && edi.accepted === 1);
  const zero = byEmail(all, "zero@atlasuniversity.edu.in");
  check("zero-paper user shown with all zeros", zero && zero.total === 0 && zero.submitted === 0 && zero.assigned === 0);
  check("role labels", JSON.stringify(poc.roles) === '["Faculty","POC"]' && JSON.stringify(rev.roles) === '["Faculty","Reviewer"]' && JSON.stringify(aut.roles) === '["Author"]' && byEmail(all, "admin@atlasuniversity.edu.in").roles.includes("Admin"));
  check("default sort: total papers descending", all.users.every((u, i, a) => i === 0 || a[i - 1].total >= u.total));

  section("Filters, search, sort, pagination");
  const st = await userPaperStats(db, Q({ status: "UNDER_REVIEW" }));
  check("status filter UNDER_REVIEW: Student 1, Faculty 1, Reviewer 1 (only P1 counted)", byEmail(st, "stu@atlasuniversity.edu.in").total === 1 && byEmail(st, "fac@atlasuniversity.edu.in").total === 1 && byEmail(st, "rev@atlasuniversity.edu.in").total === 1);
  check("…users without papers in that status still listed with 0", byEmail(st, "zero@atlasuniversity.edu.in")?.total === 0 && byEmail(st, "admin@atlasuniversity.edu.in")?.total === 0);
  const rej = await userPaperStats(db, Q({ status: "REJECTED", includeZero: "0" }));
  check("status REJECTED + hide zero → only Author and Reviewer", rej.total === 2 && rej.users.map((u) => u.email).sort().join() === "aru@gmail.com,rev@atlasuniversity.edu.in");
  const nz = await userPaperStats(db, Q({ includeZero: "0" }));
  check("hide zero-paper users → 7 users", nz.total === 7 && !byEmail(nz, "zero@atlasuniversity.edu.in"));
  const se = await userPaperStats(db, Q({ search: "Reviewer" }));
  check("search by name", se.total === 2 && se.users.every((u) => /Reviewer/.test(u.name)));
  const se2 = await userPaperStats(db, Q({ search: "ARU@GMAIL" }));
  check("search by email, case-insensitive", se2.total === 1 && se2.users[0].email === "aru@gmail.com");
  const se3 = await userPaperStats(db, Q({ search: "%" }));
  check("LIKE wildcards in search are escaped", se3.total === 0);
  for (const [role, expect] of [["STUDENT", ["stu@atlasuniversity.edu.in", "zero@atlasuniversity.edu.in"]], ["AUTHOR", ["aru@gmail.com"]], ["POC", ["poc@atlasuniversity.edu.in"]],
    ["REVIEWER", ["rev2@atlasuniversity.edu.in", "rev@atlasuniversity.edu.in"]], ["EDITOR", ["edi@atlasuniversity.edu.in"]], ["ADMIN", ["admin@atlasuniversity.edu.in"]]]) {
    const r = await userPaperStats(db, Q({ role }));
    check(`role filter ${role}`, JSON.stringify(r.users.map((u) => u.email).sort()) === JSON.stringify([...expect].sort()), r.users.map((u) => u.email).join());
  }
  const fa = await userPaperStats(db, Q({ role: "FACULTY" }));
  check("role filter FACULTY = Faculty base type (6 incl. admin/POC/reviewers/editor)", fa.total === 6);
  const asc = await userPaperStats(db, Q({ sort: "total_asc" }));
  check("sort total ascending", asc.users.every((u, i, a) => i === 0 || a[i - 1].total <= u.total) && asc.users[0].total === 0);
  const nm = await userPaperStats(db, Q({ sort: "name_asc" }));
  check("sort by name", nm.users[0].name === "Ada Admin", nm.users.map((u) => u.name).join(", "));
  const p1 = await userPaperStats(db, normalizeStatsQuery({ pageSize: "4", page: "1" }));
  const p3 = await userPaperStats(db, normalizeStatsQuery({ pageSize: "4", page: "3" }));
  check("pagination: total 9, page 1 has 4, page 3 has 1", p1.total === 9 && p1.users.length === 4 && p3.users.length === 1 && p3.total === 9);
  const ids = new Set([...p1.users, ...(await userPaperStats(db, normalizeStatsQuery({ pageSize: "4", page: "2" }))).users, ...p3.users].map((u) => u.id));
  check("pages don't overlap and cover everyone", ids.size === 9);
  check("past the last page → empty, total 0", (await userPaperStats(db, normalizeStatsQuery({ pageSize: "4", page: "9" }))).users.length === 0);
  const bad = normalizeStatsQuery({ role: "x'; DROP TABLE", status: "nope", sort: "1; --", pageSize: "100000", page: "-5" });
  check("unknown role/status/sort ignored, page size clamped to 100, page ≥ 1", bad.role === "" && bad.status === "" && bad.sort === "total_desc" && bad.pageSize === 100 && bad.page === 1);

  section("User detail view");
  queries = 0;
  const d = await userPapers(counted, STU, {});
  check("detail = constant number of queries (3)", queries === 3, `${queries}`);
  check("Student detail: 2 papers, P1 shows Submitter + Co-author once", d.total === 2 && d.papers.find((p) => p.id === P1)?.relationships.join() === "CO_AUTHOR,SUBMITTER");
  check("paper fields: id, title, status, submitted, updated", d.papers.every((p) => p.id && p.title && p.status && p.submittedAt && p.updatedAt));
  const dr = await userPapers(db, REV, {});
  check("Reviewer detail: P1 = Desk + Peer reviewer (one row), P3 = Peer reviewer", dr.total === 2 && dr.papers.find((p) => p.id === P1).relationships.join() === "DESK_REVIEWER,PEER_REVIEWER" && dr.papers.find((p) => p.id === P3).relationshipLabels.join() === "Peer reviewer");
  const dp = await userPapers(db, POC, {});
  check("POC detail: 3 papers labelled POC", dp.total === 3 && dp.papers.every((p) => p.relationshipLabels.join() === "POC"));
  const da = await userPapers(db, AUT, { status: "REJECTED" });
  check("detail status filter", da.total === 1 && da.papers[0].id === P3);
  const dz = await userPapers(db, ZERO, {});
  check("zero-paper user detail → empty list", dz.total === 0 && dz.papers.length === 0);
  check("unknown user → null", (await userPapers(db, "nope", {})) === null);
  const dpg = await userPapers(db, POC, { page: 2, pageSize: 2 });
  check("detail pagination", dpg.total === 3 && dpg.papers.length === 1);

  section("Read-only");
  const counts = async () => JSON.stringify(await Promise.all([T.papers, T.paperAuthors, T.paperAssignments, T.users, T.userRoles].map(async (t) => Number((await db.one(`SELECT COUNT(*) AS n FROM \`${t}\``)).n))));
  const before = await counts();
  await userPaperStats(db, Q()); await statsSummary(db); await userPapers(db, STU, {});
  check("no rows written by any statistics query", (await counts()) === before);
  check("displayRoles", JSON.stringify(displayRoles("STUDENT", false, ["PEER_REVIEWER", "SPOC"])) === '["Student","POC","Reviewer"]');
} catch (e) {
  failures++;
  console.error("✗ suite aborted:", e.stack || e.message);
} finally {
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await admin.end();
  console.log(`\n(throwaway database ${DB_NAME} dropped)`);
}
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${total - failures}/${total} checks (${version})`);
process.exit(failures === 0 ? 0 : 1);
