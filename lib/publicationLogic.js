// Pure publication-management logic (Phase 5): volume/issue/publication
// validation, state transitions, eligibility, authorization predicates and the
// PUBLIC response shaper. No I/O. The SQL functions in
// 0009_publication_management.sql are authoritative and transactional.
import { canManageRevisions, OPEN_STATUSES, mapRpcError } from "./revisionLogic.js";

export const CONTAINER_STATUSES = ["DRAFT", "SCHEDULED", "PUBLISHED"];
export const PUB_STATUSES = ["SCHEDULED", "PUBLISHED"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID.test(v);
export const DOI_RE = /^10\.[0-9]{4,9}\/\S+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- Authorization ---------------------------------------------------------
/** Volumes & issues: administrators only. */
export const canManageVolumes = (me) => !!me?.isAdmin;
/** A paper's publication record: admin or that paper's assigned EDITOR (same as decisions). */
export const canManagePublication = canManageRevisions;
/** May open the publication dashboard at all: admin, or anyone holding the EDITOR role. */
export const canOpenPublicationDashboard = (me) => !!me && (me.isAdmin || (me.roles || []).includes("EDITOR"));

// ---- Transitions -----------------------------------------------------------
/** Volume/issue: DRAFT ⇄ SCHEDULED, either → PUBLISHED; PUBLISHED is final. */
export function canTransitionContainer(from, to) {
  if (!CONTAINER_STATUSES.includes(from) || !CONTAINER_STATUSES.includes(to)) return false;
  if (from === "PUBLISHED") return false;
  return from !== to;
}
/** Publication: (none) → SCHEDULED → PUBLISHED. */
export function canTransitionPublication(from, to) {
  if (from == null) return to === "SCHEDULED";
  return from === "SCHEDULED" && to === "PUBLISHED";
}
/** An issue can be published only inside a published volume. */
export function canPublishIssue(issue, volume) {
  if (!issue || !volume) return { ok: false, status: 404, error: "Issue not found." };
  if (issue.status === "PUBLISHED") return { ok: false, status: 409, error: "This issue is already published." };
  if (volume.status !== "PUBLISHED") return { ok: false, status: 409, error: "Publish the volume before publishing its issues." };
  return { ok: true };
}

// ---- Eligibility -----------------------------------------------------------
/**
 * Can this paper get a publication record? Needs papers.status ACCEPTED backed
 * by a COMMUNICATED ACCEPT decision, no open revision, and no existing record.
 */
export function publicationEligibility({ paper, decisions, revisions, existing }) {
  if (!paper) return { ok: false, status: 404, error: "Paper not found." };
  if (paper.status === "REJECTED") return { ok: false, status: 409, error: "Rejected papers cannot be published." };
  if (paper.status === "REVISION" || (revisions || []).some((r) => OPEN_STATUSES.includes(r.status))) {
    return { ok: false, status: 409, error: "This paper has a pending revision and cannot be published." };
  }
  if (paper.status === "PUBLISHED" || existing) return { ok: false, status: 409, error: "This paper already has a publication record." };
  if (paper.status !== "ACCEPTED") return { ok: false, status: 409, error: "Only accepted papers can be published." };
  if (!(decisions || []).some((d) => d.decision === "ACCEPT" && d.released_at)) {
    return { ok: false, status: 409, error: "Only papers with a communicated ACCEPT decision can be published." };
  }
  return { ok: true };
}

/** Can a scheduled publication be published now? */
export function canPublishPaper({ publication, paper, issue }) {
  if (!publication) return { ok: false, status: 404, error: "Publication not found." };
  if (publication.status === "PUBLISHED") return { ok: false, status: 409, error: "Already published." };
  if (!paper || paper.status === "REJECTED") return { ok: false, status: 409, error: "Rejected papers cannot be published." };
  if (paper.status === "REVISION") return { ok: false, status: 409, error: "This paper has a pending revision and cannot be published." };
  if (paper.status !== "ACCEPTED") return { ok: false, status: 409, error: "Only accepted papers can be published." };
  if (!issue || issue.status !== "PUBLISHED") return { ok: false, status: 409, error: "Publish the issue before publishing papers in it." };
  return { ok: true };
}

export const issueBelongsToVolume = (issue, volumeId) => !!issue && !!volumeId && issue.volume_id === volumeId;

// ---- Validation ------------------------------------------------------------
const str = (v) => (typeof v === "string" ? v.trim() : "");
const intOrNull = (v) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
function validDate(v) {
  if (!v) return null;
  if (!DATE_RE.test(String(v))) return NaN;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? NaN : v;
}

export function validateVolume(input) {
  const fields = {};
  const volumeNumber = intOrNull(input?.volumeNumber);
  const year = intOrNull(input?.year);
  const title = str(input?.title);
  const description = str(input?.description);
  if (!Number.isInteger(volumeNumber) || volumeNumber < 1 || volumeNumber > 9999) fields.volumeNumber = "Volume number must be 1–9999.";
  if (!Number.isInteger(year) || year < 1900 || year > 2200) fields.year = "Enter a valid publication year.";
  if (!title) fields.title = "Title is required.";
  else if (title.length > 300) fields.title = "Title is too long (max 300).";
  if (description.length > 5000) fields.description = "Description is too long (max 5000).";
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { volume_number: volumeNumber, year, title, description } };
}

