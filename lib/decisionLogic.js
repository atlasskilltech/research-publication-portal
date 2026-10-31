// Pure editorial-decision logic (Phase 4): validation, eligibility, effects,
// author/manager shaping and editorial-dashboard categories. No I/O. The SQL
// functions in 0008_editorial_decisions.sql are authoritative and
// transactional; the API uses these first for precise errors, and the tests
// pin the rules.
import { canManageRevisions, reviewsForAuthor, OPEN_STATUSES, displayStatus } from "./revisionLogic.js";

export const DECISIONS = ["ACCEPT", "MINOR_REVISION", "MAJOR_REVISION", "REJECT"];
export const DECISION_LABEL = {
  ACCEPT: "Accepted",
  MINOR_REVISION: "Minor revision",
  MAJOR_REVISION: "Major revision",
  REJECT: "Rejected",
};
export const SUMMARY_MAX = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What releasing each decision does (mirrors release_editorial_decision). */
export const DECISION_EFFECT = {
  ACCEPT: { paperStatus: "ACCEPTED", revisionType: null },
  REJECT: { paperStatus: "REJECTED", revisionType: null },
  MINOR_REVISION: { paperStatus: "REVISION", revisionType: "MINOR" },
  MAJOR_REVISION: { paperStatus: "REVISION", revisionType: "MAJOR" },
};
export const isRevisionDecision = (d) => d === "MINOR_REVISION" || d === "MAJOR_REVISION";

/** Same authority as revisions: an admin, or the paper's assigned EDITOR. Reviewers never. */
export const canDecide = canManageRevisions;

/** Validate a decision payload. */
export function validateDecision(input, now = new Date()) {
  const fields = {};
  const decision = String(input?.decision || "").toUpperCase();
  if (!DECISIONS.includes(decision)) fields.decision = "Choose a decision.";
  const summary = typeof input?.summary === "string" ? input.summary.trim() : "";
  if (!summary) fields.summary = "Write a decision summary for the author.";
  else if (summary.length > SUMMARY_MAX) fields.summary = `Too long (max ${SUMMARY_MAX} characters).`;
  const confidentialNote = typeof input?.confidentialNote === "string" ? input.confidentialNote.trim() : "";
  if (confidentialNote.length > SUMMARY_MAX) fields.confidentialNote = `Too long (max ${SUMMARY_MAX} characters).`;

  const reviewIds = Array.isArray(input?.reviewIds) ? [...new Set(input.reviewIds.map(String))] : [];
  if (!reviewIds.every((id) => UUID.test(id))) fields.reviewIds = "Invalid review selection.";
  else if (isRevisionDecision(decision) && !reviewIds.length) fields.reviewIds = "Share at least one review with the author for a revision.";

  let dueAt = null;
  if (input?.dueAt && isRevisionDecision(decision)) {
    const d = new Date(input.dueAt);
    if (Number.isNaN(d.getTime())) fields.dueAt = "Invalid deadline.";
    else if (d.getTime() <= now.getTime()) fields.dueAt = "The deadline must be in the future.";
    else dueAt = d.toISOString();
  }
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { decision, summary, confidentialNote: confidentialNote || null, reviewIds, dueAt } };
}

/**
 * Can a decision be saved for the paper's current round?
 *   paper UNDER_REVIEW, no open revision, >= 1 SUBMITTED review this round,
 *   no decision already communicated this round, released reviews valid.
 */
export function decisionEligibility({ paper, reviews, decisions, revisions, reviewIds = [], decision }) {
  if (!paper) return { ok: false, status: 404, error: "Submission not found." };
  if (paper.status !== "UNDER_REVIEW") {
    return { ok: false, status: 409, error: `Decisions can only be made while the paper is under review (it is ${paper.status}).` };
  }
  if ((revisions || []).some((r) => OPEN_STATUSES.includes(r.status))) {
    return { ok: false, status: 409, error: "This paper has an open revision." };
  }
  const round = paper.current_round ?? 0;
  const submitted = (reviews || []).filter((r) => r.round === round && r.status === "SUBMITTED");
  if (!submitted.length) return { ok: false, status: 409, error: "A decision needs at least one submitted review for the current round." };
  if ((decisions || []).some((d) => d.round === round && d.released_at)) {
    return { ok: false, status: 409, error: "A decision has already been communicated for this round." };
  }
  const ok = new Set(submitted.map((r) => r.id));
  if (!reviewIds.every((id) => ok.has(id))) return { ok: false, status: 422, error: "Only submitted reviews from the current round can be shared." };
  if (isRevisionDecision(decision) && !reviewIds.length) return { ok: false, status: 422, error: "Share at least one review with the author for a revision." };
  return { ok: true, round };
}

