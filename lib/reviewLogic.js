// Pure peer-review logic: validation, assignment eligibility, and response
// shaping for double-blind + confidential separation. No I/O, no env, no
// framework imports — so the security-critical rules are unit-testable without
// a database. The API routes apply these against authoritative server state.

export const RECOMMENDATIONS = ["ACCEPT", "MINOR_REVISION", "MAJOR_REVISION", "REJECT"];
export const SCORE_FIELDS = ["technical_quality", "originality", "methodology", "clarity"];
export const TEXT_LIMITS = {
  strengths: 5000,
  weaknesses: 5000,
  comments_to_author: 20000,
  confidential_to_editor: 10000,
};

function toNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
function toStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Validate a review payload. `final === true` means the reviewer is SUBMITTING
 * (all evaluation fields required); otherwise it's a DRAFT (lenient, but still
 * range/length-checked). Returns { ok, value } or { ok:false, fields }.
 *
 * `comments_to_author` (author-visible) and `confidential_to_editor`
 * (editor/admin-only) are kept as SEPARATE fields throughout.
 */
export function validateReview(input, { final = false } = {}) {
  const fields = {};
  const rec = toStr(input?.recommendation).toUpperCase();

  const scores = {
    technical_quality: toNum(input?.technicalQuality),
    originality: toNum(input?.originality),
    methodology: toNum(input?.methodology),
    clarity: toNum(input?.clarity),
  };
  const text = {
    strengths: toStr(input?.strengths),
    weaknesses: toStr(input?.weaknesses),
    comments_to_author: toStr(input?.commentsToAuthor),
    confidential_to_editor: toStr(input?.confidentialToEditor),
  };

  // Always: length caps + score range (when a score is present).
  for (const [k, max] of Object.entries(TEXT_LIMITS)) {
    if (text[k].length > max) fields[k] = `Too long (max ${max} characters).`;
  }
  for (const f of SCORE_FIELDS) {
    const v = scores[f];
    if (v !== null && (!Number.isInteger(v) || v < 1 || v > 5)) fields[f] = "Score must be an integer 1–5.";
  }

  if (final) {
    if (!RECOMMENDATIONS.includes(rec)) fields.recommendation = "Select an overall recommendation.";
    for (const f of SCORE_FIELDS) if (scores[f] === null) fields[f] = "This evaluation is required.";
    if (!text.strengths) fields.strengths = "Please list the strengths.";
    if (!text.weaknesses) fields.weaknesses = "Please list the weaknesses.";
    if (!text.comments_to_author) fields.comments_to_author = "Comments to the author are required.";
  } else if (rec && !RECOMMENDATIONS.includes(rec)) {
    fields.recommendation = "Invalid recommendation.";
  }

  if (Object.keys(fields).length) return { ok: false, fields };
  return {
    ok: true,
    value: {
      recommendation: rec || null,
      technical_quality: scores.technical_quality,
      originality: scores.originality,
      methodology: scores.methodology,
      clarity: scores.clarity,
      strengths: text.strengths || null,
      weaknesses: text.weaknesses || null,
      comments_to_author: text.comments_to_author || null,
      confidential_to_editor: text.confidential_to_editor || null,
    },
  };
}

/** A reviewer may be assigned a role only if they already hold it (user_roles). */
export function canAssignRole(role, assigneeRoles) {
  return Array.isArray(assigneeRoles) && assigneeRoles.includes(role);
}

/** Strip author identity from a paper for reviewer-facing responses (double-blind). */
export function paperForReviewer(paper) {
  if (!paper) return paper;
  const { authors, ...rest } = paper;
  return rest;
}

/** Author-facing review: NEVER includes the confidential-to-editor field. */
export function reviewForAuthor(review) {
  if (!review) return review;
  const { confidential_to_editor, ...rest } = review;
  return rest;
}

/** Editor/admin-facing review: full record (includes confidential comments). */
export function reviewForEditor(review) {
  return review;
}

// ---- Roles, conflicts, and viewer-specific shaping -------------------------

/** Assignment roles that write a peer review (SPOC/EDITOR assignments do not). */
export const REVIEWER_ROLES = ["PEER_REVIEWER", "DESK_REVIEWER"];

/** Does `userId` hold a REVIEWER-role assignment on this paper? */
export function isReviewerAssignee(assignments, userId) {
  return (assignments || []).some((a) => a.assignee === userId && REVIEWER_ROLES.includes(a.role));
}

/**
 * Conflict of interest: a paper's submitter or any listed author (matched by
 * email, case-insensitive) must never be assigned to that paper.
 * Returns a reason string, or null when there is no conflict.
 */
