// Pure revision & resubmission logic (Phase 3): state model, eligibility,
// numbering, manuscript-version access, point-by-point response validation and
// author/reviewer response shaping. No I/O, env or framework imports, so every
// rule is unit-testable without a database. The SQL functions in
// 0007_revisions.sql are the authoritative, transactional enforcement; the API
// uses these first so callers get precise errors.

export const REVISION_TYPES = ["MINOR", "MAJOR"];

export const RS = {
  REQUESTED: "REVISION_REQUESTED",
  IN_PROGRESS: "REVISION_IN_PROGRESS",
  SUBMITTED: "REVISION_SUBMITTED",
  UNDER_REVIEW: "REVISION_UNDER_REVIEW",
  OVERDUE: "REVISION_OVERDUE", // derived for display only — never stored
};
export const STORED_STATUSES = [RS.REQUESTED, RS.IN_PROGRESS, RS.SUBMITTED, RS.UNDER_REVIEW];
/** A revision the author can still change. */
export const AUTHOR_EDITABLE = [RS.REQUESTED, RS.IN_PROGRESS];
/** A revision that blocks a new request (one open revision per paper). */
export const OPEN_STATUSES = [RS.REQUESTED, RS.IN_PROGRESS, RS.SUBMITTED];

// Allowed transitions: from → to → who may perform it. `null` = no revision yet.
const TRANSITIONS = {
  null: { [RS.REQUESTED]: "manager" },
  [RS.REQUESTED]: { [RS.IN_PROGRESS]: "author", [RS.SUBMITTED]: "author" },
  [RS.IN_PROGRESS]: { [RS.IN_PROGRESS]: "author", [RS.SUBMITTED]: "author" },
  [RS.SUBMITTED]: { [RS.UNDER_REVIEW]: "manager" },
  [RS.UNDER_REVIEW]: {},
};

/** May `actor` ('author' | 'manager') move a revision from `from` to `to`? */
export function canTransition(from, to, actor) {
  const row = TRANSITIONS[from ?? "null"];
  return !!row && row[to] === actor;
}

/** Display status: adds REVISION_OVERDUE when the author is late. */
export function displayStatus(rev, now = new Date()) {
  if (!rev) return null;
  if (AUTHOR_EDITABLE.includes(rev.status) && rev.due_at) {
    const due = new Date(rev.due_at).getTime();
    if (!Number.isNaN(due) && due < now.getTime()) return RS.OVERDUE;
  }
  return rev.status;
}

/** Revision numbers are sequential: the next one is current_round + 1. */
export function nextRevisionRound(paper) {
  const r = Number(paper?.current_round ?? 0);
  return (Number.isInteger(r) && r >= 0 ? r : 0) + 1;
}

/** Latest revision (highest round) or null. */
export function latestRevision(revisions) {
  return (revisions || []).reduce((best, r) => (!best || r.round > best.round ? r : best), null);
}

/** Highest round released for re-review (0 = only the original). Mirrors paper_released_round(). */
export function releasedRound(revisions) {
  return (revisions || []).reduce((m, r) => (r.status === RS.UNDER_REVIEW && r.round > m ? r.round : m), 0);
}

export function isPaperOwner(paper, userId) {
  return !!paper && !!userId && paper.submitted_by === userId;
}

/** Admins, or a user assigned as EDITOR on this paper, manage revisions. */
export function canManageRevisions(me, assignments) {
  if (!me) return false;
  if (me.isAdmin) return true;
  return (assignments || []).some((a) => a.assignee === me.id && a.role === "EDITOR");
}

/**
 * Can a manager request a revision now?
 *   paper must be UNDER_REVIEW, no open revision, and every released review id
 *   must be a SUBMITTED review of the paper's current round.
 */
export function canRequestRevision({ paper, revisions, reviews, reviewIds }) {
  if (!paper) return { ok: false, status: 404, error: "Submission not found." };
  if (paper.status !== "UNDER_REVIEW") return { ok: false, status: 409, error: "A revision can only be requested while the paper is under review." };
  if ((revisions || []).some((r) => OPEN_STATUSES.includes(r.status))) {
    return { ok: false, status: 409, error: "This paper already has an open revision." };
  }
  const ids = [...new Set(reviewIds || [])];
  if (!ids.length) return { ok: false, status: 422, error: "Select at least one submitted review to share with the author." };
  const eligible = new Set(
    (reviews || [])
      .filter((r) => r.status === "SUBMITTED" && r.round === (paper.current_round ?? 0))
      .map((r) => r.id),
  );
  if (!ids.every((id) => eligible.has(id))) {
    return { ok: false, status: 422, error: "Only submitted reviews from the current round can be shared." };
  }
  return { ok: true, round: nextRevisionRound(paper) };
}

