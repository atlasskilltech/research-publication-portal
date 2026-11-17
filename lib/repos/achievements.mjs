/**
 * Faculty achievements — SQL access (research_achievements, research_achievement_files).
 *
 * Every function takes a db handle (`db` or a transaction `tx`) so routes can
 * compose them inside one transaction. Identifiers come only from T; every value
 * is a bound parameter. Validation happens before this layer
 * (lib/achievementTypes.js); authorization happens in the routes.
 */
import { T } from "../db/tables.mjs";
import { parseJson } from "../db/core.mjs";

const COLS = `a.id, a.user_id, a.type, a.school_code, a.title,
  DATE_FORMAT(a.achievement_date, '%Y-%m-%d') AS achievement_date,
  a.amount_inr, a.atlas_affiliation, a.details, a.status, a.review_note,
  a.reviewed_at, a.created_at, u.name AS owner_name, u.email AS owner_email,
  r.name AS reviewer_name`;

const FROM = `FROM \`${T.achievements}\` a
  JOIN \`${T.users}\` u ON u.id = a.user_id
  LEFT JOIN \`${T.users}\` r ON r.id = a.reviewed_by`;

function shape(row, files = []) {
  return {
    id: row.id,
    ownerId: row.user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    type: row.type,
    school: row.school_code,
    title: row.title,
    achievementDate: row.achievement_date,
    amountInr: row.amount_inr == null ? null : Number(row.amount_inr),
    affiliation: row.atlas_affiliation || null,
    details: parseJson(row.details, {}) || {},
    status: row.status,
    reviewNote: row.review_note || null,
    reviewerName: row.reviewer_name || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    files,
  };
}

async function filesFor(db, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await db.query(
    `SELECT id, achievement_id, slot, original_filename, byte_size FROM \`${T.achievementFiles}\`
      WHERE achievement_id IN (?) ORDER BY created_at ASC, original_filename ASC`,
    [ids],
  );
  for (const f of rows) {
    if (!map.has(f.achievement_id)) map.set(f.achievement_id, []);
    map.get(f.achievement_id).push({ id: f.id, slot: f.slot, name: f.original_filename, size: Number(f.byte_size) });
  }
  return map;
}

/**
 * List achievements, newest first.
 * filters: { ownerId?, type?, school?, status?, from?, to? } (dates "YYYY-MM-DD", inclusive)
 */
export async function listAchievements(db, filters = {}) {
  const where = [];
  const params = [];
  if (filters.ownerId) { where.push("a.user_id = ?"); params.push(filters.ownerId); }
  if (filters.type) { where.push("a.type = ?"); params.push(filters.type); }
  if (filters.school) { where.push("a.school_code = ?"); params.push(filters.school); }
  if (filters.status) { where.push("a.status = ?"); params.push(filters.status); }
  if (filters.from) { where.push("a.achievement_date >= ?"); params.push(filters.from); }
  if (filters.to) { where.push("a.achievement_date <= ?"); params.push(filters.to); }
  const rows = await db.query(
    `SELECT ${COLS} ${FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.achievement_date DESC, a.created_at DESC LIMIT 5000`,
    params,
  );
  const files = await filesFor(db, rows.map((r) => r.id));
  return rows.map((r) => shape(r, files.get(r.id) || []));
}

export async function getAchievement(db, id) {
  const row = await db.one(`SELECT ${COLS} ${FROM} WHERE a.id = ?`, [id]);
  if (!row) return null;
  const files = await filesFor(db, [row.id]);
  return shape(row, files.get(row.id) || []);
}

/** Insert one achievement and its file rows (call inside a transaction). */
export async function insertAchievement(tx, { id, userId, data, files }) {
  await tx.exec(
    `INSERT INTO \`${T.achievements}\`
       (id, user_id, type, school_code, title, achievement_date, amount_inr, atlas_affiliation, details, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, userId, data.type, data.school, data.title, data.achievementDate, data.amountInr, data.affiliation, JSON.stringify(data.details || {})],
  );
  if (files.length) {
    await tx.exec(
      `INSERT INTO \`${T.achievementFiles}\` (id, achievement_id, slot, storage_key, original_filename, mime_type, byte_size, sha256, created_at) VALUES ?`,
      [files.map((f) => [f.id, id, f.slot, f.key, f.name, f.mime, f.size, f.sha, new Date()])],
    );
  }
}

/** One file row joined to its achievement's owner (for the download check). */
export async function getAchievementFile(db, achievementId, fileId) {
  return db.one(
    `SELECT f.id, f.storage_key, f.original_filename, f.mime_type, a.user_id
       FROM \`${T.achievementFiles}\` f JOIN \`${T.achievements}\` a ON a.id = f.achievement_id
      WHERE f.id = ? AND f.achievement_id = ?`,
    [fileId, achievementId],
  );
}

/** Admin review: set VERIFIED / REJECTED / back to SUBMITTED. Returns affected rows. */
export async function setAchievementStatus(db, { id, status, note, reviewerId }) {
  const r = await db.exec(
    `UPDATE \`${T.achievements}\`
        SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ${status === "SUBMITTED" ? "NULL" : "UTC_TIMESTAMP(3)"}
      WHERE id = ?`,
    [status, note || null, status === "SUBMITTED" ? null : reviewerId, id],
  );
  return r.affectedRows;
}

/** Delete an achievement (files cascade). Returns the storage keys to remove afterwards. */
export async function deleteAchievement(tx, id) {
  const keys = (await tx.query(`SELECT storage_key FROM \`${T.achievementFiles}\` WHERE achievement_id = ?`, [id])).map((r) => r.storage_key);
  const r = await tx.exec(`DELETE FROM \`${T.achievements}\` WHERE id = ?`, [id]);
  return r.affectedRows ? keys : null;
}
