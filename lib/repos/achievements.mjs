/**
 * Faculty achievements — SQL access (research_achievements and its files,
 * Drive links, contributors; research_faculty_profiles for ORCID).
 *
 * Every function takes a db handle (`db` or a transaction `tx`) so routes and
 * the import script can compose them inside one transaction. Identifiers come
 * only from T; every value is a bound parameter. Validation happens before this
 * layer (lib/achievementTypes.js); authorization happens in the routes.
 */
import { T } from "../db/tables.mjs";
import { parseJson } from "../db/core.mjs";
import { uuid } from "../auth/crypto.mjs";

const COLS = `a.id, a.user_id, a.type, a.school_code, a.title,
  DATE_FORMAT(a.achievement_date, '%Y-%m-%d') AS achievement_date,
  a.amount_inr, a.atlas_affiliation, a.details, a.status, a.source, a.review_note,
  a.reviewed_at, a.created_at, u.name AS owner_name, u.email AS owner_email,
  r.name AS reviewer_name`;

const FROM = `FROM \`${T.achievements}\` a
  JOIN \`${T.users}\` u ON u.id = a.user_id
  LEFT JOIN \`${T.users}\` r ON r.id = a.reviewed_by`;

const normEmail = (e) => String(e || "").trim().toLowerCase();

function shape(row, extra) {
  return {
    id: row.id,
    ownerId: row.user_id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    type: row.type,
    school: row.school_code || null,
    title: row.title,
    achievementDate: row.achievement_date || null,
    amountInr: row.amount_inr == null ? null : Number(row.amount_inr),
    affiliation: row.atlas_affiliation || null,
    details: parseJson(row.details, {}) || {},
    status: row.status,
    imported: row.source === "IMPORT",
    reviewNote: row.review_note || null,
    reviewerName: row.reviewer_name || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    files: extra.files.get(row.id) || [],
    links: extra.links.get(row.id) || [],
    contributors: extra.contributors.get(row.id) || [],
  };
}

function group(rows, map) {
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.achievement_id)) out.set(r.achievement_id, []);
    out.get(r.achievement_id).push(map(r));
  }
  return out;
}

async function extrasFor(db, ids) {
  if (!ids.length) return { files: new Map(), links: new Map(), contributors: new Map() };
  const [files, links, contributors] = await Promise.all([
    db.query(
      `SELECT id, achievement_id, slot, original_filename, byte_size FROM \`${T.achievementFiles}\`
        WHERE achievement_id IN (?) ORDER BY created_at ASC, original_filename ASC`, [ids]),
    db.query(
      `SELECT id, achievement_id, slot, url FROM \`${T.achievementLinks}\` WHERE achievement_id IN (?) ORDER BY created_at ASC, id ASC`, [ids]),
    db.query(
      `SELECT id, achievement_id, name, email FROM \`${T.achievementContributors}\` WHERE achievement_id IN (?) ORDER BY position ASC, name ASC`, [ids]),
  ]);
  return {
    files: group(files, (f) => ({ id: f.id, slot: f.slot, name: f.original_filename, size: Number(f.byte_size) })),
    links: group(links, (l) => ({ id: l.id, slot: l.slot, url: l.url })),
    contributors: group(contributors, (c) => ({ id: c.id, name: c.name, email: c.email || null })),
  };
}

/** SQL condition: the proof is still only a Drive link (links, no uploaded file). */
const NEEDS_PROOF_SQL = `EXISTS (SELECT 1 FROM \`${T.achievementLinks}\` l WHERE l.achievement_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM \`${T.achievementFiles}\` f WHERE f.achievement_id = a.id)`;

/**
 * List achievements, newest first.
 * filters: { viewer?: { id, email } — the user's own entries AND entries that
 *            name them as a contributor, type?, school?, status?, from?, to?
 *            (dates "YYYY-MM-DD", inclusive), needsProof?, imported? }
 */
export async function listAchievements(db, filters = {}) {
  const where = [];
  const params = [];
  if (filters.viewer) {
    where.push(`(a.user_id = ? OR EXISTS (SELECT 1 FROM \`${T.achievementContributors}\` c WHERE c.achievement_id = a.id AND c.email = ?))`);
    params.push(filters.viewer.id, normEmail(filters.viewer.email));
  }
  if (filters.type) { where.push("a.type = ?"); params.push(filters.type); }
  if (filters.school) { where.push("a.school_code = ?"); params.push(filters.school); }
  if (filters.status) { where.push("a.status = ?"); params.push(filters.status); }
  if (filters.from) { where.push("a.achievement_date >= ?"); params.push(filters.from); }
  if (filters.to) { where.push("a.achievement_date <= ?"); params.push(filters.to); }
  if (filters.needsProof) where.push(NEEDS_PROOF_SQL);
  if (filters.imported === true) where.push("a.source = 'IMPORT'");
  const rows = await db.query(
    `SELECT ${COLS} ${FROM} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.achievement_date IS NULL, a.achievement_date DESC, a.created_at DESC LIMIT 10000`,
    params,
  );
  const extra = await extrasFor(db, rows.map((r) => r.id));
  return rows.map((r) => shape(r, extra));
}

