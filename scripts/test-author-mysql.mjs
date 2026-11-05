/**
 * MySQL integration suite for migration 004 (external AUTHOR accounts, AIDC 2026).
 *
 * Safety: creates its OWN throwaway databases `rpp_it_author_<random>` (+ a
 * restore target), and drops ONLY those at the end. Refuses non-local servers
 * unless RPP_IT_ALLOW_REMOTE=yes. Never touches the application database.
 *
 * Proves, on a real server:
 *   - an existing 001–003 database with Student/Faculty users, roles, papers,
 *     identities and an unrelated application's table survives 004 byte-for-byte;
 *   - the RPP-only backup (scripts/db-backup.mjs) is written, verified, and
 *     restores into an empty database with identical row counts;
 *   - 004's schema (enum, tables, FK, column), idempotency and guarded rollback;
 *   - the author repositories: pending registration (hashed token, expiry,
 *     single use), AUTHOR account creation, profile, role-grant refusal.
 *
 *   npm run test:author-mysql   (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD of a LOCAL server with CREATE DATABASE)
 */
import mysql from "mysql2/promise";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, createPool } from "../lib/db/core.mjs";
import { T } from "../lib/db/tables.mjs";
import { migrate, preflight, readHistory } from "./db-migrate.mjs";
import { helpers } from "../database/migrate-helpers.mjs";
import * as m004 from "../database/migrations/004_author_role.mjs";
import { hashPassword, verifyPassword } from "../lib/auth/password.mjs";
import { sha256Hex, uuid } from "../lib/auth/crypto.mjs";
import {
  createRegisteredUser, createAuthorUser, findUserById, findCredentials, setUserRoles, setPasswordHash, rolesFor,
} from "../lib/repos/users.mjs";
import {
  createPendingAuthorRegistration, findPendingAuthorRegistrationByToken, findPendingAuthorRegistration,
  consumePendingAuthorRegistration, findAuthorProfile,
} from "../lib/repos/authors.mjs";

let failures = 0, total = 0;
const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);
async function rpp(p) { try { await p; return "OK"; } catch (e) { return (String(e.message).match(/RPP[:_]([A-Z_]+)/) || [])[1] || e.code || e.message; } }

const env = process.env;
const conn = {
  host: env.IT_DB_HOST || env.DB_HOST || "localhost",
  port: Number(env.IT_DB_PORT || env.DB_PORT || 3306),
  user: env.IT_DB_USER || env.DB_USER || "root",
  password: env.IT_DB_PASSWORD ?? env.DB_PASSWORD ?? "",
};
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(conn.host) && env.RPP_IT_ALLOW_REMOTE !== "yes") {
  console.error(`Refusing to create a test database on non-local host ${conn.host}. Set RPP_IT_ALLOW_REMOTE=yes to override.`);
  process.exit(2);
}
const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DB_NAME = `rpp_it_author_${tag}`;
const RESTORE_DB = `rpp_it_restore_${tag}`;
const admin = await mysql.createConnection({ ...conn });
await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const db = createDb(createPool({ ...conn, database: DB_NAME, connectionLimit: 6 }));
const backupDir = mkdtempSync(path.join(os.tmpdir(), "rpp-author-backup-"));
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const quiet = { log: () => {} };
console.log(`Author migration suite — throwaway database ${DB_NAME} on ${conn.host}`);

/** Every row of the pre-existing RPP tables (+ the foreign table), ordered, as JSON. */
async function snapshot() {
  const out = {};
  for (const t of [T.users, T.userRoles, T.userIdentities, T.papers, T.paperAuthors, T.sessions, T.oauthStates, "employment_responses"]) {
    const cols = (await db.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position", [t]))
      .map((r) => r.c).filter((c) => c !== "author_registration_id"); // the one column 004 adds
    out[t] = await db.query(`SELECT ${cols.map((c) => `\`${c}\``).join(", ")} FROM \`${t}\` ORDER BY 1`);
  }
  return JSON.stringify(out);
}

