/**
 * Users / roles repository (MySQL). Pure data access — no authorization here;
 * callers decide who may do what. Every function takes `q`, a db or
 * transaction handle from lib/db (so it is usable from the app, scripts and
 * tests alike).
 *
 * The pre-existing users table uses camelCase columns; PROFILE_SELECT aliases
 * them to the snake_case "profile" shape the routes were written against
 * (id, email, name, base_type, is_admin, school_code, roll_no, application_no,
 * created_at, updated_at) plus email_confirmed_at / status / has_password.
 */
import { T } from "../db/tables.mjs";
import { uuid } from "../auth/crypto.mjs";

export const ROLES = Object.freeze(["ADMINISTRATOR", "SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"]);

export const PROFILE_SELECT = `u.id, u.email, u.name, u.baseType AS base_type, u.isAdmin AS is_admin,
  u.schoolCode AS school_code, u.rollNo AS roll_no, u.applicationNo AS application_no,
  u.emailVerified AS email_confirmed_at, u.status, (u.passwordHash IS NOT NULL) AS has_password,
  u.lastLoginAt AS last_sign_in_at, u.createdAt AS created_at, u.updatedAt AS updated_at`;

const fixBool = (r) => (r ? { ...r, has_password: !!Number(r.has_password) } : r);

export const normEmail = (e) => String(e || "").trim().toLowerCase();

export async function findUserById(q, id) {
  return fixBool(await q.one(`SELECT ${PROFILE_SELECT} FROM \`${T.users}\` u WHERE u.id = ?`, [id]));
}

export async function findUserByEmail(q, email) {
  return fixBool(await q.one(`SELECT ${PROFILE_SELECT} FROM \`${T.users}\` u WHERE u.email = ?`, [normEmail(email)]));
}

/** Password hash for sign-in only (never part of the profile shape). */
export async function findCredentials(q, email) {
  return q.one(
    `SELECT id, email, passwordHash AS password_hash, emailVerified AS email_confirmed_at, status FROM \`${T.users}\` WHERE email = ?`,
    [normEmail(email)],
  );
}

export async function findUserByApplicationNo(q, applicationNo) {
  return q.one(`SELECT id FROM \`${T.users}\` WHERE applicationNo = ? LIMIT 1`, [applicationNo]);
}

/** Profiles by id list → Map(id → profile). */
export async function usersByIds(q, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  const rows = await q.query(`SELECT ${PROFILE_SELECT} FROM \`${T.users}\` u WHERE u.id IN (?)`, [list]);
  return new Map(rows.map((r) => [r.id, fixBool(r)]));
}

/**
 * Create a NEW, unverified, passwordless, NON-admin account (registration).
 * isAdmin is hard-coded false and no role is ever written here — privilege can
 * never arrive through registration input.
 */
export async function createRegisteredUser(q, { name, email, baseType, schoolCode = null, applicationNo = null }) {
  const id = uuid();
  await q.exec(
    `INSERT INTO \`${T.users}\` (id, name, email, passwordHash, baseType, isAdmin, status, schoolCode, applicationNo, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, NULL, ?, 0, 'ACTIVE', ?, ?, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, String(name || ""), normEmail(email), baseType === "FACULTY" ? "FACULTY" : "STUDENT", schoolCode, applicationNo],
  );
  return id;
}

export async function markEmailVerified(q, userId) {
  await q.exec(`UPDATE \`${T.users}\` SET emailVerified = COALESCE(emailVerified, UTC_TIMESTAMP(3)) WHERE id = ?`, [userId]);
}

export async function setPasswordHash(q, userId, hash) {
  const r = await q.exec(
    `UPDATE \`${T.users}\` SET passwordHash = ?, passwordChangedAt = UTC_TIMESTAMP(3) WHERE id = ?`,
    [hash, userId],
  );
  return r.affectedRows === 1;
}

/**
 * Set the FIRST password of an account that has none (optional password after
 * Google sign-in). Conditional on passwordHash IS NULL, so it can never
 * overwrite an existing password, even under concurrent requests.
 * → true when set, false when the account already had a password.
 */
export async function setInitialPasswordHash(q, userId, hash) {
  const r = await q.exec(
    `UPDATE \`${T.users}\` SET passwordHash = ?, passwordChangedAt = UTC_TIMESTAMP(3) WHERE id = ? AND passwordHash IS NULL`,
    [hash, userId],
  );
  return r.affectedRows === 1;
}

/** Transparent upgrade of a legacy (bcrypt) hash — does not count as a password change. */
export async function upgradePasswordHash(q, userId, hash) {
  await q.exec(`UPDATE \`${T.users}\` SET passwordHash = ? WHERE id = ?`, [hash, userId]);
}

export async function touchLastLogin(q, userId) {
  await q.exec(`UPDATE \`${T.users}\` SET lastLoginAt = UTC_TIMESTAMP(3) WHERE id = ?`, [userId]);
}

