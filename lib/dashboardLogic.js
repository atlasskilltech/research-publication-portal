// Pure dashboard + activity-feed logic (no I/O). Replaces the Phase-0 mock
// dashboard/activity with real data while keeping every existing privacy rule:
// authors never see reviewer identity; reviewers/editors never see author
// identity; confidential content never appears here at all.
import { deadlineState, REVIEWER_ROLES, OWNER_VISIBLE_ACTIONS } from "./reviewLogic.js";
import { displayStatus, AUTHOR_EDITABLE } from "./revisionLogic.js";
import { editorialCategory, DECISION_LABEL } from "./decisionLogic.js";

// ---- Activity labels (single source; also used by the submission page) -----
export const ACTION_LABEL = {
  SUBMITTED: "Paper submitted",
  ASSIGNED: "Assignment added",
  UNASSIGNED: "Assignment removed",
  REVIEW_STARTED: "Review started",
  REVIEW_SUBMITTED: "Review submitted",
  MANUSCRIPT_DOWNLOADED: "Manuscript downloaded by reviewer",
  REVISION_REQUESTED: "Revision requested",
  REVISION_STARTED: "Revision started",
  REVISION_MANUSCRIPT_UPLOADED: "Revised manuscript uploaded",
  REVISION_RESPONSE_SAVED: "Response to reviewers saved",
  REVISION_SUBMITTED: "Revision submitted",
  REREVIEW_ASSIGNED: "Revision sent for re-review",
  REREVIEW_STARTED: "Re-review started",
  REREVIEW_SUBMITTED: "Re-review submitted",
  DECISION_CREATED: "Decision drafted",
  DECISION_UPDATED: "Decision draft updated",
  DECISION_COMMUNICATED: "Decision communicated to author",
  PAPER_ACCEPTED: "Paper accepted",
  PAPER_REJECTED: "Paper rejected",
  PUBLICATION_SCHEDULED: "Scheduled for publication",
  PUBLICATION_UPDATED: "Publication details updated",
  PAPER_PUBLISHED: "Paper published",
};
export const actionLabel = (a) => ACTION_LABEL[a] || String(a || "").replace(/_/g, " ").toLowerCase();

// Actions performed BY THE AUTHOR — their actor id is author identity.
const AUTHOR_ACTIONS = new Set(["SUBMITTED", "REVISION_STARTED", "REVISION_MANUSCRIPT_UPLOADED", "REVISION_RESPONSE_SAVED", "REVISION_SUBMITTED"]);

/**
 * Shape raw paper_activity rows for one viewer. ctx:
 *   viewerId, isAdmin,
 *   ownPaperIds:Set     papers the viewer submitted
 *   editedPaperIds:Set  papers the viewer is EDITOR on
 *   submitterByPaper:Map paperId → submitted_by
 *   titleByPaper:Map, nameById:Map
 * Rules:
 *   own paper          → OWNER_VISIBLE_ACTIONS only, no actor (reviewer anonymity)
 *                        — applies to administrators too
 *   admin              → everything else, with actor names
 *   edited paper       → all actions, actor names EXCEPT the author (editors stay blind)
 *   viewer's own acts  → visible (e.g. "you submitted a review"), actor "You"
 *   anything else      → dropped
 */
export function shapeActivityFeed(rows, ctx) {
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (!r || seen.has(r.id)) continue;
    const pid = r.paper_id;
    const isOwn = ctx.ownPaperIds?.has(pid);
    const isEdited = ctx.editedPaperIds?.has(pid);
    const isMine = r.actor && r.actor === ctx.viewerId;
    let actor;
    // Own paper first: an administrator who authored it is the author here.
    if (isOwn) {
      if (!OWNER_VISIBLE_ACTIONS.includes(r.action)) continue;
      actor = null;
    } else if (ctx.isAdmin) actor = isMine ? "You" : ctx.nameById?.get(r.actor) || null;
    else if (isEdited) {
      const byAuthor = AUTHOR_ACTIONS.has(r.action) || (r.actor && r.actor === ctx.submitterByPaper?.get(pid));
      actor = isMine ? "You" : byAuthor ? null : ctx.nameById?.get(r.actor) || null;
    } else if (isMine) actor = "You";
    else continue;
    seen.add(r.id);
    // Details (round / decision / role) — never for an author viewing their own paper.
    const d = !isOwn && (ctx.isAdmin || isEdited || isMine) ? r.detail || {} : {};
    out.push({
      id: r.id,
      paperId: pid,
      paperTitle: ctx.titleByPaper?.get(pid) || null,
      action: r.action,
      label: actionLabel(r.action),
      at: r.created_at,
      actor,
      round: Number.isInteger(d.round) ? d.round : null,
      decision: d.decision ? DECISION_LABEL[d.decision] || null : null,
      role: typeof d.role === "string" ? d.role : null,
    });
  }
  return out.sort((a, b) => new Date(b.at) - new Date(a.at));
}

// ---- Dashboard sections -------------------------------------------------------