/** Can the author edit (draft/upload/submit) this revision? */
export function canAuthorEdit({ paper, revision, userId }) {
  if (!revision) return { ok: false, status: 404, error: "No revision has been requested for this paper." };
  if (!isPaperOwner(paper, userId)) return { ok: false, status: 404, error: "Not found." };
  if (!AUTHOR_EDITABLE.includes(revision.status)) {
    return { ok: false, status: 409, error: "This revision has already been submitted." };
  }
  return { ok: true };
}

// ---- Revision request validation -----------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INSTRUCTIONS_MAX = 10000;

export function validateRevisionRequest(input, now = new Date()) {
  const fields = {};
  const type = String(input?.type || "").toUpperCase();
  if (!REVISION_TYPES.includes(type)) fields.type = "Choose Minor or Major revision.";
  const instructions = typeof input?.instructions === "string" ? input.instructions.trim() : "";
  if (!instructions) fields.instructions = "Add instructions for the author.";
  else if (instructions.length > INSTRUCTIONS_MAX) fields.instructions = `Too long (max ${INSTRUCTIONS_MAX} characters).`;
  let dueAt = null;
  if (input?.dueAt) {
    const d = new Date(input.dueAt);
    if (Number.isNaN(d.getTime())) fields.dueAt = "Invalid deadline.";
    else if (d.getTime() <= now.getTime()) fields.dueAt = "The deadline must be in the future.";
    else dueAt = d.toISOString();
  }
  const reviewIds = Array.isArray(input?.reviewIds) ? [...new Set(input.reviewIds.map(String))] : [];
  if (!reviewIds.length) fields.reviewIds = "Select at least one review to share.";
  else if (!reviewIds.every((id) => UUID.test(id))) fields.reviewIds = "Invalid review selection.";
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { type, instructions, dueAt, reviewIds } };
}

// ---- Manuscript versions ---------------------------------------------------

/**
 * Manuscript versions a viewer may access:
 *   owner / admin → every version
 *   assigned reviewer/editor → versions <= the released round only (never a
 *   revision still being drafted or awaiting release)
 *   anyone else → none
 */
export function permittedVersions(viewer, versions, released) {
  const list = (versions || []).slice().sort((a, b) => a.version - b.version);
  if (viewer === "owner" || viewer === "admin") return list;
  if (viewer === "assigned") return list.filter((v) => v.version <= released);
  return [];
}

/** The version to serve when none is requested: the latest permitted one. */
export function defaultVersion(permitted) {
  return permitted.length ? permitted[permitted.length - 1] : null;
}

// ---- Point-by-point responses ---------------------------------------------
export const RESPONSE_LIMITS = { entries: 100, comment: 5000, response: 10000 };

/** Anonymous, stable labels for the reviews released with a revision. */
export function reviewLabels(reviewIds) {
  const byId = new Map();
  const byKey = new Map();
  (reviewIds || []).forEach((id, i) => {
    const key = `R${i + 1}`;
    byId.set(id, { key, label: `Reviewer ${i + 1}` });
    byKey.set(key, id);
  });
  return { byId, byKey };
}

/**
 * Validate author responses. Input entries use anonymous keys
 * ({ reviewKey: "R1" | "" (general), comment, response, addressed }).
 * Output stores real review ids (server-side only).
 * final=true: at least one entry, every entry answered, and every released
 * review addressed by at least one entry.
 */