/** Can this decision be communicated now (with the version the caller saw)? */
export function canRelease({ paper, decision, expectedVersion }) {
  if (!decision) return { ok: false, status: 404, error: "Decision not found." };
  if (decision.released_at) return { ok: false, status: 409, error: "This decision has already been communicated." };
  if (decision.version !== expectedVersion) return { ok: false, status: 409, error: "This decision was changed by someone else. Reload and review it before communicating." };
  if (!paper || paper.status !== "UNDER_REVIEW" || decision.round !== (paper.current_round ?? 0)) {
    return { ok: false, status: 409, error: "The paper is no longer awaiting this decision." };
  }
  return { ok: true };
}

/** A communicated decision is history: never editable. */
export const isEditable = (decision) => !!decision && !decision.released_at;

/** Author-facing "what now". */
export function nextActionFor(decision, revision) {
  switch (decision) {
    case "ACCEPT": return "No action needed. Your paper is accepted and will move to the publication workflow.";
    case "REJECT": return "No further action is possible on this submission.";
    case "MINOR_REVISION":
    case "MAJOR_REVISION":
      if (revision && ["REVISION_SUBMITTED", "REVISION_UNDER_REVIEW"].includes(revision.status)) {
        return "Your revision has been submitted. No action needed right now.";
      }
      return "Revise your manuscript, write a point-by-point response, and submit the revision.";
    default: return "";
  }
}

/**
 * Decision as the AUTHOR sees it — RELEASED decisions only (null otherwise).
 * No decision maker, no confidential note, reviewers anonymous and reduced to
 * comments_to_author.
 */
export function decisionForAuthor(dec, reviews, revision, now = new Date()) {
  if (!dec || !dec.released_at) return null;
  return {
    round: dec.round,
    decision: dec.decision,
    label: DECISION_LABEL[dec.decision],
    decidedAt: dec.released_at,
    message: dec.summary,
    reviews: reviewsForAuthor(reviews, dec.review_ids),
    nextAction: nextActionFor(dec.decision, revision),
    revisionRound: revision ? revision.round : null,
    revisionDueAt: revision ? revision.due_at : null,
    revisionStatus: revision ? displayStatus(revision, now) : null,
  };
}

/** Decision as a MANAGER sees it (full, incl. confidential note and names). */
export function decisionForManager(dec, nameById) {
  return {
    id: dec.id,
    round: dec.round,
    decision: dec.decision,
    label: DECISION_LABEL[dec.decision],
    summary: dec.summary,
    confidentialNote: dec.confidential_note || null,
    reviewIds: dec.review_ids || [],
    revisionDueAt: dec.revision_due_at,
    revisionId: dec.revision_id,
    version: dec.version,
    decidedBy: nameById?.get(dec.decided_by) || null,
    createdAt: dec.created_at,
    updatedAt: dec.updated_at,
    releasedAt: dec.released_at,
    releasedBy: dec.released_at ? nameById?.get(dec.released_by) || null : null,
    editable: isEditable(dec),
  };
}

/**
 * Editorial-dashboard bucket for a paper.
 *   AWAITING_REVIEWS   under review, no submitted review this round
 *   AWAITING_DECISION  under review, >= 1 submitted review, nothing communicated this round
 *   REVISION           revision requested / in progress / submitted
 *   ACCEPTED / REJECTED
 *   OTHER              anything else (e.g. SUBMITTED, not yet assigned)
 */
export function editorialCategory(paper, roundReviews, decisions) {
  if (paper.status === "ACCEPTED") return "ACCEPTED";
  if (paper.status === "REJECTED") return "REJECTED";
  if (paper.status === "REVISION") return "REVISION";
  if (paper.status === "UNDER_REVIEW") {
    const round = paper.current_round ?? 0;
    if ((decisions || []).some((d) => d.round === round && d.released_at)) return "OTHER";
    return (roundReviews || []).some((r) => r.status === "SUBMITTED") ? "AWAITING_DECISION" : "AWAITING_REVIEWS";
  }
  return "OTHER";
}
