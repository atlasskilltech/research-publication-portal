/**
 * MySQL integration suite — EXECUTES the real data layer against a real
 * MySQL/MariaDB server (replaces the old PGlite SQL suites).
 *
 * Safety: creates its OWN throwaway database `rpp_it_<random>`, runs the real
 * migrations into it, and drops ONLY that database at the end. It never touches
 * the configured application database. Refuses non-local servers unless
 * RPP_IT_ALLOW_REMOTE=yes.
 *
 *   npm run test:mysql            (uses DB_HOST/DB_PORT/DB_USER/DB_PASSWORD; needs CREATE DATABASE on a LOCAL server)
 *   IT_DB_HOST/IT_DB_USER/IT_DB_PASSWORD/IT_DB_PORT override the connection for the suite.
 */
import mysql from "mysql2/promise";
import { createDb, createPool, toDate } from "../lib/db/core.mjs";
import { T, OWN_TABLES } from "../lib/db/tables.mjs";
import { migrate, listMigrations, preflight, readHistory } from "./db-migrate.mjs";
import { helpers } from "../database/migrate-helpers.mjs";
import { hashPassword, verifyPassword } from "../lib/auth/password.mjs";
import { createSession, readSession, revokeSession, revokeAllSessions, issueToken, consumeToken, sessionPolicy } from "../lib/auth/store.mjs";
import { sha256Hex, uuid } from "../lib/auth/crypto.mjs";
import {
  createRegisteredUser, findUserById, findUserByEmail, findCredentials, findUserByApplicationNo, setUserRoles, deleteUser,
  rolesFor, listUsersWithRoles, setPasswordHash,
} from "../lib/repos/users.mjs";
import { jrow, jrows, logActivity } from "../lib/repos/rows.mjs";
import * as wf from "../lib/services/workflow.mjs";
import { mapRpcError } from "../lib/revisionLogic.js";
import { uniqueViolationMessage } from "../lib/publicationLogic.js";
import bcrypt from "bcryptjs";

let failures = 0, total = 0;
const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);
async function rpp(p) { try { await p; return "OK"; } catch (e) { return (String(e.message).match(/RPP[:_]([A-Z_]+)/) || [])[1] || e.code || e.message; } }