export function validateResponses(entries, { final = false, reviewIds = [] } = {}) {
  const { byKey } = reviewLabels(reviewIds);
  const list = Array.isArray(entries) ? entries : [];
  const errors = [];
  if (list.length > RESPONSE_LIMITS.entries) return { ok: false, error: `At most ${RESPONSE_LIMITS.entries} responses.` };

  const value = list.map((e, i) => {
    const key = typeof e?.reviewKey === "string" ? e.reviewKey.trim() : "";
    const comment = typeof e?.comment === "string" ? e.comment.trim() : "";
    const response = typeof e?.response === "string" ? e.response.trim() : "";
    if (key && !byKey.has(key)) errors.push(`Response ${i + 1}: unknown reviewer reference.`);
    if (comment.length > RESPONSE_LIMITS.comment) errors.push(`Response ${i + 1}: comment reference too long.`);
    if (response.length > RESPONSE_LIMITS.response) errors.push(`Response ${i + 1}: response too long.`);
    if (final && !response) errors.push(`Response ${i + 1}: write your response.`);
    if (final && !comment) errors.push(`Response ${i + 1}: say which comment this answers.`);
    return { review_id: key ? byKey.get(key) || null : null, comment, response, addressed: e?.addressed === true };
  });

  if (final) {
    if (!value.length) errors.push("Add at least one point-by-point response.");
    const covered = new Set(value.map((v) => v.review_id).filter(Boolean));
    reviewIds.forEach((id, i) => { if (!covered.has(id)) errors.push(`Respond to Reviewer ${i + 1}'s comments.`); });
  }
  if (errors.length) return { ok: false, error: errors[0], errors };
  return { ok: true, value };
}

/** Responses for the AUTHOR: real review ids replaced by anonymous keys. */
export function responsesForAuthor(stored, reviewIds) {
  const { byId } = reviewLabels(reviewIds);
  return (stored || []).map((e) => ({
    reviewKey: e.review_id ? byId.get(e.review_id)?.key || "" : "",
    comment: e.comment || "",
    response: e.response || "",
    addressed: !!e.addressed,
  }));
}

/**
 * Responses for a REVIEWER: only entries answering THEIR review, plus general
 * entries. Never another reviewer's entries; no review ids.
 */
export function responsesForReviewer(stored, ownReviewId) {
  return (stored || [])
    .filter((e) => !e.review_id || (ownReviewId && e.review_id === ownReviewId))
    .map((e) => ({ comment: e.comment || "", response: e.response || "", addressed: !!e.addressed, general: !e.review_id }));
}

/**
 * Reviewer feedback the AUTHOR may see for a revision: only reviews released
 * with it, only SUBMITTED ones, and only comments_to_author. Never the
 * reviewer's identity, scores, recommendation, strengths/weaknesses or
 * confidential_to_editor.
 */
export function reviewsForAuthor(reviews, reviewIds) {
  const { byId } = reviewLabels(reviewIds);
  const byReview = new Map((reviews || []).map((r) => [r.id, r]));
  return (reviewIds || [])
    .map((id) => byReview.get(id))
    .filter((r) => r && r.status === "SUBMITTED")
    .map((r) => ({ key: byId.get(r.id).key, label: byId.get(r.id).label, commentsToAuthor: r.comments_to_author || "" }));
}

// ---- RPC error mapping -----------------------------------------------------
const RPC_ERRORS = {
  NOT_FOUND: [404, "Not found."],
  FORBIDDEN: [403, "You are not allowed to do that."],
  NOT_UNDER_REVIEW: [409, "This can only be done while the paper is under review."],
  OPEN_REVISION: [409, "This paper already has an open revision."],
  BAD_TYPE: [422, "Choose Minor or Major revision."],
  NO_REVIEWS: [422, "Select at least one submitted review to share."],
  BAD_REVIEWS: [422, "Only submitted reviews from the current round can be shared."],
  ALREADY_SUBMITTED: [409, "This revision has already been submitted."],
  NO_MANUSCRIPT: [422, "Upload the revised manuscript before submitting."],
  NO_RESPONSES: [422, "Add at least one point-by-point response."],
  NOT_SUBMITTED: [409, "The author has not submitted this revision yet."],
  NO_REVIEWERS: [409, "Assign at least one reviewer before starting the re-review."],
  // Phase 4 — editorial decisions (0008)
  BAD_DECISION: [422, "Choose Accept, Minor revision, Major revision or Reject."],
  NO_SUMMARY: [422, "Write a decision summary for the author."],
  NO_SUBMITTED_REVIEWS: [409, "A decision needs at least one submitted review for the current round."],
  DECISION_EXISTS: [409, "A decision has already been communicated for this round."],
  DECISION_FINAL: [409, "A communicated decision can't be changed."],
  STALE: [409, "This record was changed by someone else. Reload and try again."],
  // Phase 5 — publication management (0009)
  BAD_STATUS: [422, "Invalid status."],
  ALREADY_PUBLISHED: [409, "This is already published and can no longer be changed."],
  VOLUME_NOT_PUBLISHED: [409, "Publish the volume before publishing its issues."],
  ISSUE_NOT_PUBLISHED: [409, "Publish the issue before publishing papers in it."],
  PAPER_REJECTED: [409, "Rejected papers cannot be published."],
  REVISION_PENDING: [409, "This paper has a pending revision and cannot be published."],
  NOT_ACCEPTED: [409, "Only papers with a communicated ACCEPT decision can be published."],
  ALREADY_SCHEDULED: [409, "This paper already has a publication record."],
  ISSUE_NOT_FOUND: [404, "Issue not found."],
  ISSUE_VOLUME_MISMATCH: [422, "The selected issue does not belong to the selected volume."],
  BAD_MANUSCRIPT: [422, "The selected manuscript does not belong to this paper."],
};

