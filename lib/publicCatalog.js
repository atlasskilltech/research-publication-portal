import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { publicPublication, publicVolume, publicIssue, isPubliclyVisible, isUuid } from "@/lib/publicationLogic";

/**
 * Read-only PUBLIC catalogue (no session). Uses the service-role client but
 * only ever queries status = 'PUBLISHED' rows and returns data exclusively
 * through the whitelisting shapers in lib/publicationLogic.js — no paper ids,
 * user ids, storage keys, emails, reviews, decisions or activity.
 * Shared by the public pages and the /api/public/* routes.
 */

const PUB_COLS = "id, volume_id, issue_id, title, abstract, authors, keywords, page_start, page_end, doi, publication_date, manuscript_public, manuscript_id, status";
const VOL_COLS = "id, volume_number, year, title, description, status, published_at";
const ISS_COLS = "id, volume_id, issue_number, title, description, publication_date, status";

/** Everything published: volumes → issues → publications (all shaped). */
export async function getPublishedCatalog() {
  const admin = createAdminClient();
  const [{ data: vols, error: e1 }, { data: issues, error: e2 }, { data: pubs, error: e3 }] = await Promise.all([
    admin.from("volumes").select(VOL_COLS).eq("status", "PUBLISHED").order("year", { ascending: false }).order("volume_number", { ascending: false }),
    admin.from("issues").select(ISS_COLS).eq("status", "PUBLISHED").order("issue_number", { ascending: true }),
    admin.from("publications").select(PUB_COLS).eq("status", "PUBLISHED").order("publication_date", { ascending: false }).limit(2000),
  ]);
  if (e1 || e2 || e3) throw e1 || e2 || e3;

  const volById = new Map((vols || []).map((v) => [v.id, v]));
  const issById = new Map((issues || []).map((i) => [i.id, i]));
  const publications = (pubs || [])
    .map((p) => {
      const issue = issById.get(p.issue_id);
      return publicPublication(p, issue, issue && volById.get(issue.volume_id));
    })
    .filter(Boolean);

  const volumes = (vols || []).map((v) => ({
    ...publicVolume(v),
    issues: (issues || [])
      .filter((i) => i.volume_id === v.id)
      .map((i) => ({ ...publicIssue(i, v), paperCount: publications.filter((p) => p.issue.id === i.id).length })),
  }));
  return { volumes, publications };
}

/** One published publication, or null. */
export async function getPublishedPublication(id) {
  if (!isUuid(id)) return null;
  const admin = createAdminClient();
  const { data: p } = await admin.from("publications").select(PUB_COLS).eq("id", id).eq("status", "PUBLISHED").maybeSingle();
  if (!p) return null;
  const { data: issue } = await admin.from("issues").select(ISS_COLS).eq("id", p.issue_id).eq("status", "PUBLISHED").maybeSingle();
  if (!issue) return null;
  const { data: volume } = await admin.from("volumes").select(VOL_COLS).eq("id", issue.volume_id).eq("status", "PUBLISHED").maybeSingle();
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
 * manuscript, only if its editor explicitly made it public. Never returned
 * to clients — the route streams the bytes.
 */
export async function getPublicManuscriptRef(id) {
  if (!isUuid(id)) return null;
  const admin = createAdminClient();
  const { data: p } = await admin.from("publications").select(PUB_COLS).eq("id", id).eq("status", "PUBLISHED").maybeSingle();
  if (!p || !p.manuscript_public || !p.manuscript_id) return null;
  const { data: issue } = await admin.from("issues").select(ISS_COLS).eq("id", p.issue_id).maybeSingle();
  const { data: volume } = issue ? await admin.from("volumes").select(VOL_COLS).eq("id", issue.volume_id).maybeSingle() : { data: null };
  if (!isPubliclyVisible(p, issue, volume)) return null;
  const { data: m } = await admin.from("paper_manuscripts").select("storage_key, mime_type").eq("id", p.manuscript_id).maybeSingle();
  if (!m) return null;
  return { storageKey: m.storage_key, mimeType: m.mime_type, title: p.title };
}