export function validateIssue(input, { requireVolume = true } = {}) {
  const fields = {};
  const volumeId = str(input?.volumeId);
  const issueNumber = intOrNull(input?.issueNumber);
  const title = str(input?.title);
  const description = str(input?.description);
  const publicationDate = validDate(input?.publicationDate);
  if (requireVolume && !isUuid(volumeId)) fields.volumeId = "Choose a volume.";
  if (!Number.isInteger(issueNumber) || issueNumber < 1 || issueNumber > 999) fields.issueNumber = "Issue number must be 1–999.";
  if (!title) fields.title = "Title is required.";
  else if (title.length > 300) fields.title = "Title is too long (max 300).";
  if (description.length > 5000) fields.description = "Description is too long (max 5000).";
  if (Number.isNaN(publicationDate)) fields.publicationDate = "Enter a valid date (YYYY-MM-DD).";
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { volume_id: volumeId || null, issue_number: issueNumber, title, description, publication_date: publicationDate } };
}

/** Publication metadata (schedule or edit). */
export function validatePublicationMeta(input) {
  const fields = {};
  const volumeId = str(input?.volumeId);
  const issueId = str(input?.issueId);
  const title = str(input?.title);
  const abstract = str(input?.abstract);
  const doi = str(input?.doi);
  const pageStart = intOrNull(input?.pageStart);
  const pageEnd = intOrNull(input?.pageEnd);
  const publicationDate = validDate(input?.publicationDate);
  const manuscriptId = str(input?.manuscriptId);

  if (!isUuid(volumeId)) fields.volumeId = "Choose a volume.";
  if (!isUuid(issueId)) fields.issueId = "Choose an issue.";
  if (!title) fields.title = "Published title is required.";
  else if (title.length > 500) fields.title = "Title is too long (max 500).";
  if (abstract.length > 10000) fields.abstract = "Abstract is too long (max 10000).";

  const authorsIn = Array.isArray(input?.authors) ? input.authors : [];
  const authors = authorsIn
    .map((a) => ({ name: str(a?.name), affiliation: str(a?.affiliation) }))
    .filter((a) => a.name || a.affiliation);
  if (!authors.length) fields.authors = "Add at least one author.";
  else if (authors.length > 50) fields.authors = "At most 50 authors.";
  else if (authors.some((a) => !a.name)) fields.authors = "Every author needs a name.";
  else if (authors.some((a) => a.name.length > 200 || a.affiliation.length > 300)) fields.authors = "Author name or affiliation too long.";

  const kwRaw = Array.isArray(input?.keywords) ? input.keywords : String(input?.keywords || "").split(",");
  const keywords = [...new Set(kwRaw.map((k) => str(k)).filter(Boolean))];
  if (keywords.length > 20) fields.keywords = "At most 20 keywords.";
  else if (keywords.some((k) => k.length > 60)) fields.keywords = "Each keyword must be 60 characters or fewer.";

  if (Number.isNaN(pageStart) || (pageStart !== null && pageStart < 1)) fields.pageStart = "First page must be a positive whole number.";
  if (Number.isNaN(pageEnd)) fields.pageEnd = "Last page must be a whole number.";
  else if (pageEnd !== null && (pageStart === null || Number.isNaN(pageStart) || pageEnd < pageStart)) fields.pageEnd = "Last page must be on or after the first page.";
  if (doi && (!DOI_RE.test(doi) || doi.length > 200)) fields.doi = "DOI must look like 10.1234/abc (optional).";
  if (Number.isNaN(publicationDate)) fields.publicationDate = "Enter a valid date (YYYY-MM-DD).";
  if (manuscriptId && !isUuid(manuscriptId)) fields.manuscriptId = "Invalid manuscript.";

  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    value: {
      volumeId, issueId, title, abstract, authors, keywords,
      pageStart, pageEnd, doi: doi || null, publicationDate,
      manuscriptId: manuscriptId || null, manuscriptPublic: input?.manuscriptPublic === true,
    },
  };
}