/** Map a database error ('RPP:CODE' or a unique violation) to { status, error }. */
export function mapRpcError(err) {
  const msg = String(err?.message || "");
  const m = msg.match(/RPP:([A-Z_]+)/);
  if (m && RPC_ERRORS[m[1]]) return { status: RPC_ERRORS[m[1]][0], error: RPC_ERRORS[m[1]][1], code: m[1] };
  if (err?.code === "23505") return { status: 409, error: "This was just changed by another request. Reload and try again.", code: "CONFLICT" };
  return null;
}

// ---- Whole-revision shaping ------------------------------------------------
function manuscriptMeta(m, withFilename) {
  if (!m) return null;
  return {
    version: m.version,
    filename: withFilename ? m.original_filename || null : null,
    mimeType: m.mime_type,
    byteSize: m.byte_size,
    uploadedAt: m.created_at,
  };
}

/**
 * A revision as the AUTHOR sees it: no requester identity, released reviews
 * reduced to anonymous comments_to_author, responses keyed anonymously.
 */
export function revisionForAuthor(rev, reviews, manuscript, now = new Date()) {
  return {
    round: rev.round,
    type: rev.revision_type,
    instructions: rev.instructions,
    dueAt: rev.due_at,
    status: rev.status,
    displayStatus: displayStatus(rev, now),
    requestedAt: rev.requested_at,
    startedAt: rev.started_at,
    submittedAt: rev.submitted_at,
    editable: AUTHOR_EDITABLE.includes(rev.status),
    reviews: reviewsForAuthor(reviews, rev.review_ids),
    responses: responsesForAuthor(rev.responses, rev.review_ids),
    manuscript: manuscriptMeta(manuscript, true),
  };
}

/**
 * A revision as a MANAGER (admin/paper editor) sees it: who requested it, and
 * which reviewer each response answers. `reviewerNameById` maps review id →
 * reviewer display name.
 */
export function revisionForManager(rev, reviewerNameById, manuscript, now = new Date(), { withFilename = false } = {}) {
  const { byId } = reviewLabels(rev.review_ids);
  return {
    round: rev.round,
    type: rev.revision_type,
    instructions: rev.instructions,
    dueAt: rev.due_at,
    status: rev.status,
    displayStatus: displayStatus(rev, now),
    requestedAt: rev.requested_at,
    requestedBy: rev.requested_by,
    startedAt: rev.started_at,
    submittedAt: rev.submitted_at,
    rereviewStartedAt: rev.rereview_started_at,
    sharedReviews: (rev.review_ids || []).map((id) => ({
      key: byId.get(id).key, label: byId.get(id).label, reviewer: reviewerNameById?.get(id) || null,
    })),
    responses: (rev.responses || []).map((e) => ({
      reviewKey: e.review_id ? byId.get(e.review_id)?.key || "" : "",
      reviewer: e.review_id ? reviewerNameById?.get(e.review_id) || null : null,
      comment: e.comment || "", response: e.response || "", addressed: !!e.addressed,
    })),
    manuscript: manuscriptMeta(manuscript, withFilename) /* filenames can name the author → admins only */,
  };
}