/** Author: own papers only. */
export function summarizeAuthor({ papers, revisions, decisions }, now = new Date()) {
  const list = papers || [];
  const count = (pred) => list.filter(pred).length;
  const titleOf = new Map(list.map((p) => [p.id, p.title]));
  const latestRev = new Map();
  (revisions || []).forEach((r) => { const c = latestRev.get(r.paper_id); if (!c || r.round > c.round) latestRev.set(r.paper_id, r); });
  const action = [...latestRev.values()]
    .filter((r) => AUTHOR_EDITABLE.includes(r.status))
    .map((r) => ({ paperId: r.paper_id, title: titleOf.get(r.paper_id) || null, round: r.round, type: r.revision_type, dueAt: r.due_at, status: displayStatus(r, now) }))
    .sort((a, b) => (a.dueAt ? new Date(a.dueAt) : Infinity) - (b.dueAt ? new Date(b.dueAt) : Infinity));
  const recentDecisions = (decisions || [])
    .filter((d) => d.released_at) // never drafts
    .sort((a, b) => new Date(b.released_at) - new Date(a.released_at))
    .slice(0, 3)
    .map((d) => ({ paperId: d.paper_id, title: titleOf.get(d.paper_id) || null, decision: d.decision, label: DECISION_LABEL[d.decision], at: d.released_at }));
  return {
    counts: {
      total: list.length,
      inReview: count((p) => p.status === "SUBMITTED" || p.status === "UNDER_REVIEW"),
      revision: count((p) => p.status === "REVISION"),
      accepted: count((p) => p.status === "ACCEPTED"),
      published: count((p) => p.status === "PUBLISHED"),
      rejected: count((p) => p.status === "REJECTED"),
    },
    actionNeeded: action,
    recentDecisions,
    recent: list.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
      .map((p) => ({ id: p.id, title: p.title, status: p.status, createdAt: p.created_at })),
  };
}

/** Reviewer: own reviewer assignments (no author info anywhere). */
export function summarizeReviewer({ assignments, papers, reviews, viewerId }, now = new Date()) {
  const paperById = new Map((papers || []).map((p) => [p.id, p]));
  const mine = (assignments || []).filter((a) => a.assignee === viewerId && REVIEWER_ROLES.includes(a.role));
  const items = mine.map((a) => {
    const p = paperById.get(a.paper_id);
    const round = p?.current_round ?? 0;
    const rv = (reviews || []).find((r) => r.paper_id === a.paper_id && r.reviewer === viewerId && r.round === round);
    const status = rv?.status || "PENDING";
    const open = p?.status === "UNDER_REVIEW";
    return { paperId: a.paper_id, title: p?.title || null, round, status, open, dueAt: a.due_at, deadline: open ? deadlineState(a.due_at, status, now) : "none" };
  });
  const todo = items.filter((i) => i.open && i.status !== "SUBMITTED");
  return {
    counts: {
      assigned: items.length,
      toDo: todo.length,
      overdue: todo.filter((i) => i.deadline === "overdue").length,
      dueSoon: todo.filter((i) => i.deadline === "due_soon").length,
      submitted: items.filter((i) => i.status === "SUBMITTED").length,
    },
    toDo: todo.sort((a, b) => (a.dueAt ? new Date(a.dueAt) : Infinity) - (b.dueAt ? new Date(b.dueAt) : Infinity)).slice(0, 5),
  };
}

/** Editorial (admin: all papers; editor: papers they edit). */
export function summarizeEditorial({ papers, reviews, decisions, assignments }, now = new Date()) {
  const s = { AWAITING_DECISION: 0, AWAITING_REVIEWS: 0, REVISION: 0, ACCEPTED: 0, REJECTED: 0, OTHER: 0, pendingReports: 0, overdueReviews: 0 };
  for (const p of papers || []) {
    const round = p.current_round ?? 0;
    const roundReviews = (reviews || []).filter((r) => r.paper_id === p.id && r.round === round);
    s[editorialCategory(p, roundReviews, (decisions || []).filter((d) => d.paper_id === p.id))]++;
    if (p.status === "UNDER_REVIEW") {
      const ra = (assignments || []).filter((a) => a.paper_id === p.id && REVIEWER_ROLES.includes(a.role));
      for (const a of ra) {
        const st = roundReviews.find((r) => r.reviewer === a.assignee)?.status || "PENDING";
        if (st !== "SUBMITTED") s.pendingReports++;
        if (deadlineState(a.due_at, st, now) === "overdue") s.overdueReviews++;
      }
    }
  }
  return s;
}

/** Admin: real people & role counts (replaces the hard-coded mock cards). */
export function summarizeUsers({ profiles, roles }) {
  const p = profiles || [];
  const byRole = { ADMINISTRATOR: 0, SPOC: 0, DESK_REVIEWER: 0, PEER_REVIEWER: 0, EDITOR: 0 };
  (roles || []).forEach((r) => { if (r.role in byRole) byRole[r.role]++; });
  return {
    total: p.length,
    students: p.filter((x) => x.base_type === "STUDENT").length,
    faculty: p.filter((x) => x.base_type === "FACULTY").length,
    admins: p.filter((x) => x.is_admin).length,
    byRole,
  };
}