try {
  // ---- An EXISTING 001–003 database with real-looking data -----------------------------
  section("Existing database (migrations 001–003) with Student/Faculty data");
  await db.query("CREATE TABLE `employment_responses` (id INT PRIMARY KEY, answer VARCHAR(50)) ENGINE=InnoDB");
  await db.exec("INSERT INTO `employment_responses` VALUES (1, 'keep me'), (2, 'and me')");
  for (const n of ["001", "002", "003"]) await migrate(db, { only: n, ...quiet });
  check("001–003 applied", (await readHistory(db)).size === 3);

  const student = await createRegisteredUser(db, { name: "Stu Dent", email: "stu@atlasuniversity.edu.in", baseType: "STUDENT", applicationNo: "2629885" });
  const faculty = await createRegisteredUser(db, { name: "Fac Ulty", email: "fac@atlasuniversity.edu.in", baseType: "FACULTY" });
  const tester = await createRegisteredUser(db, { name: "Tester", email: "sf48116@gmail.com", baseType: "STUDENT", applicationNo: "999" });
  const adminU = await createRegisteredUser(db, { name: "Admin", email: "admin@atlasuniversity.edu.in", baseType: "FACULTY" });
  await db.exec(`UPDATE \`${T.users}\` SET isAdmin = 1, emailVerified = UTC_TIMESTAMP(3) WHERE id = ?`, [adminU]);
  await db.exec(`INSERT INTO \`${T.userRoles}\` (user_id, role) VALUES (?, 'ADMINISTRATOR')`, [adminU]);
  await setPasswordHash(db, faculty, await hashPassword("Faculty#Password1"));
  await db.transaction((tx) => setUserRoles(tx, { actorId: adminU, targetId: faculty, roles: ["PEER_REVIEWER", "EDITOR"] }));
  await db.exec(`INSERT INTO \`${T.userIdentities}\` (id, user_id, provider, subject, email) VALUES (?, ?, 'google', 'g-stu', 'stu@atlasuniversity.edu.in')`, [uuid(), student]);
  const paper = uuid();
  await db.exec(`INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, status, submitted_by, current_round, created_at, updated_at) VALUES (?, 'Existing paper', 'a', '[]', 'SUBMITTED', ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, [paper, student]);
  await db.exec(`INSERT INTO \`${T.paperAuthors}\` (id, paper_id, full_name, email, is_corresponding, author_order) VALUES (?, ?, 'Stu Dent', 'stu@atlasuniversity.edu.in', 1, 0)`, [uuid(), paper]);
  await db.exec(`INSERT INTO \`${T.oauthStates}\` (state_hash, nonce, code_verifier, next_path, expires_at) VALUES (?, 'n', 'v', '/dashboard', UTC_TIMESTAMP(3) + INTERVAL 5 MINUTE)`, [sha256Hex("pre-004-state")]);
  const before = await snapshot();

  const pf = await preflight(db);
  check("preflight: 004 pending, no collisions", pf.ok && pf.pending.length === 1 && pf.pending[0].startsWith("004"), pf.pending.join());

  // ---- Backup (RPP tables only) → verify → restore ------------------------------------
  section("Backup of ONLY the RPP tables, verified and restorable");
  const out = execFileSync(process.execPath, [path.join(root, "scripts/db-backup.mjs"), backupDir], {
    env: { ...process.env, DB_HOST: conn.host, DB_PORT: String(conn.port), DB_USER: conn.user, DB_PASSWORD: conn.password, DB_NAME },
    encoding: "utf8",
  });
  const files = readdirSync(backupDir).filter((f) => f.endsWith(".sql"));
  check("backup file written", files.length === 1, files.join());
  check("backup self-verification passed (row counts match live)", /✓ Backup written/.test(out) && !/✗/.test(out));
  const dump = readFileSync(path.join(backupDir, files[0]), "utf8");
  check("backup contains RPP tables only (not employment_responses)", !/employment_responses/.test(dump) && /research_users/.test(dump));
  await admin.query(`CREATE DATABASE \`${RESTORE_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const rconn = await mysql.createConnection({ ...conn, database: RESTORE_DB, multipleStatements: true, charset: "utf8mb4_unicode_ci" });
  await rconn.query(dump);
  let restoredOk = true;
  for (const t of [T.users, T.userRoles, T.userIdentities, T.papers, T.paperAuthors, T.oauthStates, T.schemaMigrations]) {
    const [[a]] = await rconn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
    const b = await db.one(`SELECT COUNT(*) AS n FROM \`${t}\``);
    if (Number(a.n) !== Number(b.n)) restoredOk = false;
  }
  check("backup restores into an empty database with identical row counts", restoredOk);
  const [[pw]] = await rconn.query(`SELECT passwordHash FROM \`${T.users}\` WHERE email = 'fac@atlasuniversity.edu.in'`);
  check("…including password hashes", typeof pw.passwordHash === "string" && pw.passwordHash.startsWith("$argon2"));
  await rconn.end();

  // ---- Apply 004 -----------------------------------------------------------------------
  section("Migration 004 on the existing database");
  const applied = await migrate(db, quiet);
  check("004 applied and recorded", applied.length === 1 && (await readHistory(db)).has(applied[0]));
  const after = await snapshot();
  check("EVERY existing row unchanged (users, passwords, roles, identities, papers, authors, sessions, oauth states, other app)", before === after);
  const col = await db.one("SELECT column_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'baseType'", [T.users]);
  check("baseType enum = STUDENT, FACULTY, AUTHOR (appended), NOT NULL, default STUDENT", col.t === "enum('STUDENT','FACULTY','AUTHOR')" && col.n === "NO" && String(col.d).replace(/'/g, "") === "STUDENT", `${col.t} ${col.n} ${col.d}`);
  check("existing STUDENT / FACULTY values read back unchanged", (await findUserById(db, student)).base_type === "STUDENT" && (await findUserById(db, faculty)).base_type === "FACULTY");
  check("existing roles intact", JSON.stringify((await rolesFor(db, faculty)).sort()) === JSON.stringify(["EDITOR", "PEER_REVIEWER"]));
  const h = helpers(db);
  check("research_author_profiles + research_author_registrations created", (await h.tableExists(T.authorProfiles)) && (await h.tableExists(T.authorRegistrations)));
  check("research_oauth_states.author_registration_id added (nullable)", (await h.columnInfo(T.oauthStates, "author_registration_id"))?.nullable === "YES");
  check("pre-existing OAuth state row still readable, author link NULL", (await db.one(`SELECT author_registration_id AS a FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [sha256Hex("pre-004-state")]))?.a === null);
  check("profile FK → research_users", await h.constraintExists("research_author_profiles_user_fk"));
  check("only research_* tables exist besides the other app's table",
    (await db.query("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE()")).every((r) => r.n.startsWith("research_") || r.n === "employment_responses"));
  check("other application's rows untouched", (await db.query("SELECT answer FROM employment_responses ORDER BY id")).map((r) => r.answer).join() === "keep me,and me");

  section("Idempotency");
  check("re-running migrate → nothing pending", (await migrate(db, quiet)).length === 0);
  const logs = [];
  await m004.up(helpers(db, (l) => logs.push(l)));
  check("re-running 004 up() directly changes nothing", logs.length === 0, logs.join(" | "));
  check("…and data still unchanged", (await snapshot()) === before);

  // ---- Repositories --------------------------------------------------------------------
  section("Pending Author registrations (hashed token, expiry, single use)");
  const data = { name: "Priya Menon", email: "priya@gmail.com", phone: "+91 98765 43210", organization: "NID", currentStatus: "RESEARCHER", designation: "M.Des", location: "Ahmedabad, India" };
  const p1 = await createPendingAuthorRegistration(db, data, { ttlSeconds: 1800 });
  const raw = await db.one(`SELECT token_hash FROM \`${T.authorRegistrations}\` WHERE id = ?`, [p1.id]);
  check("only the SHA-256 of the token is stored", raw.token_hash === sha256Hex(p1.token) && raw.token_hash !== p1.token);
  check("lookup by the browser token works", (await findPendingAuthorRegistrationByToken(db, p1.token))?.id === p1.id);
  check("wrong / short / missing token → null", !(await findPendingAuthorRegistrationByToken(db, "x".repeat(43))) && !(await findPendingAuthorRegistrationByToken(db, "short")) && !(await findPendingAuthorRegistrationByToken(db, undefined)));
  check("no account exists before Google", !(await db.one(`SELECT id FROM \`${T.users}\` WHERE email = 'priya@gmail.com'`)));
  const pExp = await createPendingAuthorRegistration(db, { ...data, email: "late@gmail.com" }, { ttlSeconds: 1800 });
  await db.exec(`UPDATE \`${T.authorRegistrations}\` SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?`, [pExp.id]);
  check("expired registration not found by token or id", !(await findPendingAuthorRegistrationByToken(db, pExp.token)) && !(await findPendingAuthorRegistration(db, pExp.id)));
  check("expired registration cannot be consumed", (await db.transaction((tx) => consumePendingAuthorRegistration(tx, pExp.id))) === null);
  const p2 = await createPendingAuthorRegistration(db, data, { ttlSeconds: 1800 }); // a second submit, same email
  check("invalid status rejected by the database ENUM (strict mode)", (await rpp(createPendingAuthorRegistration(db, { ...data, currentStatus: "ADMIN" }, { ttlSeconds: 60 }))) !== "OK");

  section("Activation → AUTHOR account (the transaction activateAuthor runs)");
  const activate = (id, claims) => db.transaction(async (tx) => {
    const reg = await consumePendingAuthorRegistration(tx, id);
    if (!reg || reg.email !== claims.email) return null;
    const userId = await createAuthorUser(tx, reg);
    await tx.exec(`INSERT INTO \`${T.userIdentities}\` (id, user_id, provider, subject, email, created_at) VALUES (?, ?, 'google', ?, ?, UTC_TIMESTAMP(3))`, [uuid(), userId, claims.sub, claims.email]);
    return userId;
  });
  const authorId = await activate(p1.id, { sub: "g-priya", email: "priya@gmail.com" });
  const a = await findUserById(db, authorId);
  check("AUTHOR account created", a?.base_type === "AUTHOR" && a.email === "priya@gmail.com");
  check("…not admin, no roles, no password, ACTIVE, email verified", a.is_admin === false && (await rolesFor(db, authorId)).length === 0 && a.has_password === false && a.status === "ACTIVE" && !!a.email_confirmed_at);
  const prof = await findAuthorProfile(db, authorId);
  check("author profile stored (all fields + conference)", prof && prof.phone === data.phone && prof.organization === "NID" && prof.current_status === "RESEARCHER" && prof.designation === "M.Des" && prof.location === "Ahmedabad, India" && prof.conference === "AIDC_2026");
  check("Google identity linked", (await db.one(`SELECT user_id FROM \`${T.userIdentities}\` WHERE subject = 'g-priya'`))?.user_id === authorId);
  check("pending rows for that email consumed (incl. the duplicate submit)", !(await findPendingAuthorRegistration(db, p1.id)) && !(await findPendingAuthorRegistration(db, p2.id)));
  check("re-using the registration → null (single use), still one account", (await activate(p1.id, { sub: "g-priya", email: "priya@gmail.com" })) === null && Number((await db.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE email = 'priya@gmail.com'`)).n) === 1);
  const p3 = await createPendingAuthorRegistration(db, { ...data, email: "match@gmail.com" }, { ttlSeconds: 1800 });
  check("email mismatch inside the transaction → nothing created", (await activate(p3.id, { sub: "g-x", email: "other@gmail.com" })) === null && !(await db.one(`SELECT id FROM \`${T.users}\` WHERE email IN ('match@gmail.com','other@gmail.com')`)));
  check("duplicate email cannot create a second account (UNIQUE email)", (await rpp(db.transaction((tx) => createAuthorUser(tx, { ...data, current_status: "OTHER", email: "fac@atlasuniversity.edu.in" })))) === "ER_DUP_ENTRY");

  section("Email + password Author (current registration path)");
  const pwHash = await hashPassword("Author#Password2026");
  const pwAuthor = await db.transaction((tx) => createAuthorUser(tx, { ...data, email: "pw.author@gmail.com", current_status: "OTHER", passwordHash: pwHash }));
  const cred = await findCredentials(db, "pw.author@gmail.com");
  check("Author created with an Argon2id hash (never plaintext)", cred?.password_hash?.startsWith("$argon2id$") && !cred.password_hash.includes("Author#Password2026"));
  check("…passes the standard password check, wrong password fails", (await verifyPassword(cred.password_hash, "Author#Password2026")).ok && !(await verifyPassword(cred.password_hash, "wrong-password-123")).ok);
  check("…usable by /api/login (ACTIVE + email confirmed), AUTHOR, not admin, no roles",
    cred.status === "ACTIVE" && !!cred.email_confirmed_at && (await findUserById(db, pwAuthor)).base_type === "AUTHOR" && (await findUserById(db, pwAuthor)).is_admin === false && (await rolesFor(db, pwAuthor)).length === 0);
  check("…profile stored", (await findAuthorProfile(db, pwAuthor))?.current_status === "OTHER");
  check("…no Google identity created", !(await db.one(`SELECT 1 AS x FROM \`${T.userIdentities}\` WHERE user_id = ?`, [pwAuthor])));

  section("Authorization data rules");
  check("admin cannot grant an AUTHOR any role → AUTHOR_ROLES", (await rpp(db.transaction((tx) => setUserRoles(tx, { actorId: adminU, targetId: authorId, roles: ["PEER_REVIEWER"] })))) === "AUTHOR_ROLES");
  check("…nor ADMINISTRATOR (isAdmin stays 0)", (await rpp(db.transaction((tx) => setUserRoles(tx, { actorId: adminU, targetId: authorId, roles: ["ADMINISTRATOR"] })))) === "AUTHOR_ROLES" && (await findUserById(db, authorId)).is_admin === false);
  check("an AUTHOR cannot change roles (own or others) → SELF / FORBIDDEN",
    (await rpp(db.transaction((tx) => setUserRoles(tx, { actorId: authorId, targetId: authorId, roles: ["ADMINISTRATOR"] })))) === "SELF"
    && (await rpp(db.transaction((tx) => setUserRoles(tx, { actorId: authorId, targetId: student, roles: ["EDITOR"] })))) === "FORBIDDEN");
  check("Student/Faculty role management unchanged", (await rpp(db.transaction((tx) => setUserRoles(tx, { actorId: adminU, targetId: student, roles: ["PEER_REVIEWER"] })))) === "OK");
  const viaRegistration = await createRegisteredUser(db, { name: "X", email: "x@atlasuniversity.edu.in", baseType: "AUTHOR" });
  check("Student/Faculty registration path can never create an AUTHOR (coerced to STUDENT)", (await findUserById(db, viaRegistration)).base_type === "STUDENT");
  check("sf48116@gmail.com account unchanged (STUDENT)", (await findUserById(db, tester)).base_type === "STUDENT");

  section("Guarded rollback");
  check("down() refuses while an AUTHOR account exists", /AUTHOR account/.test(await rpp(m004.down(helpers(db)))));
  check("…and changed nothing", (await h.tableExists(T.authorProfiles)) && (await findUserById(db, authorId))?.base_type === "AUTHOR");
} catch (e) {
  failures++;
  console.error("✗ suite aborted:", e.stack || e.message);
} finally {
  await db.end();
  await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await admin.query(`DROP DATABASE IF EXISTS \`${RESTORE_DB}\``);
  await admin.end();
  rmSync(backupDir, { recursive: true, force: true });
  console.log(`\n(throwaway databases ${DB_NAME}, ${RESTORE_DB} and the backup file removed)`);
}
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${total - failures}/${total} checks`);
process.exit(failures === 0 ? 0 : 1);