const env = process.env;
const conn = {
  host: env.IT_DB_HOST || env.DB_HOST || "localhost",
  port: Number(env.IT_DB_PORT || env.DB_PORT || 3306),
  user: env.IT_DB_USER || env.DB_USER || "root",
  password: env.IT_DB_PASSWORD ?? env.IT_DB_PASS ?? env.DB_PASSWORD ?? env.DB_PASS ?? "",
};
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(conn.host) && env.RPP_IT_ALLOW_REMOTE !== "yes") {
  console.error(`Refusing to create a test database on non-local host ${conn.host}. Set RPP_IT_ALLOW_REMOTE=yes to override.`);
  process.exit(2);
}
const DB_NAME = `rpp_it_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const admin = await mysql.createConnection({ ...conn });
await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const db = createDb(createPool({ ...conn, database: DB_NAME, connectionLimit: 8 }));
console.log(`MySQL integration suite — throwaway database ${DB_NAME} on ${conn.host}`);

try {
  // ---- DB core -------------------------------------------------------------------------------
  section("Shared database safety (simulated Employment Survey tables)");
  // Another application's tables + data, a foreign research_* table, and a NAME COLLISION.
  await db.query("CREATE TABLE `employment_responses` (id INT PRIMARY KEY, answer VARCHAR(50)) ENGINE=InnoDB");
  await db.exec("INSERT INTO `employment_responses` VALUES (1, 'keep me'), (2, 'and me')");
  await db.query("CREATE TABLE `research_survey_notes` (id INT PRIMARY KEY, note VARCHAR(50)) ENGINE=InnoDB");
  await db.exec("INSERT INTO `research_survey_notes` VALUES (7, 'not RPP')");
  await db.query(`CREATE TABLE \`${T.papers}\` (id INT PRIMARY KEY, survey_col VARCHAR(10)) ENGINE=InnoDB`);
  await db.exec(`INSERT INTO \`${T.papers}\` VALUES (42, 'foreign')`);
  const pf1 = await preflight(db);
  check("preflight detects the name collision on research_papers", !pf1.ok && pf1.collisions.some((c) => c.startsWith(T.papers)), pf1.collisions.join("; "));
  check("preflight reports the foreign research_* table without claiming it", pf1.foreignResearchTables.includes("research_survey_notes"));
  check("status/preflight is read-only (no history table created)", !(await readHistory(db)).size && !(await db.one("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [T.schemaMigrations])));
  check("migrate refuses on collision", /COLLISION/.test(await rpp(migrate(db, { log: () => {} }))));
  const after = await db.query("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()");
  check("…and created NOTHING (no RPP table, no history)", after.length === 3, after.map((r) => r.n).join());
  check("…and the colliding foreign table is untouched", (await db.one(`SELECT survey_col FROM \`${T.papers}\` WHERE id = 42`))?.survey_col === "foreign");
  await db.query(`DROP TABLE \`${T.papers}\``); // remove the simulated collision (created by this test)

  section("Connection + migrations");
  const applied = await migrate(db, { log: () => {} });
  check("other applications' tables + rows untouched by a full migration",
    JSON.stringify(await db.query("SELECT id, answer FROM `employment_responses` ORDER BY id")) === JSON.stringify([{ id: 1, answer: "keep me" }, { id: 2, answer: "and me" }])
      && (await db.one("SELECT note FROM `research_survey_notes` WHERE id = 7")).note === "not RPP");
  const created = (await db.query("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()")).map((r) => r.n);
  check("every RPP table is research_-prefixed and in the canonical list", OWN_TABLES.every((t) => t.startsWith("research_") && created.includes(t)) && created.filter((n) => !OWN_TABLES.includes(n)).sort().join() === "employment_responses,research_survey_notes");
  const objNames = await db.query(
    `SELECT index_name AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN (?) AND index_name <> 'PRIMARY'
     UNION SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name IN (?) AND constraint_type <> 'PRIMARY KEY'`,
    [OWN_TABLES, OWN_TABLES]);
  // MariaDB (not MySQL 8) implicitly adds a column-level CHECK (json_valid(col)) named after each JSON
  // column; those are table-scoped (cannot collide across apps) and are the ONLY allowed exception.
  const implicit = new Set((await db.query(
    "SELECT cc.constraint_name AS n FROM information_schema.check_constraints cc WHERE cc.constraint_schema = DATABASE() AND cc.check_clause LIKE '%json_valid%'")).map((r) => r.n));
  const unprefixed = objNames.filter((r) => !r.n.startsWith("research_")).map((r) => r.n);
  check("every declared index / unique / FK / CHECK name is research_-prefixed", objNames.length > 60 && unprefixed.every((n) => implicit.has(n) && ["keywords", "detail", "review_ids", "responses", "authors"].includes(n)), unprefixed.join());
  check("all migrations apply to an empty database", applied.length === listMigrations().length, applied.join(", "));
  check("re-running is a no-op (history respected)", (await migrate(db, { log: () => {} })).length === 0);
  for (const f of listMigrations()) {
    const mod = await import(new URL(`../database/migrations/${f}`, import.meta.url).href);
    let ok = true; try { await mod.up(helpers(db)); } catch { ok = false; }
    check(`${f}: up() is idempotent when re-run directly`, ok);
  }
  const s = await db.one("SELECT @@session.time_zone AS tz, @@session.sql_mode AS mode");
  check("pooled connections pinned to UTC", s.tz === "+00:00");
  check("pooled connections use strict sql_mode (same as Atlas Forge)", /STRICT_TRANS_TABLES/.test(s.mode));
  const engines = await db.query("SELECT table_name AS n, engine AS e, table_collation AS c FROM information_schema.tables WHERE table_schema = DATABASE()");
  check("every table is InnoDB + utf8mb4", engines.length >= 18 && engines.every((t) => t.e === "InnoDB" && /^utf8mb4/.test(t.c)), engines.filter((t) => t.e !== "InnoDB").map((t) => t.n).join());
  const fks = Number((await db.one("SELECT COUNT(*) AS n FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE()")).n);
  check("all 32 foreign keys created (5 auth, 18 workflow, 9 publication)", fks === 32, `${fks}`);
  const when = new Date("2026-03-04T05:06:07.089Z");
  await db.exec(`INSERT INTO \`${T.oauthStates}\` (state_hash, nonce, code_verifier, next_path, expires_at) VALUES (?, 'n', 'v', '/', ?)`, ["0".repeat(64), when]);
  const rt = await db.one(`SELECT expires_at AS d, created_at AS c, CAST(? AS DATE) AS dd FROM \`${T.oauthStates}\` WHERE state_hash = ?`, ["2026-03-04", "0".repeat(64)]);
  check("DATETIME(3) round-trips exactly as UTC ISO; DATE as YYYY-MM-DD", rt.d === "2026-03-04T05:06:07.089Z" && rt.dd === "2026-03-04", `${rt.d} ${rt.dd}`);
  check("server-side defaults (CURRENT_TIMESTAMP) are UTC", Math.abs(Date.parse(rt.c) - Date.now()) < 120_000, rt.c);
  await db.exec(`DELETE FROM \`${T.oauthStates}\` WHERE state_hash = ?`, ["0".repeat(64)]);
  check("parameterized queries: injection payload is just data", (await db.one(`SELECT ? AS v`, ["x' OR '1'='1"])).v === "x' OR '1'='1");

  // ---- Passwords -------------------------------------------------------------------------------
  section("Password hashing");
  const h = await hashPassword("Correct#Horse2026");
  check("Argon2id format with OWASP params", /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/.test(h));
  check("correct password verifies; no rehash needed", JSON.stringify(await verifyPassword(h, "Correct#Horse2026")) === '{"ok":true,"needsRehash":false}');
  check("wrong password rejected", (await verifyPassword(h, "wrong-password")).ok === false);
  const bc = await bcrypt.hash("Legacy#Pass2026", 10);
  const legacy = await verifyPassword(bc, "Legacy#Pass2026");
  check("legacy bcrypt verifies and requests upgrade", legacy.ok && legacy.needsRehash);
  check("garbage / plaintext stored value never verifies", !(await verifyPassword("Legacy#Pass2026", "Legacy#Pass2026")).ok && !(await verifyPassword(null, "x")).ok);

  // ---- Users -----------------------------------------------------------------------------------
  section("Users, registration constraints");
  const mk = async (email, extra = {}) => createRegisteredUser(db, { name: email.split("@")[0], email, baseType: "STUDENT", ...extra });
  const studentId = await mk("Student.One@AtlasUniversity.edu.in", { applicationNo: "AB12345" });
  const st = await findUserById(db, studentId);
  check("registered account: non-admin, unverified, no password, email normalised", st.is_admin === false && !st.email_confirmed_at && !st.has_password && st.email === "student.one@atlasuniversity.edu.in");
  check("no role is written at registration", (await rolesFor(db, studentId)).length === 0);
  check("duplicate email (any case) → ER_DUP_ENTRY", (await rpp(mk("STUDENT.ONE@atlasuniversity.edu.in"))) === "ER_DUP_ENTRY");
  check("duplicate application number (case-insensitive) → ER_DUP_ENTRY", (await rpp(mk("other@atlasuniversity.edu.in", { applicationNo: "ab12345" }))) === "ER_DUP_ENTRY");
  check("lookup by application number", (await findUserByApplicationNo(db, "AB12345"))?.id === studentId);
  check("findCredentials exposes the hash only to sign-in code", (await findCredentials(db, "student.one@atlasuniversity.edu.in")).password_hash === null && !("password_hash" in (await findUserByEmail(db, "student.one@atlasuniversity.edu.in"))));

  // ---- Sessions ---------------------------------------------------------------------------------
  section("Sessions (creation, expiry, idle, revocation, purpose, status)");
  const pol = { ...sessionPolicy({}), touchEveryMs: 0 };
  const sess = await createSession(db, studentId, { purpose: "APP", method: "password", policy: pol });
  const stored = await db.one(`SELECT tokenHash FROM \`${T.sessions}\` WHERE id = ?`, [sess.id]);
  check("only the SHA-256 of the cookie token is stored", stored.tokenHash === sha256Hex(sess.token) && stored.tokenHash !== sess.token);
  check("valid session resolves to the user", (await readSession(db, sess.token, { policy: pol }))?.user_id === studentId);
  check("unknown / malformed token → null", (await readSession(db, "x".repeat(43), { policy: pol })) === null && (await readSession(db, "short", { policy: pol })) === null);
  check("absolute expiry enforced (7 days)", (await readSession(db, sess.token, { policy: pol, now: Date.now() + pol.absoluteMs + 1000 })) === null);
  const idle = await createSession(db, studentId, { policy: pol, now: Date.now() - pol.idleMs - 60_000 });
  check("idle timeout enforced (3 days without activity)", (await readSession(db, idle.token, { policy: pol })) === null);
  const setup = await createSession(db, studentId, { purpose: "SETUP", policy: pol });
  check("SETUP session is NOT accepted as an app session", (await readSession(db, setup.token, { policy: pol })) === null);
  check("SETUP session accepted where explicitly allowed, expires in 30 min", (await readSession(db, setup.token, { purposes: ["SETUP"], policy: pol }))?.purpose === "SETUP" && (await readSession(db, setup.token, { purposes: ["SETUP"], policy: pol, now: Date.now() + 31 * 60_000 })) === null);
  await revokeSession(db, sess.token);
  check("revoked session → null (logout)", (await readSession(db, sess.token, { policy: pol })) === null);
  const s2 = await createSession(db, studentId, { policy: pol });
  const s3 = await createSession(db, studentId, { policy: pol });
  check("revokeAllSessions revokes every live session (password change)", (await revokeAllSessions(db, studentId)) >= 2 && !(await readSession(db, s2.token, { policy: pol })) && !(await readSession(db, s3.token, { policy: pol })));
  const s4 = await createSession(db, studentId, { policy: pol });
  await db.exec(`UPDATE \`${T.users}\` SET status = 'DISABLED' WHERE id = ?`, [studentId]);
  check("DISABLED account → existing sessions stop working", (await readSession(db, s4.token, { policy: pol })) === null);
  await db.exec(`UPDATE \`${T.users}\` SET status = 'ACTIVE' WHERE id = ?`, [studentId]);

  // ---- One-time tokens ------------------------------------------------------------------------------
  section("Email verification / reset tokens");
  const t1 = await issueToken(db, studentId, "INVITE");
  check("token is 256-bit hex; only its hash is stored", /^[a-f0-9]{64}$/.test(t1) && !!(await db.one(`SELECT 1 AS x FROM \`${T.authTokens}\` WHERE token_hash = ?`, [sha256Hex(t1)])) && !(await db.one(`SELECT 1 AS x FROM \`${T.authTokens}\` WHERE token_hash = ?`, [t1])));
  check("wrong purpose → invalid (invite can't be used as recovery)", (await consumeToken(db, t1, ["RECOVERY"])).error === "invalid");
  check("consumed once → user id", (await consumeToken(db, t1, ["INVITE"])).userId === studentId);
  check("second use → expired (single use)", (await consumeToken(db, t1, ["INVITE"])).error === "expired");
  const t2 = await issueToken(db, studentId, "RECOVERY");
  const t3 = await issueToken(db, studentId, "RECOVERY");
  check("a newer token invalidates the older one", (await consumeToken(db, t2, ["RECOVERY"])).error === "expired" && (await consumeToken(db, t3, ["RECOVERY"])).userId === studentId);
  const t4 = await issueToken(db, studentId, "RECOVERY", { now: Date.now() - 2 * 3600_000 });
  check("expired token (1 h recovery) → expired", (await consumeToken(db, t4, ["RECOVERY"])).error === "expired");
  const t5 = await issueToken(db, studentId, "INVITE");
  const race = await Promise.all([1, 2, 3, 4].map(() => db.transaction((tx) => consumeToken(tx, t5, ["INVITE"]))));
  check("4 concurrent uses of one token → exactly one succeeds", race.filter((r) => r.userId).length === 1, JSON.stringify(race));
  check("non-hex token rejected before any query", (await consumeToken(db, "../../etc", ["INVITE"])).error === "invalid");

  // ---- Roles --------------------------------------------------------------------------------------------
  section("Roles and administrator guards");
  const adminA = await mk("admin.a@atlasuniversity.edu.in", { baseType: "FACULTY" });
  const adminB = await mk("admin.b@atlasuniversity.edu.in", { baseType: "FACULTY" });
  await db.exec(`UPDATE \`${T.users}\` SET isAdmin = 1 WHERE id IN (?)`, [[adminA, adminB]]);
  await db.exec(`INSERT INTO \`${T.userRoles}\` (user_id, role) VALUES (?, 'ADMINISTRATOR'), (?, 'ADMINISTRATOR')`, [adminA, adminB]);
  const editor = await mk("editor@atlasuniversity.edu.in", { baseType: "FACULTY" });
  const reviewer = await mk("reviewer@atlasuniversity.edu.in", { baseType: "FACULTY" });
  const reviewer2 = await mk("reviewer2@atlasuniversity.edu.in", { baseType: "FACULTY" });
  const roles = (actor, target, r, prot = []) => db.transaction((tx) => setUserRoles(tx, { actorId: actor, targetId: target, roles: r, protectedEmails: prot }));
  check("non-admin cannot assign roles (even to others) → FORBIDDEN", (await rpp(roles(studentId, editor, ["EDITOR"]))) === "FORBIDDEN");
  check("nobody can change their own roles → SELF", (await rpp(roles(adminA, adminA, []))) === "SELF");
  check("invalid role → INVALID_ROLE", (await rpp(roles(adminA, editor, ["SUPERUSER"]))) === "INVALID_ROLE");
  const r1 = await roles(adminA, editor, ["EDITOR"]);
  check("admin grants EDITOR; isAdmin unchanged", r1.roles.join() === "EDITOR" && r1.is_admin === false && (await findUserById(db, editor)).is_admin === false);
  await roles(adminA, reviewer, ["PEER_REVIEWER"]);
  await roles(adminA, reviewer2, ["PEER_REVIEWER", "DESK_REVIEWER"]);
  const promo = await roles(adminA, studentId, ["ADMINISTRATOR"]);
  check("granting ADMINISTRATOR sets isAdmin atomically", promo.is_admin && (await findUserById(db, studentId)).is_admin === true);
  const demo = await roles(adminA, studentId, []);
  check("removing ADMINISTRATOR clears isAdmin (base type untouched)", !demo.is_admin && (await findUserById(db, studentId)).is_admin === false && (await findUserById(db, studentId)).base_type === "STUDENT");
  check("protected admin cannot be demoted → PROTECTED", (await rpp(roles(adminA, adminB, [], ["admin.b@atlasuniversity.edu.in"]))) === "PROTECTED");
  // Concurrency: two admins demote EACH OTHER at the same time → one must stay.
  const both = await Promise.all([rpp(roles(adminA, adminB, [])), rpp(roles(adminB, adminA, []))]);
  const admins = Number((await db.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE isAdmin = 1`)).n);
  check("concurrent mutual demotion → at least one admin remains", admins >= 1 && both.filter((x) => x === "OK").length <= 1, `${both} → ${admins} admin(s)`);
  const lastAdmin = (await db.one(`SELECT id FROM \`${T.users}\` WHERE isAdmin = 1 LIMIT 1`)).id;
  check("last admin cannot be deleted → LAST_ADMIN", (await rpp(db.transaction((tx) => deleteUser(tx, lastAdmin)))) === "LAST_ADMIN");
  const roleRows = await db.query(`SELECT r.user_id FROM \`${T.userRoles}\` r JOIN \`${T.users}\` u ON u.id = r.user_id WHERE r.role = 'ADMINISTRATOR' AND u.isAdmin = 0`);
  check("ADMINISTRATOR role rows always mirror isAdmin", roleRows.length === 0);
  check("user listing returns roles", (await listUsersWithRoles(db)).find((u) => u.id === reviewer2).roles.join() === "DESK_REVIEWER,PEER_REVIEWER");
  // Re-promote so the workflow has an admin besides lastAdmin.
  const manager = lastAdmin;

  // ---- Workflow --------------------------------------------------------------------------------------------------------
  section("Workflow: submission → review → decision → revision → re-review → accept → publish");
  const author = await mk("author@atlasuniversity.edu.in");
  const paperId = uuid();
  await db.transaction(async (tx) => {
    await tx.exec(`INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, school_code, status, submitted_by, current_round) VALUES (?, ?, ?, ?, NULL, 'SUBMITTED', ?, 0)`,
      [paperId, "On MySQL", "Abstract", JSON.stringify(["db", "migration"]), author]);
    await tx.exec(`INSERT INTO \`${T.paperAuthors}\` (id, paper_id, full_name, email, affiliation, is_corresponding, author_order) VALUES (?, ?, 'A. Author', 'author@atlasuniversity.edu.in', 'ATLAS', 1, 0)`, [uuid(), paperId]);
    await tx.exec(`INSERT INTO \`${T.paperManuscripts}\` (id, paper_id, version, storage_key, original_filename, mime_type, byte_size, sha256, uploaded_by) VALUES (?, ?, 0, ?, 'paper.pdf', 'application/pdf', 1234, ?, ?)`,
      [uuid(), paperId, `${"a".repeat(32)}.pdf`, "b".repeat(64), author]);
    await logActivity(tx, paperId, author, "SUBMITTED", { authors: 1 });
  });
  const p0 = jrow(await db.one(`SELECT * FROM \`${T.papers}\` WHERE id = ?`, [paperId]));
  check("paper stored; JSON keywords parsed back to an array", Array.isArray(p0.keywords) && p0.keywords.join() === "db,migration");
  check("duplicate manuscript version rejected (unique paper+version)", (await rpp(db.exec(`INSERT INTO \`${T.paperManuscripts}\` (id, paper_id, version, storage_key, mime_type, byte_size, sha256) VALUES (?, ?, 0, 'k2.pdf', 'application/pdf', 1, ?)`, [uuid(), paperId, "c".repeat(64)]))) === "ER_DUP_ENTRY");
  check("FK: manuscript for a non-existent paper rejected", (await rpp(db.exec(`INSERT INTO \`${T.paperManuscripts}\` (id, paper_id, version, storage_key, mime_type, byte_size, sha256) VALUES (?, ?, 0, 'k3.pdf', 'application/pdf', 1, ?)`, [uuid(), uuid(), "d".repeat(64)]))) === "ER_NO_REFERENCED_ROW_2");

  await db.exec(`INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by) VALUES (?, ?, ?, 'PEER_REVIEWER', ?), (?, ?, ?, 'EDITOR', ?)`,
    [uuid(), paperId, reviewer, manager, uuid(), paperId, editor, manager]);
  await db.exec(`UPDATE \`${T.papers}\` SET status = 'UNDER_REVIEW' WHERE id = ?`, [paperId]);
  check("CHECK: a SUBMITTED review must be complete", (await rpp(db.exec(`INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status) VALUES (?, ?, ?, 0, 'SUBMITTED')`, [uuid(), paperId, reviewer]))) !== "OK");
  check("CHECK: scores must be 1–5", (await rpp(db.exec(`INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status, technical_quality) VALUES (?, ?, ?, 0, 'DRAFT', 9)`, [uuid(), paperId, reviewer]))) !== "OK");
  const review0 = uuid();
  const submitReview = (id, round, rec) => db.exec(
    `INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status, recommendation, technical_quality, originality, methodology, clarity, comments_to_author, confidential_to_editor, submitted_at)
     VALUES (?, ?, ?, ?, 'SUBMITTED', ?, 4, 4, 3, 5, 'to author', 'secret', ?)`, [id, paperId, reviewer, round, rec, new Date()]);
  await submitReview(review0, 0, "MAJOR_REVISION");
  check("one review per reviewer per round (unique)", (await rpp(db.exec(`INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round) VALUES (?, ?, ?, 0)`, [uuid(), paperId, reviewer]))) === "ER_DUP_ENTRY");

  // Decisions
  const dec = (who, extra) => wf.saveEditorialDecision(db, { paperId, actorId: who, decision: "MAJOR_REVISION", summary: "Please revise", note: "conf", reviewIds: [review0], dueAt: "2026-12-01T00:00:00Z", ...extra });
  check("author cannot decide on own paper → FORBIDDEN", (await rpp(dec(author))) === "FORBIDDEN");
  check("reviewer cannot decide → FORBIDDEN", (await rpp(dec(reviewer))) === "FORBIDDEN");
  check("revision decision needs released reviews → NO_REVIEWS", (await rpp(dec(editor, { reviewIds: [] }))) === "NO_REVIEWS");
  check("unknown review id → BAD_REVIEWS", (await rpp(dec(editor, { reviewIds: [uuid()] }))) === "BAD_REVIEWS");
  check("blank summary → NO_SUMMARY", (await rpp(dec(editor, { summary: "   " }))) === "NO_SUMMARY");
  const d1 = await dec(editor);
  check("paper EDITOR saves a draft decision (version 1, round 0)", d1.version === 1 && d1.round === 0);
  const d2 = await dec(editor, { summary: "Please revise (v2)" });
  check("re-saving bumps the version", d2.id === d1.id && d2.version === 2);
  check("release with a stale version → STALE", (await rpp(wf.releaseEditorialDecision(db, { paperId, actorId: editor, decisionId: d1.id, expectedVersion: 1 }))) === "STALE");
  const rel = await Promise.all([1, 2].map(() => rpp(wf.releaseEditorialDecision(db, { paperId, actorId: editor, decisionId: d1.id, expectedVersion: 2 }))));
  check("two concurrent releases → exactly one communicates", rel.filter((x) => x === "OK").length === 1, rel.join());
  const p1 = await db.one(`SELECT status, current_round FROM \`${T.papers}\` WHERE id = ?`, [paperId]);
  const rev1 = jrow(await db.one(`SELECT * FROM \`${T.paperRevisions}\` WHERE paper_id = ?`, [paperId]));
  check("MAJOR_REVISION → paper REVISION + revision round 1 with released review ids", p1.status === "REVISION" && rev1.round === 1 && rev1.revision_type === "MAJOR" && rev1.review_ids.join() === review0 && Array.isArray(rev1.responses));
  const dRow = await db.one(`SELECT released_at, revision_id FROM \`${T.editorialDecisions}\` WHERE id = ?`, [d1.id]);
  check("decision marked released and linked to the revision", !!dRow.released_at && dRow.revision_id === rev1.id);
  check("communicated decision is immutable → DECISION_EXISTS", (await rpp(dec(manager))) !== "OK");
  check("second open revision impossible → OPEN_REVISION/NOT_UNDER_REVIEW", ["OPEN_REVISION", "NOT_UNDER_REVIEW"].includes(await rpp(wf.requestPaperRevision(db, { paperId, actorId: editor, type: "MINOR", instructions: "x", reviewIds: [review0] }))));

  // Author revision
  check("non-owner cannot edit the revision → FORBIDDEN", (await rpp(wf.saveRevisionDraft(db, { paperId, round: 1, actorId: reviewer, responses: [] }))) === "FORBIDDEN");
  await wf.saveRevisionDraft(db, { paperId, round: 1, actorId: author, responses: [{ reviewId: review0, response: "done" }] });
  check("draft save → REVISION_IN_PROGRESS", (await db.one(`SELECT status FROM \`${T.paperRevisions}\` WHERE id = ?`, [rev1.id])).status === "REVISION_IN_PROGRESS");
  check("submit without a revised manuscript → NO_MANUSCRIPT", (await rpp(wf.submitPaperRevision(db, { paperId, round: 1, actorId: author, responses: [{ r: 1 }] }))) === "NO_MANUSCRIPT");
  const old = await wf.attachRevisionManuscript(db, { paperId, round: 1, actorId: author, key: `${"e".repeat(32)}.pdf`, filename: "v1.pdf", mime: "application/pdf", size: 2000, sha: "f".repeat(64) });
  const replaced = await wf.attachRevisionManuscript(db, { paperId, round: 1, actorId: author, key: `${"9".repeat(32)}.pdf`, filename: "v1b.pdf", mime: "application/pdf", size: 2100, sha: "8".repeat(64) });
  check("attach returns the replaced key (null first time)", old === null && replaced === `${"e".repeat(32)}.pdf`);
  check("submit without responses → NO_RESPONSES", (await rpp(wf.submitPaperRevision(db, { paperId, round: 1, actorId: author, responses: [] }))) === "NO_RESPONSES");
  await wf.submitPaperRevision(db, { paperId, round: 1, actorId: author, responses: [{ reviewId: review0, response: "done" }] });
  check("submitted revision → current_round 1", (await db.one(`SELECT current_round FROM \`${T.papers}\` WHERE id = ?`, [paperId])).current_round === 1);
  check("submitted revision is locked → ALREADY_SUBMITTED", (await rpp(wf.saveRevisionDraft(db, { paperId, round: 1, actorId: author, responses: [] }))) === "ALREADY_SUBMITTED");
  check("author cannot start re-review → FORBIDDEN", (await rpp(wf.startRevisionRereview(db, { paperId, round: 1, actorId: author }))) === "FORBIDDEN");
  await wf.startRevisionRereview(db, { paperId, round: 1, actorId: editor, dueAt: "2027-01-15T00:00:00Z" });
  const a1 = await db.one(`SELECT due_at FROM \`${T.paperAssignments}\` WHERE paper_id = ? AND role = 'PEER_REVIEWER'`, [paperId]);
  check("re-review → UNDER_REVIEW and reviewer deadline set (UTC)", (await db.one(`SELECT status FROM \`${T.papers}\` WHERE id = ?`, [paperId])).status === "UNDER_REVIEW" && a1.due_at === "2027-01-15T00:00:00.000Z");

  const review1 = uuid();
  await submitReview(review1, 1, "ACCEPT");
  const acc = await wf.saveEditorialDecision(db, { paperId, actorId: editor, decision: "ACCEPT", summary: "Accepted", reviewIds: [review1] });
  await wf.releaseEditorialDecision(db, { paperId, actorId: editor, decisionId: acc.id, expectedVersion: acc.version });
  check("ACCEPT released → paper ACCEPTED", (await db.one(`SELECT status FROM \`${T.papers}\` WHERE id = ?`, [paperId])).status === "ACCEPTED");

  // Publication
  section("Volumes, issues and publication");
  const volId = uuid(), issueId = uuid();
  await db.exec(`INSERT INTO \`${T.volumes}\` (id, volume_number, year, title, description, created_by) VALUES (?, 1, 2026, 'Vol 1', '', ?)`, [volId, manager]);
  const dupVol = await db.exec(`INSERT INTO \`${T.volumes}\` (id, volume_number, year, title, description) VALUES (?, 1, 2026, 'Dup', '')`, [uuid()]).catch((e) => e);
  check("duplicate (year, volume) → friendly 409 message from the key name", uniqueViolationMessage(dupVol) === "A volume with this number already exists for that year.", dupVol?.key);
  await db.exec(`INSERT INTO \`${T.issues}\` (id, volume_id, issue_number, title, description) VALUES (?, ?, 1, 'Issue 1', '')`, [issueId, volId]);
  const sched = (who, extra = {}) => wf.schedulePublication(db, { paperId, actorId: who, volumeId: volId, issueId, title: "On MySQL", abstract: "A", authors: [{ name: "A. Author", affiliation: "ATLAS" }], keywords: ["db"], pageStart: 1, pageEnd: 10, doi: "10.1234/rpp.1", publicationDate: null, manuscriptId: null, manuscriptPublic: true, ...extra });
  check("reviewer cannot schedule → FORBIDDEN", (await rpp(sched(reviewer))) === "FORBIDDEN");
  const otherVol = uuid();
  await db.exec(`INSERT INTO \`${T.volumes}\` (id, volume_number, year, title, description) VALUES (?, 2, 2026, 'Vol 2', '')`, [otherVol]);
  check("issue from another volume → ISSUE_VOLUME_MISMATCH", (await rpp(sched(editor, { volumeId: otherVol }))) === "ISSUE_VOLUME_MISMATCH");
  check("composite FK blocks issue∉volume even on a raw insert", (await rpp(db.exec(`INSERT INTO \`${T.publications}\` (id, paper_id, volume_id, issue_id, title, abstract, authors, keywords) VALUES (?, ?, ?, ?, 't', '', '[]', '[]')`, [uuid(), paperId, otherVol, issueId]))) === "ER_NO_REFERENCED_ROW_2");
  const pubId = await sched(editor);
  check("editor schedules the accepted paper", typeof pubId === "string");
  check("a paper can be scheduled only once → ALREADY_SCHEDULED", (await rpp(sched(editor))) === "ALREADY_SCHEDULED");
  const v2 = await wf.updatePublication(db, { pubId, actorId: editor, expectedVersion: 1, volumeId: volId, issueId, title: "On MySQL (final)", abstract: "A", authors: [{ name: "A. Author" }], keywords: ["db"], pageStart: 1, pageEnd: 12, doi: "10.1234/rpp.1", publicationDate: null, manuscriptId: null, manuscriptPublic: true });
  check("update bumps the version; stale update → STALE", v2 === 2 && (await rpp(wf.updatePublication(db, { pubId, actorId: editor, expectedVersion: 1, volumeId: volId, issueId, title: "x", authors: [], keywords: [] }))) === "STALE");
  check("CHECK: page_end before page_start rejected", (await rpp(wf.updatePublication(db, { pubId, actorId: editor, expectedVersion: 2, volumeId: volId, issueId, title: "x", authors: [{ name: "a" }], keywords: [], pageStart: 10, pageEnd: 2 }))) !== "OK");
  check("publish before the issue is published → ISSUE_NOT_PUBLISHED", (await rpp(wf.publishPaper(db, { pubId, actorId: editor, expectedVersion: 2 }))) === "ISSUE_NOT_PUBLISHED");
  check("editor cannot publish a volume (admin only) → FORBIDDEN", (await rpp(wf.setVolumeStatus(db, { volumeId: volId, actorId: editor, status: "PUBLISHED" }))) === "FORBIDDEN");
  check("issue can't be published before its volume → VOLUME_NOT_PUBLISHED", (await rpp(wf.setIssueStatus(db, { issueId, actorId: manager, status: "PUBLISHED", publishPapers: true }))) === "VOLUME_NOT_PUBLISHED");
  await wf.setVolumeStatus(db, { volumeId: volId, actorId: manager, status: "PUBLISHED" });
  check("a published volume is final → ALREADY_PUBLISHED", (await rpp(wf.setVolumeStatus(db, { volumeId: volId, actorId: manager, status: "DRAFT" }))) === "ALREADY_PUBLISHED");
  const n = await wf.setIssueStatus(db, { issueId, actorId: manager, status: "PUBLISHED", publishPapers: true });
  const pub = jrow(await db.one(`SELECT status, publication_date, authors, keywords, version FROM \`${T.publications}\` WHERE id = ?`, [pubId]));
  check("publishing the issue publishes its scheduled paper", n === 1 && pub.status === "PUBLISHED" && /^\d{4}-\d{2}-\d{2}$/.test(pub.publication_date) && pub.authors[0].name === "A. Author");
  check("paper → PUBLISHED", (await db.one(`SELECT status FROM \`${T.papers}\` WHERE id = ?`, [paperId])).status === "PUBLISHED");
  check("FK RESTRICT: a published paper cannot be deleted", (await rpp(db.exec(`DELETE FROM \`${T.papers}\` WHERE id = ?`, [paperId]))) === "ER_ROW_IS_REFERENCED_2");

  const acts = jrows(await db.query(`SELECT action, detail FROM \`${T.paperActivity}\` WHERE paper_id = ? ORDER BY created_at, action`, [paperId]));
  const actions = new Set(acts.map((a) => a.action));
  check("full audit trail recorded", ["SUBMITTED", "DECISION_CREATED", "DECISION_UPDATED", "DECISION_COMMUNICATED", "REVISION_REQUESTED", "REVISION_STARTED", "REVISION_MANUSCRIPT_UPLOADED", "REVISION_SUBMITTED", "REREVIEW_ASSIGNED", "PAPER_ACCEPTED", "PUBLICATION_SCHEDULED", "PUBLICATION_UPDATED", "PAPER_PUBLISHED"].every((a) => actions.has(a)), [...actions].join());
  check("activity detail JSON parsed back to objects", acts.every((a) => a.detail && typeof a.detail === "object"));
  check("workflow errors map to HTTP via mapRpcError", mapRpcError(new Error("RPP:STALE"))?.status === 409 && mapRpcError(new Error("RPP:FORBIDDEN"))?.status === 403);

  // ---- Cascades -----------------------------------------------------------------------------------------------------
  section("Account deletion cascades");
  const temp = await mk("temp@atlasuniversity.edu.in");
  await setPasswordHash(db, temp, await hashPassword("Temp#Pass20266"));
  await createSession(db, temp, { policy: pol });
  await issueToken(db, temp, "RECOVERY");
  await db.exec(`INSERT INTO \`${T.userIdentities}\` (id, user_id, provider, subject, email) VALUES (?, ?, 'google', 'sub-temp', 'temp@atlasuniversity.edu.in')`, [uuid(), temp]);
  await roles(manager, temp, ["PEER_REVIEWER"]);
  const tp = uuid();
  await db.exec(`INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, submitted_by) VALUES (?, 'Temp paper', '', '[]', ?)`, [tp, temp]);
  check("delete account", await db.transaction((tx) => deleteUser(tx, temp)));
  const left = await Promise.all([T.sessions, T.authTokens, T.userIdentities, T.userRoles].map((t) => db.one(`SELECT COUNT(*) AS n FROM \`${t}\` WHERE ${t === T.sessions ? "userId" : "user_id"} = ?`, [temp])));
  check("sessions, tokens, identities and roles removed with the account", left.every((r) => Number(r.n) === 0));
  check("the user's paper is kept with submitted_by = NULL", (await db.one(`SELECT submitted_by FROM \`${T.papers}\` WHERE id = ?`, [tp])).submitted_by === null);
  check("UNIQUE google sub across accounts", (await rpp(db.exec(`INSERT INTO \`${T.userIdentities}\` (id, user_id, provider, subject, email) VALUES (?, ?, 'google', 's1', 'a@x'), (?, ?, 'google', 's1', 'b@x')`, [uuid(), editor, uuid(), reviewer]))) === "ER_DUP_ENTRY");
  void toDate;
} catch (e) {
  failures++;
  console.error("✗ suite aborted:", e.stack || e.message);
} finally {
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await admin.end();
  console.log(`\n(throwaway database ${DB_NAME} dropped)`);
}
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${total - failures}/${total} checks`);
process.exit(failures === 0 ? 0 : 1);