export async function rolesFor(q, userId) {
  const rows = await q.query(`SELECT role FROM \`${T.userRoles}\` WHERE user_id = ? ORDER BY role`, [userId]);
  return rows.map((r) => r.role);
}

/** Map(userId → roles[]) for many users. */
export async function rolesByUser(q, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const out = new Map(list.map((i) => [i, []]));
  if (!list.length) return out;
  const rows = await q.query(`SELECT user_id, role FROM \`${T.userRoles}\` WHERE user_id IN (?) ORDER BY role`, [list]);
  for (const r of rows) out.get(r.user_id)?.push(r.role);
  return out;
}

/** All users with roles (admin user management). */
export async function listUsersWithRoles(q) {
  const rows = (await q.query(`SELECT ${PROFILE_SELECT} FROM \`${T.users}\` u ORDER BY u.createdAt DESC`)).map(fixBool);
  const roles = await rolesByUser(q, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, roles: roles.get(r.id) || [] }));
}

/** Number of administrators who can still act (isAdmin AND status ACTIVE). */
export async function countAdmins(q) {
  return Number((await q.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE isAdmin = 1 AND status = 'ACTIVE'`)).n);
}

export const USER_STATUSES = Object.freeze(["ACTIVE", "DISABLED"]);

/**
 * The workflow/audit footprint of an account. Deleting a user CASCADEs their
 * reviews and assignments and nulls their name on papers, decisions,
 * revisions, publications and activity — so an account with ANY of these must
 * be disabled, never deleted. → { total, papers, reviews, … }
 */
export async function userHistory(q, userId) {
  const r = await q.one(
    `SELECT
       (SELECT COUNT(*) FROM \`${T.papers}\` WHERE submitted_by = ?) AS papers,
       (SELECT COUNT(*) FROM \`${T.reviews}\` WHERE reviewer = ?) AS reviews,
       (SELECT COUNT(*) FROM \`${T.reviews}\` WHERE reviewer = ? AND status = 'SUBMITTED') AS submitted_reviews,
       (SELECT COUNT(*) FROM \`${T.paperAssignments}\` WHERE assignee = ?) AS assignments,
       (SELECT COUNT(*) FROM \`${T.editorialDecisions}\` WHERE decided_by = ? OR released_by = ?) AS decisions,
       (SELECT COUNT(*) FROM \`${T.paperRevisions}\` WHERE requested_by = ? OR submitted_by = ?) AS revisions,
       (SELECT COUNT(*) FROM \`${T.publications}\` WHERE scheduled_by = ? OR published_by = ?) AS publications,
       (SELECT COUNT(*) FROM \`${T.paperManuscripts}\` WHERE uploaded_by = ?) AS manuscripts,
       (SELECT COUNT(*) FROM \`${T.paperActivity}\` WHERE actor = ?) AS activity`,
    [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId],
  );
  const out = Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, Number(v) || 0]));
  out.total = out.papers + out.reviews + out.assignments + out.decisions + out.revisions + out.publications + out.manuscripts + out.activity;
  return out;
}

/**
 * Disable or reactivate an account (admin action). MUST run inside a
 * transaction. Disabling revokes every session of the user; a disabled account
 * can't sign in (password, Google or email link) — see lib/auth/store.mjs
 * readSession, /api/login and lib/oauthPolicy.decideAccount. Nothing else
 * changes: roles, papers, reviews, decisions and audit records are untouched.
 * Guards (thrown, mapped to HTTP by the route): RPP_FORBIDDEN, RPP_NOT_FOUND,
 * RPP_SELF, RPP_PROTECTED (protected admins can't be disabled),
 * RPP_LAST_ADMIN (the last ACTIVE admin can't be disabled), RPP_INVALID_STATUS.
 */
export async function setUserStatus(tx, { actorId, targetId, status, protectedEmails = [] }) {
  const next = String(status || "").toUpperCase();
  if (!USER_STATUSES.includes(next)) throw new Error("RPP_INVALID_STATUS");
  await tx.query(`SELECT id FROM \`${T.users}\` WHERE isAdmin = 1 FOR UPDATE`);
  const target = await tx.one(`SELECT id, email, isAdmin, status FROM \`${T.users}\` WHERE id = ? FOR UPDATE`, [targetId]);
  if (!target) throw new Error("RPP_NOT_FOUND");
  if (actorId === targetId) throw new Error("RPP_SELF");
  const actor = await tx.one(`SELECT isAdmin, status FROM \`${T.users}\` WHERE id = ?`, [actorId]);
  if (!actor?.isAdmin || actor.status !== "ACTIVE") throw new Error("RPP_FORBIDDEN");
  if (next === "DISABLED") {
    if (protectedEmails.map(normEmail).includes(normEmail(target.email))) throw new Error("RPP_PROTECTED");
    if (target.isAdmin) {
      const others = Number((await tx.one(
        `SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE isAdmin = 1 AND status = 'ACTIVE' AND id <> ?`, [targetId])).n);
      if (others === 0) throw new Error("RPP_LAST_ADMIN");
    }
  }
  if (target.status !== next) {
    await tx.exec(`UPDATE \`${T.users}\` SET status = ? WHERE id = ?`, [next, targetId]);
  }
  if (next === "DISABLED") {
    await tx.exec(`UPDATE \`${T.sessions}\` SET revokedAt = UTC_TIMESTAMP(3) WHERE userId = ? AND revokedAt IS NULL`, [targetId]);
  }
  return { status: next, changed: target.status !== next };
}