export async function getAchievement(db, id) {
  const row = await db.one(`SELECT ${COLS} ${FROM} WHERE a.id = ?`, [id]);
  if (!row) return null;
  return shape(row, await extrasFor(db, [row.id]));
}

/** Is `email` listed as a contributor on this achievement? */
export async function isContributor(db, achievementId, email) {
  if (!email) return false;
  return !!(await db.one(
    `SELECT 1 AS x FROM \`${T.achievementContributors}\` WHERE achievement_id = ? AND email = ? LIMIT 1`,
    [achievementId, normEmail(email)],
  ));
}

/**
 * Insert one achievement with its files, Drive links and contributors (call
 * inside a transaction). `source`/`sourceKey` mark imported rows; `createdAt`
 * keeps the original form timestamp.
 */
export async function insertAchievement(tx, { id, userId, data, files = [], links = [], contributors = [], source = null, sourceKey = null, createdAt = null }) {
  await tx.exec(
    `INSERT INTO \`${T.achievements}\`
       (id, user_id, type, school_code, title, achievement_date, amount_inr, atlas_affiliation, details, status, source, source_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, ?, COALESCE(?, UTC_TIMESTAMP(3)), UTC_TIMESTAMP(3))`,
    [id, userId, data.type, data.school || null, data.title, data.achievementDate || null, data.amountInr ?? null,
      data.affiliation || null, JSON.stringify(data.details || {}), source, sourceKey, createdAt],
  );
  await addFiles(tx, id, files);
  if (links.length) {
    await tx.exec(
      `INSERT INTO \`${T.achievementLinks}\` (id, achievement_id, slot, url, created_at) VALUES ?`,
      [links.map((l) => [uuid(), id, l.slot, String(l.url).slice(0, 1000), new Date()])],
    );
  }
  if (contributors.length) {
    await tx.exec(
      `INSERT INTO \`${T.achievementContributors}\` (id, achievement_id, name, email, position) VALUES ?`,
      [contributors.map((c, i) => [uuid(), id, String(c.name).slice(0, 200), c.email ? normEmail(c.email) : null, i])],
    );
  }
}

/** Add stored files to an achievement. files: [{ id, slot, key, name, mime, size, sha }] */
export async function addFiles(tx, achievementId, files) {
  if (!files.length) return;
  await tx.exec(
    `INSERT INTO \`${T.achievementFiles}\` (id, achievement_id, slot, storage_key, original_filename, mime_type, byte_size, sha256, created_at) VALUES ?`,
    [files.map((f) => [f.id, achievementId, f.slot, f.key, f.name, f.mime, f.size, f.sha, new Date()])],
  );
}

/** Was a row with this import key already imported? */
export async function sourceKeyExists(db, sourceKey) {
  return !!(await db.one(`SELECT 1 AS x FROM \`${T.achievements}\` WHERE source_key = ? LIMIT 1`, [sourceKey]));
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

/** Delete an achievement (files, links, contributors cascade). Returns the storage keys to remove afterwards. */
export async function deleteAchievement(tx, id) {
  const keys = (await tx.query(`SELECT storage_key FROM \`${T.achievementFiles}\` WHERE achievement_id = ?`, [id])).map((r) => r.storage_key);
  const r = await tx.exec(`DELETE FROM \`${T.achievements}\` WHERE id = ?`, [id]);
  return r.affectedRows ? keys : null;
}

// ---- ORCID (research_faculty_profiles) -------------------------------------------

export async function getOrcid(db, userId) {
  return (await db.one(`SELECT orcid FROM \`${T.facultyProfiles}\` WHERE user_id = ?`, [userId]))?.orcid || null;
}

/** Set (or clear with null) a user's ORCID iD. `orcid` must already be validated. */
export async function setOrcid(db, userId, orcid) {
  await db.exec(
    `INSERT INTO \`${T.facultyProfiles}\` (user_id, orcid, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE orcid = VALUES(orcid), updated_at = UTC_TIMESTAMP(3)`,
    [userId, orcid],
  );
}
