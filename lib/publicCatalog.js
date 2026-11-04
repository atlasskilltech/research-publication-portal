import "server-only";

import { db, T } from "@/lib/db";
import { jrow, jrows } from "@/lib/repos/rows.mjs";
import { publicPublication, publicVolume, publicIssue, isPubliclyVisible, isUuid } from "@/lib/publicationLogic";

/**
 * Read-only PUBLIC catalogue (no session). Every query here restricts itself
 * to the FULLY published chain — a publication is visible only when it, its
 * issue AND that issue's volume are all PUBLISHED; an issue only when it and its
 * volume are PUBLISHED — and data leaves exclusively through the whitelisting
 * shapers in lib/publicationLogic.js: no paper ids, manuscript ids, user ids,
 * storage keys, emails, reviews, decisions or activity.
 * Shared by the public pages and the /api/public/* routes.
 */

const PUB_COLS = `p.id, p.volume_id, p.issue_id, p.title, p.abstract, p.authors, p.keywords, p.page_start, p.page_end, p.doi,
  p.publication_date, p.manuscript_public, p.manuscript_id, p.status`;
const VOL_COLS = "v.id, v.volume_number, v.year, v.title, v.description, v.status, v.published_at";
const ISS_COLS = "i.id, i.volume_id, i.issue_number, i.title, i.description, i.publication_date, i.status";

/** FROM clause joining a publication to its issue and volume, all PUBLISHED. */
const PUBLISHED_PUBS = `FROM \`${T.publications}\` p
  JOIN \`${T.issues}\` i ON i.id = p.issue_id AND i.volume_id = p.volume_id AND i.status = 'PUBLISHED'
  JOIN \`${T.volumes}\` v ON v.id = i.volume_id AND v.status = 'PUBLISHED'
  WHERE p.status = 'PUBLISHED'`;

/** Everything published: volumes → issues → publications (all shaped). */
export async function getPublishedCatalog() {
  const [vols, issues, pubs] = await Promise.all([
    db.query(`SELECT ${VOL_COLS} FROM \`${T.volumes}\` v WHERE v.status = 'PUBLISHED' ORDER BY v.year DESC, v.volume_number DESC`),
    db.query(
      `SELECT ${ISS_COLS} FROM \`${T.issues}\` i JOIN \`${T.volumes}\` v ON v.id = i.volume_id AND v.status = 'PUBLISHED'
        WHERE i.status = 'PUBLISHED' ORDER BY i.issue_number ASC`,
    ),
    db.query(`SELECT ${PUB_COLS} ${PUBLISHED_PUBS} ORDER BY p.publication_date DESC LIMIT 2000`).then(jrows),
  ]);

  const volById = new Map(vols.map((v) => [v.id, v]));
  const issById = new Map(issues.map((i) => [i.id, i]));
  const publications = pubs
    .map((p) => {
      const issue = issById.get(p.issue_id);
      return publicPublication(p, issue, issue && volById.get(issue.volume_id));
    })
    .filter(Boolean);

  const volumes = vols.map((v) => ({
    ...publicVolume(v),
    issues: issues
      .filter((i) => i.volume_id === v.id)
      .map((i) => ({ ...publicIssue(i, v), paperCount: publications.filter((p) => p.issue.id === i.id).length })),
  }));
  return { volumes, publications };
}

/** One published publication (in a published issue + volume), or null. */
export async function getPublishedPublication(id) {
  if (!isUuid(id)) return null;
  const p = jrow(await db.one(`SELECT ${PUB_COLS} ${PUBLISHED_PUBS} AND p.id = ?`, [id]));
  if (!p) return null;
  const issue = await db.one(`SELECT ${ISS_COLS} FROM \`${T.issues}\` i WHERE i.id = ? AND i.status = 'PUBLISHED'`, [p.issue_id]);
  if (!issue) return null;
  const volume = await db.one(`SELECT ${VOL_COLS} FROM \`${T.volumes}\` v WHERE v.id = ? AND v.status = 'PUBLISHED'`, [issue.volume_id]);
  return publicPublication(p, issue, volume);
}

/** One published volume with its published issues and papers, or null. */
export async function getPublishedVolume(id) {
  if (!isUuid(id)) return null;
  const { volumes, publications } = await getPublishedCatalog();
  const volume = volumes.find((v) => v.id === id);
  if (!volume) return null;
  return { volume, publications: publications.filter((p) => p.volume.id === id) };
}

/** One published issue (in a published volume) with its papers, or null. */
export async function getPublishedIssue(id) {
  if (!isUuid(id)) return null;
  const { volumes, publications } = await getPublishedCatalog();
  for (const v of volumes) {
    const issue = v.issues.find((i) => i.id === id);
    if (issue) {
      const { issues, ...volume } = v;
      return { volume, issue, publications: publications.filter((p) => p.issue.id === id) };
    }
  }
  return null;
}

/**
 * Server-only: the storage reference for a PUBLISHED publication's final
 * manuscript, only if its editor explicitly made it public AND the whole chain
 * is published. Never returned to clients — the route streams the bytes.
 */
export async function getPublicManuscriptRef(id) {
  if (!isUuid(id)) return null;
  const p = jrow(await db.one(`SELECT ${PUB_COLS} ${PUBLISHED_PUBS} AND p.id = ? AND p.manuscript_public = 1 AND p.manuscript_id IS NOT NULL`, [id]));
  if (!p || !p.manuscript_public || !p.manuscript_id) return null;
  const issue = await db.one(`SELECT ${ISS_COLS} FROM \`${T.issues}\` i WHERE i.id = ?`, [p.issue_id]);
  const volume = issue ? await db.one(`SELECT ${VOL_COLS} FROM \`${T.volumes}\` v WHERE v.id = ?`, [issue.volume_id]) : null;
  if (!isPubliclyVisible(p, issue, volume)) return null; // belt and braces
  const m = await db.one(
    `SELECT storage_key, mime_type FROM \`${T.paperManuscripts}\` WHERE id = ? AND paper_id = (SELECT paper_id FROM \`${T.publications}\` WHERE id = ?)`,
    [p.manuscript_id, id],
  );
  if (!m) return null;
  return { storageKey: m.storage_key, mimeType: m.mime_type, title: p.title };
}