/** Default (editable) metadata for a newly scheduled paper — a snapshot. No emails. */
export function defaultPublicationMeta(paper, authors, manuscripts) {
  const latest = (manuscripts || []).reduce((b, m) => (!b || m.version > b.version ? m : b), null);
  return {
    title: paper?.title || "",
    abstract: paper?.abstract || "",
    keywords: paper?.keywords || [],
    authors: (authors || [])
      .slice()
      .sort((a, b) => (a.author_order ?? 0) - (b.author_order ?? 0))
      .map((a) => ({ name: a.full_name || "", affiliation: a.affiliation || "" })),
    manuscriptId: latest?.id || null,
  };
}

// ---- Public shaping ----------------------------------------------------------
/** Visible to the public only when the whole chain is published. */
export function isPubliclyVisible(pub, issue, volume) {
  return pub?.status === "PUBLISHED" && issue?.status === "PUBLISHED" && volume?.status === "PUBLISHED"
    && pub.issue_id === issue.id && issue.volume_id === volume.id;
}

/**
 * The ONLY shape a publication is ever returned in publicly. Whitelisted
 * fields: no paper id, no user ids, no storage keys, no emails, no review or
 * decision data. Returns null when not publicly visible.
 */
export function publicPublication(pub, issue, volume) {
  if (!isPubliclyVisible(pub, issue, volume)) return null;
  return {
    id: pub.id,
    title: pub.title,
    abstract: pub.abstract || "",
    authors: (pub.authors || []).map((a) => ({ name: String(a?.name || ""), affiliation: String(a?.affiliation || "") })),
    keywords: pub.keywords || [],
    pages: pub.page_start ? (pub.page_end && pub.page_end !== pub.page_start ? `${pub.page_start}–${pub.page_end}` : String(pub.page_start)) : null,
    doi: pub.doi || null,
    publicationDate: pub.publication_date || null,
    year: volume.year,
    volume: { id: volume.id, number: volume.volume_number, title: volume.title },
    issue: { id: issue.id, number: issue.issue_number, title: issue.title },
    manuscriptAvailable: !!(pub.manuscript_public && pub.manuscript_id),
  };
}

export function publicVolume(volume) {
  if (volume?.status !== "PUBLISHED") return null;
  return { id: volume.id, number: volume.volume_number, year: volume.year, title: volume.title, description: volume.description || "", publishedAt: volume.published_at };
}
export function publicIssue(issue, volume) {
  if (issue?.status !== "PUBLISHED" || volume?.status !== "PUBLISHED" || issue.volume_id !== volume.id) return null;
  return { id: issue.id, number: issue.issue_number, title: issue.title, description: issue.description || "", publicationDate: issue.publication_date, volumeId: volume.id };
}

/** Case-insensitive search over title, author names and keywords. */
export function matchesSearch(pp, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  if (String(pp.title || "").toLowerCase().includes(needle)) return true;
  if ((pp.authors || []).some((a) => String(a.name || "").toLowerCase().includes(needle))) return true;
  return (pp.keywords || []).some((k) => String(k).toLowerCase().includes(needle));
}

/** Map a unique-violation to a friendly message based on the constraint name. */
export function uniqueViolationMessage(err) {
  if (err?.code !== "23505") return null;
  const text = `${err.message || ""} ${err.details || ""}`;
  if (/volumes_year_volume_number_key|\(year, volume_number\)/.test(text)) return "A volume with this number already exists for that year.";
  if (/issues_volume_id_issue_number_key|\(volume_id, issue_number\)/.test(text)) return "This volume already has an issue with that number.";
  if (/publications_doi_uidx|lower\(doi\)/.test(text)) return "Another publication already uses this DOI.";
  if (/publications_paper_id_key|\(paper_id\)/.test(text)) return "This paper already has a publication record.";
  return "This conflicts with an existing record.";
}

/** Any known DB error (RPP:<CODE> or unique violation) → { status, error }, else null (→ 500). */
export function dbErrorToHttp(err) {
  const unique = uniqueViolationMessage(err);
  if (unique) return { status: 409, error: unique };
  const mapped = mapRpcError(err);
  return mapped ? { status: mapped.status, error: mapped.error } : null;
}