export function assignmentConflict({ submittedBy, authorEmails = [] }, { id, email }) {
  if (submittedBy && id && submittedBy === id) return "The submitter cannot be assigned to their own paper.";
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (e && authorEmails.some((a) => typeof a === "string" && a.trim().toLowerCase() === e)) {
    return "This user is listed as an author of the paper.";
  }
  return null;
}

/**
 * Can this administrator assign `role` on this paper right now? → error string | null
 *   - never on a paper they submitted (they'd learn their own reviewers)
 *   - reviewer roles only while the paper is still in review
 *     (SUBMITTED / UNDER_REVIEW / REVISION) — not once it's decided/published
 * SPOC / EDITOR may still be assigned later (e.g. an editor for publication).
 */
export const REVIEWABLE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "REVISION"];
/**
 * Status a paper moves to when someone is assigned. Only a REVIEWER assignment
 * starts review; assigning a SPOC or EDITOR leaves a fresh submission SUBMITTED
 * (otherwise it would sit "under review" with nobody reviewing it).
 * Returns the new status, or null for no change.
 */
export function statusAfterAssignment(status, role) {
  return status === "SUBMITTED" && REVIEWER_ROLES.includes(role) ? "UNDER_REVIEW" : null;
}

export function assignmentBlock(paper, actorId, role) {
  if (!paper) return "Submission not found.";
  if (actorId && paper.submitted_by === actorId) return "You can't manage assignments on a paper you submitted.";
  if (REVIEWER_ROLES.includes(role) && !REVIEWABLE_STATUSES.includes(paper.status)) {
    return "Reviewers can only be assigned while the paper is in review.";
  }
  return null;
}

/**
 * Assignments as seen by each viewer:
 *   admin    → everything
 *   owner    → roles only, NO assignee ids (authors must not learn reviewer identity)
 *   reviewer → only their own rows (no discovering co-reviewers)
 */
export function assignmentsForViewer(assignments, viewerRole, meId) {
  const list = assignments || [];
  if (viewerRole === "admin") return list.map((a) => ({ assignee: a.assignee, role: a.role, dueAt: a.due_at ?? null }));
  if (viewerRole === "owner") return list.map((a) => ({ role: a.role }));
  return list.filter((a) => a.assignee === meId).map((a) => ({ assignee: a.assignee, role: a.role, dueAt: a.due_at ?? null }));
}

/**
 * Activity actions an AUTHOR may see. Everything else (assignments, review
 * drafts/submissions, reviewer downloads) would reveal reviewer identity or a
 * recommendation before any editorial decision. Mirrored in RLS (latest:
 * 0007_revisions.sql).
 */
export const OWNER_VISIBLE_ACTIONS = [
  "SUBMITTED",
  // Phase 3: the author's own revision steps and editor-side milestones that
  // carry no reviewer identity. Re-review activity stays hidden.
  "REVISION_REQUESTED",
  "REVISION_STARTED",
  "REVISION_MANUSCRIPT_UPLOADED",
  "REVISION_RESPONSE_SAVED",
  "REVISION_SUBMITTED",
  "REREVIEW_ASSIGNED",
  // Phase 4: a decision was communicated + the outcome. Draft events
  // (DECISION_CREATED / DECISION_UPDATED) stay hidden. Mirrored in 0008.
  "DECISION_COMMUNICATED",
  "PAPER_ACCEPTED",
  "PAPER_REJECTED",
  // Audit: authors are told when their paper is published. Mirrored in 0011.
  "PAPER_PUBLISHED",
];

/** Activity as seen by each viewer. Owners get an allowlisted, actor-free view. */
export function activityForViewer(activity, viewerRole) {
  const list = activity || [];
  if (viewerRole === "admin") return list;
  if (viewerRole === "owner") {
    return list
      .filter((a) => OWNER_VISIBLE_ACTIONS.includes(a.action))
      .map((a) => ({ action: a.action, created_at: a.created_at }));
  }
  return [];
}

/**
 * Deadline state for monitoring: "done" (submitted), "none" (no deadline),
 * "overdue", "due_soon" (within `soonDays`), or "on_track".
 */
export function deadlineState(dueAt, reviewStatus, now = new Date(), soonDays = 3) {
  if (reviewStatus === "SUBMITTED") return "done";
  if (!dueAt) return "none";
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "none";
  const t = now.getTime();
  if (due < t) return "overdue";
  if (due - t <= soonDays * 86400000) return "due_soon";
  return "on_track";
}

/** Totals for a list of monitoring rows ({ reviewStatus, deadline }). */
export function summarizeReviews(rows) {
  const s = { assigned: 0, pending: 0, draft: 0, submitted: 0, overdue: 0 };
  for (const r of rows || []) {
    s.assigned++;
    if (r.reviewStatus === "SUBMITTED") s.submitted++;
    else if (r.reviewStatus === "DRAFT") s.draft++;
    else s.pending++;
    if (r.deadline === "overdue") s.overdue++;
  }
  return s;
}