/**
 * Replace a user's role set atomically and keep isAdmin in sync with the
 * ADMINISTRATOR role. MUST be called
 * inside a transaction. Guards (same error codes as before):
 *   RPP_INVALID_ROLE, RPP_NOT_FOUND, RPP_SELF (no self change),
 *   RPP_PROTECTED (protected admins can't lose ADMINISTRATOR),
 *   RPP_LAST_ADMIN (the last admin can't be demoted).
 * Concurrency: all admin rows + the target row are locked FOR UPDATE first, so
 * two concurrent demotions serialise and can never remove the last admin.
 */
export async function setUserRoles(tx, { actorId, targetId, roles, protectedEmails = [] }) {
  const wanted = [...new Set(roles || [])];
  for (const r of wanted) if (!ROLES.includes(r)) throw new Error(`RPP_INVALID_ROLE:${r}`);
  await tx.query(`SELECT id FROM \`${T.users}\` WHERE isAdmin = 1 FOR UPDATE`);
  const target = await tx.one(`SELECT id, email, isAdmin FROM \`${T.users}\` WHERE id = ? FOR UPDATE`, [targetId]);
  if (!target) throw new Error("RPP_NOT_FOUND");
  if (actorId === targetId) throw new Error("RPP_SELF");
  const actor = await tx.one(`SELECT isAdmin FROM \`${T.users}\` WHERE id = ?`, [actorId]);
  if (!actor?.isAdmin) throw new Error("RPP_FORBIDDEN");

  const curr = !!target.isAdmin;
  const next = wanted.includes("ADMINISTRATOR");
  if (curr && !next) {
    if (protectedEmails.map(normEmail).includes(normEmail(target.email))) throw new Error("RPP_PROTECTED");
    const others = Number((await tx.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE isAdmin = 1 AND status = 'ACTIVE' AND id <> ?`, [targetId])).n);
    if (others === 0) throw new Error("RPP_LAST_ADMIN");
  }
  if (wanted.length) {
    await tx.exec(`DELETE FROM \`${T.userRoles}\` WHERE user_id = ? AND role NOT IN (?)`, [targetId, wanted]);
    await tx.exec(
      `INSERT IGNORE INTO \`${T.userRoles}\` (user_id, role, assigned_by, assigned_at) VALUES ?`,
      [wanted.map((r) => [targetId, r, actorId, new Date()])],
    );
  } else {
    await tx.exec(`DELETE FROM \`${T.userRoles}\` WHERE user_id = ?`, [targetId]);
  }
  if (curr !== next) await tx.exec(`UPDATE \`${T.users}\` SET isAdmin = ? WHERE id = ?`, [next ? 1 : 0, targetId]);
  return { is_admin: next, roles: await rolesFor(tx, targetId) };
}

/**
 * Permanently delete an account that has NO workflow history (e.g. a mistaken
 * registration). Accounts that own papers, wrote reviews, hold assignments or
 * appear in decisions, revisions, publications, manuscripts or the activity
 * log are refused (RPP_HAS_HISTORY) — the FKs would cascade-delete their
 * reviews/assignments or erase their name from the record; disable them
 * instead (setUserStatus). Refuses (RPP_LAST_ADMIN) to delete the last ACTIVE
 * administrator — checked under the same admin-row lock as setUserRoles.
 * Must run inside a transaction.
 */
export async function deleteUser(tx, userId) {
  await tx.query(`SELECT id FROM \`${T.users}\` WHERE isAdmin = 1 FOR UPDATE`);
  const u = await tx.one(`SELECT id, isAdmin FROM \`${T.users}\` WHERE id = ? FOR UPDATE`, [userId]);
  if (!u) return false;
  if (u.isAdmin) {
    const others = Number((await tx.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE isAdmin = 1 AND status = 'ACTIVE' AND id <> ?`, [userId])).n);
    if (others === 0) throw new Error("RPP_LAST_ADMIN");
  }
  if ((await userHistory(tx, userId)).total > 0) throw new Error("RPP_HAS_HISTORY");
  const r = await tx.exec(`DELETE FROM \`${T.users}\` WHERE id = ?`, [userId]);
  return r.affectedRows === 1;
}
