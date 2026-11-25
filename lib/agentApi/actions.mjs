/**
 * IntelligenceOS Agent API — the actions a key can call.
 *
 * Each action is { id, name, description, method, path, risk, scope, params, run, allow? }.
 * The manifest exposes everything except `scope`, `run`, `allow` and the
 * internal validation hints (`min`, `max`, `pattern`, `maxLength`, `default`).
 *
 * `run` receives `viewer`: null when the key acts on its own, or the portal
 * account named by X-IntelligenceOS-User (lib/agentApi/access.mjs). Every
 * action then returns only what that person could see in the portal.
 * `allow(viewer)` (optional) hides an action from a person's manifest — and
 * refuses it with 403 — when their account can never use it.
 *
 * Data rules:
 *   - every identifier comes from lib/db/tables.mjs; every value is a bound
 *     `?` parameter — nothing from the request is ever spliced into SQL;
 *   - only the fields an agent needs are returned. Author names/emails are
 *     NEVER returned; reviewer identity is limited to the display name and
 *     only to managers; confidential reviewer comments, confidential decision
 *     notes, file names, user ids and emails never leave the portal;
 *   - there are no delete, password, payment or bulk-export actions.
 *
 * Writes go through the same audit trail as the app (research_paper_activity
 * via logActivity), with the agent name / run id / acting user recorded.
 */
import { T } from "../db/tables.mjs";
import { jrow, jrows, logActivity } from "../repos/rows.mjs";
import { PAPER_STATUSES } from "../repos/paperStats.mjs";
import { OWNER_VISIBLE_ACTIONS } from "../reviewLogic.js";
import { DECISION_LABEL } from "../decisionLogic.js";
import { displayStatus, reviewsForAuthor } from "../revisionLogic.js";
import {
  ActionError, DEPARTMENTS, MAX_LIMIT, DEFAULT_LIMIT, iso, submissionSummary, dateRange, findPaper,
  dateParam, idParam,
} from "./common.mjs";
import { paperScope, accessFor, accessOne, seesAll, isEditorAnywhere } from "./access.mjs";
import { READ_ACTIONS } from "./readActions.mjs";

export { ActionError, MAX_LIMIT, DEFAULT_LIMIT, DEPARTMENTS };
export const NOTE_MAX = 2000;
export const REASON_MAX = 500;

/**
 * Status changes an agent may make. Accept / reject / revision / publish go
 * through the editorial-decision workflow (Program Chair approval) and are
 * deliberately NOT available here.
 */
export const AGENT_STATUS_TRANSITIONS = Object.freeze({
  SUBMITTED: ["UNDER_REVIEW", "ARCHIVED"],
  UNDER_REVIEW: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
});
export const AGENT_SETTABLE_STATUSES = Object.freeze(["UNDER_REVIEW", "ARCHIVED"]);

/** The relationship filter of list_submissions (needs a signed-in user). */
export const MY_ROLES = Object.freeze(["SUBMITTER", "EDITOR", "PEER_REVIEWER", "DESK_REVIEWER", "SPOC", "PROGRAM_CHAIR"]);

/** Paper activity actions that make up a submission's status history. */
const HISTORY = {
  SUBMITTED: { label: "Submitted", status: "SUBMITTED" },
  ASSIGNED: { label: "Assignment added", status: null },
  REVISION_REQUESTED: { label: "Revision requested", status: "REVISION" },
  REVISION_STARTED: { label: "Revision started", status: null },
  REVISION_MANUSCRIPT_UPLOADED: { label: "Revised manuscript uploaded", status: null },
  REVISION_RESPONSE_SAVED: { label: "Response to reviewers saved", status: null },
  REVISION_SUBMITTED: { label: "Revision submitted", status: null },
  REREVIEW_ASSIGNED: { label: "Revision sent for re-review", status: "UNDER_REVIEW" },
  DECISION_COMMUNICATED: { label: "Decision communicated to author", status: null },
  PAPER_ACCEPTED: { label: "Accepted", status: "ACCEPTED" },
  PAPER_REJECTED: { label: "Rejected", status: "REJECTED" },
  PUBLICATION_SCHEDULED: { label: "Scheduled for publication", status: null },
  PAPER_PUBLISHED: { label: "Published", status: "PUBLISHED" },
  AGENT_STATUS_CHANGED: { label: "Status changed by IntelligenceOS", status: null },
};
/** Manager history: the original events (the revision steps are author-side detail). */
const MANAGER_HISTORY = Object.keys(HISTORY).filter((k) => !["REVISION_STARTED", "REVISION_MANUSCRIPT_UPLOADED", "REVISION_RESPONSE_SAVED"].includes(k));
/** Only these detail keys may appear in the history (no user ids, no free text). */
const HISTORY_DETAIL_KEYS = ["round", "decision", "role", "type", "from", "to"];

const forbidden = (msg) => new ActionError(403, msg);
const WRITE_DENIED = "Only a portal administrator or this paper's editor can change it through IntelligenceOS.";

/** Shared loaders for get_submission (all bound parameters). */
const loadDecisions = (db, paperId) => db.query(
  `SELECT d.id, d.round, d.decision, d.summary, d.review_ids, d.revision_id, d.decided_by, d.created_at, d.released_at, u.name AS decided_by_name
     FROM \`${T.editorialDecisions}\` d LEFT JOIN \`${T.users}\` u ON u.id = d.decided_by
    WHERE d.paper_id = ? ORDER BY d.round ASC`, [paperId]).then(jrows);
const loadRevisions = (db, paperId) => db.query(
  `SELECT id, round, revision_type, instructions, due_at, status, requested_at, submitted_at
     FROM \`${T.paperRevisions}\` WHERE paper_id = ? ORDER BY round ASC`, [paperId]);

const revisionView = (r, { withInstructions = true } = {}) => ({
  round: r.round,
  type: r.revision_type,
  status: displayStatus(r),
  ...(withInstructions ? { instructions: r.instructions } : {}),
  dueAt: iso(r.due_at),
  requestedAt: iso(r.requested_at),
  submittedAt: iso(r.submitted_at),
});

/** get_submission — manager view (admin, the paper's editor, Program Chair, or the key itself). */
async function managerSubmission(db, p) {
  const [assignments, reviews, activity, decisions, revisions, approvals] = await Promise.all([
    db.query(
      `SELECT a.role, a.assignee, a.assigned_at, a.due_at, u.name
         FROM \`${T.paperAssignments}\` a LEFT JOIN \`${T.users}\` u ON u.id = a.assignee
        WHERE a.paper_id = ? ORDER BY a.assigned_at ASC`, [p.id]),
    db.query(`SELECT reviewer, round, status, recommendation, submitted_at FROM \`${T.reviews}\` WHERE paper_id = ? ORDER BY round DESC`, [p.id]),
    db.query(
      `SELECT action, detail, created_at FROM \`${T.paperActivity}\`
        WHERE paper_id = ? AND action IN (?) ORDER BY created_at ASC LIMIT 500`,
      [p.id, [...MANAGER_HISTORY, "AGENT_NOTE_ADDED"]]).then(jrows),
    loadDecisions(db, p.id),
    loadRevisions(db, p.id),
    db.query(`SELECT decision_id, status, requested_at, acted_at FROM \`${T.decisionApprovals}\` WHERE paper_id = ? ORDER BY requested_at ASC`, [p.id]),
  ]);
  const latestReview = new Map();
  for (const r of reviews) if (!latestReview.has(r.reviewer)) latestReview.set(r.reviewer, r);
  const isReviewer = (role) => role === "DESK_REVIEWER" || role === "PEER_REVIEWER";
  const reviewers = assignments.filter((a) => isReviewer(a.role)).map((a) => {
    const r = latestReview.get(a.assignee);
    return {
      name: a.name || "Reviewer",
      role: a.role,
      assignedAt: iso(a.assigned_at),
      dueAt: iso(a.due_at),
      review: r ? { round: r.round, status: r.status, recommendation: r.status === "SUBMITTED" ? r.recommendation : null, submittedAt: iso(r.submitted_at) } : null,
    };
  });
  const editors = assignments.filter((a) => a.role === "EDITOR").map((a) => ({ name: a.name || "Editor", assignedAt: iso(a.assigned_at) }));
  const spocs = assignments.filter((a) => a.role === "SPOC").map((a) => ({ name: a.name || "SPOC", assignedAt: iso(a.assigned_at) }));
  const statusHistory = activity.filter((a) => HISTORY[a.action]).map((a) => {
    const d = a.detail || {};
    const detail = Object.fromEntries(HISTORY_DETAIL_KEYS.filter((k) => d[k] !== undefined && d[k] !== null).map((k) => [k, d[k]]));
    return { at: iso(a.created_at), event: a.action, label: HISTORY[a.action].label, status: a.action === "AGENT_STATUS_CHANGED" ? d.to || null : HISTORY[a.action].status, ...(Object.keys(detail).length ? { detail } : {}) };
  });
  const notes = activity.filter((a) => a.action === "AGENT_NOTE_ADDED").map((a) => ({ at: iso(a.created_at), note: a.detail?.note || "", agent: a.detail?.agent || null }));
  const lastApproval = new Map();
  for (const a of approvals) lastApproval.set(a.decision_id, a);
  return {
    ...submissionSummary(p),
    abstract: p.abstract,
    keywords: Array.isArray(p.keywords) ? p.keywords : [],
    reviewers,
    editors,
    spocs,
    decisions: decisions.map((d) => {
      const a = lastApproval.get(d.id);
      return {
        round: d.round, decision: d.decision, label: DECISION_LABEL[d.decision] || d.decision, summary: d.summary,
        decidedBy: d.decided_by_name || null, decidedAt: iso(d.created_at), releasedToAuthorAt: iso(d.released_at),
        finalApproval: a ? { status: a.status, requestedAt: iso(a.requested_at), actedAt: iso(a.acted_at) } : null,
      };
    }),
    revisions: revisions.map((r) => revisionView(r)),
    notes,
    statusHistory,
  };
}

/** get_submission — the author's own view (what the portal shows its submitter). */
async function ownerSubmission(db, p) {
  const [activity, decisions, revisions, reviews] = await Promise.all([
    db.query(
      `SELECT action, created_at FROM \`${T.paperActivity}\` WHERE paper_id = ? AND action IN (?) ORDER BY created_at ASC LIMIT 500`,
      [p.id, OWNER_VISIBLE_ACTIONS]),
    loadDecisions(db, p.id),
    loadRevisions(db, p.id),
    db.query(`SELECT id, status, comments_to_author FROM \`${T.reviews}\` WHERE paper_id = ? AND status = 'SUBMITTED'`, [p.id]),
  ]);
  return {
    ...submissionSummary(p),
    abstract: p.abstract,
    keywords: Array.isArray(p.keywords) ? p.keywords : [],
    // Only decisions the editor has released to the author; reviewers anonymous.
    decisions: decisions.filter((d) => d.released_at).map((d) => ({
      round: d.round, decision: d.decision, label: DECISION_LABEL[d.decision] || d.decision, message: d.summary,
      decidedAt: iso(d.released_at),
      reviewerComments: reviewsForAuthor(reviews, d.review_ids).map((r) => ({ reviewer: r.label, comments: r.commentsToAuthor })),
    })),
    revisions: revisions.map((r) => revisionView(r)),
    statusHistory: activity.map((a) => ({ at: iso(a.created_at), event: a.action, label: HISTORY[a.action]?.label || a.action, status: HISTORY[a.action]?.status ?? null })),
  };
}

/** get_submission — reviewer / SPOC view: the paper and their OWN assignment + review only. */
async function reviewerSubmission(db, p, viewer, acc) {
  const mine = await db.query(
    `SELECT round, status, recommendation, submitted_at FROM \`${T.reviews}\` WHERE paper_id = ? AND reviewer = ? ORDER BY round DESC`,
    [p.id, viewer.id]);
  return {
    ...submissionSummary(p),
    abstract: p.abstract,
    keywords: Array.isArray(p.keywords) ? p.keywords : [],
    myAssignments: acc.myAssignments.map((a) => ({ role: a.role, assignedAt: iso(a.assignedAt), dueAt: iso(a.dueAt) })),
    myReviews: mine.map((r) => ({ round: r.round, status: r.status, recommendation: r.recommendation || null, submittedAt: iso(r.submitted_at) })),
  };
}

/** For writes made as a person: only an administrator or the paper's editor. */
async function assertCanWrite(db, viewer, paper) {
  if (!viewer) return;
  const acc = await accessOne(db, viewer, paper); // 404 when they can't even see it
  if (!acc.canWrite) throw forbidden(WRITE_DENIED);
}

const SUBMISSION_ACTIONS = [
  {
    id: "list_submissions",
    name: "List submissions",
    description: "List research paper submissions the user can see, newest first: their own submissions, papers assigned to them (reviewer, SPOC, editor), papers sent to them for final approval, or every paper for an administrator. Filter by status, department (school), the user's role on the paper and submission date range. Returns id, reference ID, title, status, department, dates and the user's roles on each paper — no author details.",
    method: "GET",
    path: "/submissions",
    risk: "read",
    scope: "research.read",
    params: [
      { name: "status", in: "query", type: "string", required: false, enum: [...PAPER_STATUSES], description: "Only submissions with this status." },
      { name: "department", in: "query", type: "string", required: false, enum: [...DEPARTMENTS], description: "Only submissions from this school/department code." },
      { name: "myRole", in: "query", type: "string", required: false, enum: [...MY_ROLES], description: "Only papers where the signed-in user has this role: SUBMITTER (their own papers), EDITOR, PEER_REVIEWER, DESK_REVIEWER, SPOC or PROGRAM_CHAIR." },
      dateParam("from", "Submitted on or after this date (YYYY-MM-DD, UTC)."),
      dateParam("to", "Submitted on or before this date (YYYY-MM-DD, UTC)."),
      { name: "limit", in: "query", type: "integer", required: false, min: 1, max: MAX_LIMIT, default: DEFAULT_LIMIT, description: `How many to return (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).` },
    ],
    async run({ db, query, viewer }) {
      const scope = paperScope(viewer);
      const where = [scope.sql];
      const params = [...scope.params];
      if (query.status) { where.push("p.status = ?"); params.push(query.status); }
      if (query.department) { where.push("p.school_code = ?"); params.push(query.department); }
      if (query.myRole) {
        if (!viewer) throw new ActionError(400, "myRole needs a signed-in user (X-IntelligenceOS-User)");
        if (query.myRole === "SUBMITTER") { where.push("p.submitted_by = ?"); params.push(viewer.id); }
        else if (query.myRole === "PROGRAM_CHAIR") {
          if (!viewer.isChair) where.push("1=0");
          else where.push(`p.id IN (SELECT paper_id FROM \`${T.decisionApprovals}\`)`);
        } else {
          where.push(`p.id IN (SELECT paper_id FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = ?) AND (p.submitted_by IS NULL OR p.submitted_by <> ?)`);
          params.push(viewer.id, query.myRole, viewer.id);
        }
      }
      const r = dateRange(query, "p.created_at");
      where.push(...r.parts);
      params.push(...r.params);
      const w = ` WHERE ${where.join(" AND ")}`;
      const [count, rows] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n FROM \`${T.papers}\` p${w}`, params),
        db.query(
          `SELECT p.id, p.ref_id, p.title, p.status, p.school_code, p.submitted_by, p.current_round, p.created_at, p.updated_at FROM \`${T.papers}\` p${w} ORDER BY p.created_at DESC, p.id ASC LIMIT ?`,
          [...params, query.limit],
        ),
      ]);
      const acc = viewer ? await accessFor(db, viewer, rows) : null;
      return {
        body: {
          total: Number(count.n),
          returned: rows.length,
          submissions: rows.map((p) => ({ ...submissionSummary(p), ...(acc ? { myRoles: acc.get(p.id)?.myRoles || [] } : {}) })),
        },
      };
    },
  },
  {
    id: "get_submission",
    name: "Get submission",
    description: "Get one submission by id or reference ID, shaped by the user's role on it. Editors, the Program Chair and administrators get reviewers (names), review progress, decisions, revisions, notes and the status history. The paper's submitter gets released decisions, reviewer comments meant for them, revision requests and their status history. A reviewer or SPOC gets the paper and their own assignment and review only. Author identity is never included.",
    method: "GET",
    path: "/submissions/{id}",
    risk: "read",
    scope: "research.read",
    params: [idParam],
    async run({ db, path, viewer }) {
      const p = jrow(await findPaper(db, path.id));
      const acc = await accessOne(db, viewer, p);
      let submission;
      if (acc.view === "manager") submission = await managerSubmission(db, p);
      else if (acc.view === "owner") submission = await ownerSubmission(db, p);
      else submission = await reviewerSubmission(db, p, viewer, acc);
      return { body: { submission: { ...submission, ...(viewer ? { myRoles: acc.myRoles, view: acc.view } : {}) } } };
    },
  },
  {
    id: "submission_stats",
    name: "Submission statistics",
    description: "Count the submissions the user can see by status and by department (school), optionally limited to a submission date range. For an administrator (or the key on its own) this covers every paper.",
    method: "GET",
    path: "/stats/submissions",
    risk: "read",
    scope: "research.read",
    params: [
      dateParam("from", "Count submissions on or after this date (YYYY-MM-DD, UTC)."),
      dateParam("to", "Count submissions on or before this date (YYYY-MM-DD, UTC)."),
    ],
    async run({ db, query, viewer }) {
      const scope = paperScope(viewer);
      const r = dateRange(query, "p.created_at");
      const where = [scope.sql, ...r.parts];
      const params = [...scope.params, ...r.params];
      const w = ` WHERE ${where.join(" AND ")}`;
      const [byStatus, byDept] = await Promise.all([
        db.query(`SELECT p.status AS k, COUNT(*) AS n FROM \`${T.papers}\` p${w} GROUP BY p.status`, params),
        db.query(`SELECT p.school_code AS k, COUNT(*) AS n FROM \`${T.papers}\` p${w} GROUP BY p.school_code`, params),
      ]);
      const status = Object.fromEntries(PAPER_STATUSES.map((s) => [s, 0]));
      for (const row of byStatus) status[row.k] = Number(row.n);
      const department = {};
      for (const row of byDept) {
        const k = row.k ? (DEPARTMENTS.find((d) => d.toLowerCase() === row.k.toLowerCase()) || row.k) : "UNSPECIFIED";
        department[k] = (department[k] || 0) + Number(row.n);
      }
      const total = byStatus.reduce((s, row) => s + Number(row.n), 0);
      return { body: { total, byStatus: status, byDepartment: department, from: query.from || null, to: query.to || null, scope: seesAll(viewer) ? "all" : "mine" } };
    },
  },
];

const WRITE_ACTIONS = [
  {
    id: "add_review_note",
    name: "Add review note",
    description: `Add a note to a submission's record (visible to portal administrators, not to authors). Max ${NOTE_MAX} characters. When acting as a person, only an administrator or the paper's editor may do this.`,
    method: "POST",
    path: "/submissions/{id}/notes",
    risk: "write",
    scope: "research.write",
    allow: (viewer) => seesAll(viewer) || isEditorAnywhere(viewer),
    params: [
      idParam,
      { name: "note", in: "body", type: "string", required: true, maxLength: NOTE_MAX, description: `The note text (1–${NOTE_MAX} characters).` },
    ],
    async run({ db, path, body, agent, runId, key, viewer }) {
      const note = body.note.trim();
      if (!note) throw new ActionError(400, "note must not be empty");
      const p = await findPaper(db, path.id);
      await assertCanWrite(db, viewer, p);
      await logActivity(db, p.id, viewer?.id || null, "AGENT_NOTE_ADDED", { note, agent: agent || null, runId: runId || null, key: key.name, ...(viewer ? { onBehalfOf: viewer.email } : {}) });
      return { status: 201, body: { saved: true, note: { submissionId: p.id, refId: p.ref_id || null, note, agent: agent || null, at: new Date().toISOString() } } };
    },
  },
  {
    id: "update_submission_status",
    name: "Update submission status",
    description: "Change a submission's status. Allowed: SUBMITTED → UNDER_REVIEW or ARCHIVED; UNDER_REVIEW → ARCHIVED; REJECTED → ARCHIVED. Accept, reject, revision and publish decisions are made by editors in the portal and cannot be set here. When acting as a person, only an administrator or the paper's editor may do this.",
    method: "POST",
    path: "/submissions/{id}/status",
    risk: "write",
    scope: "research.write",
    allow: (viewer) => seesAll(viewer) || isEditorAnywhere(viewer),
    params: [
      idParam,
      { name: "status", in: "body", type: "string", required: true, enum: [...AGENT_SETTABLE_STATUSES], description: "The new status." },
      { name: "reason", in: "body", type: "string", required: false, maxLength: REASON_MAX, description: `Why the status is changing (max ${REASON_MAX} characters).` },
    ],
    async run({ db, path, body, agent, runId, key, viewer }) {
      const to = body.status;
      const pre = await findPaper(db, path.id);
      await assertCanWrite(db, viewer, pre);
      return db.transaction(async (tx) => {
        const p = await findPaper(tx, path.id, { forUpdate: true });
        if (p.status === to) throw new ActionError(400, `Submission is already ${to}`);
        const allowed = AGENT_STATUS_TRANSITIONS[p.status] || [];
        if (!allowed.includes(to)) throw new ActionError(400, `Cannot change status from ${p.status} to ${to}`);
        await tx.exec(`UPDATE \`${T.papers}\` SET status = ? WHERE id = ? AND status = ?`, [to, p.id, p.status]);
        await logActivity(tx, p.id, viewer?.id || null, "AGENT_STATUS_CHANGED", {
          from: p.status, to, reason: body.reason?.trim() || null, agent: agent || null, runId: runId || null, key: key.name,
          ...(viewer ? { onBehalfOf: viewer.email } : {}),
        });
        return { body: { updated: true, submission: { id: p.id, refId: p.ref_id || null, previousStatus: p.status, status: to } } };
      });
    },
  },
];

export const ACTIONS = Object.freeze([...SUBMISSION_ACTIONS, ...READ_ACTIONS, ...WRITE_ACTIONS]);

/** May this viewer (null = the key itself) use this action at all? */
export const actionAllowed = (a, viewer) => (typeof a.allow === "function" ? !!a.allow(viewer) : true);

const INTERNAL_PARAM_KEYS = new Set(["min", "max", "pattern", "maxLength", "default"]);

/** Public (manifest) view of an action. */
export function publicAction(a) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    method: a.method,
    path: a.path,
    risk: a.risk,
    params: a.params.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !INTERNAL_PARAM_KEYS.has(k)))),
  };
}

const ROUTES = ACTIONS.map((a) => ({
  a,
  re: new RegExp(`^${a.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, "(?<$1>[^/]+)")}$`),
}));

/** Match METHOD + relative path → { action, pathParams } | { pathMatched: true } | null. */
export function matchAction(method, path) {
  let pathMatched = false;
  for (const { a, re } of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    if (a.method !== method) { pathMatched = true; continue; }
    const pathParams = {};
    for (const [k, v] of Object.entries(m.groups || {})) {
      try { pathParams[k] = decodeURIComponent(v); } catch { pathParams[k] = v; }
    }
    return { action: a, pathParams };
  }
  return pathMatched ? { pathMatched: true } : null;
}

/**
 * Validate + coerce the parameters of `action`. Query/path values arrive as
 * strings; body values as JSON. → { ok:true, path, query, body } | { ok:false, error }
 */
export function validateParams(action, { pathParams = {}, query = new URLSearchParams(), body = {} }) {
  const out = { path: {}, query: {}, body: {} };
  for (const p of action.params) {
    let v;
    if (p.in === "path") v = pathParams[p.name];
    else if (p.in === "query") v = query.has(p.name) ? query.get(p.name) : undefined;
    else v = body[p.name];
    if (v === "" && p.in !== "body") v = undefined;
    if (v === undefined || v === null) {
      if (p.required) return { ok: false, error: `${p.name} is required` };
      if (p.default !== undefined) out[p.in][p.name] = p.default;
      continue;
    }
    const fromString = p.in !== "body";
    if (p.type === "string") {
      if (typeof v !== "string") return { ok: false, error: `${p.name} must be a string` };
    } else if (p.type === "integer" || p.type === "number") {
      const n = fromString ? (/^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : NaN) : v;
      if (typeof n !== "number" || !Number.isFinite(n) || (p.type === "integer" && !Number.isInteger(n))) return { ok: false, error: `${p.name} must be ${p.type === "integer" ? "an integer" : "a number"}` };
      if (p.min !== undefined && n < p.min) return { ok: false, error: `${p.name} must be at least ${p.min}` };
      if (p.max !== undefined && n > p.max) return { ok: false, error: `${p.name} must be at most ${p.max}` };
      v = n;
    } else if (p.type === "boolean") {
      if (fromString) {
        if (v !== "true" && v !== "false") return { ok: false, error: `${p.name} must be true or false` };
        v = v === "true";
      } else if (typeof v !== "boolean") return { ok: false, error: `${p.name} must be a boolean` };
    }
    if (p.enum) {
      const hit = p.enum.find((e) => String(e).toLowerCase() === String(v).toLowerCase());
      if (hit === undefined) return { ok: false, error: `${p.name} must be one of: ${p.enum.join(", ")}` };
      v = hit;
    }
    if (p.maxLength !== undefined && String(v).length > p.maxLength) return { ok: false, error: `${p.name} must be at most ${p.maxLength} characters` };
    if (p.pattern && !p.pattern.test(String(v))) return { ok: false, error: `${p.name} must be a date (YYYY-MM-DD)` };
    if (p.pattern && Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return { ok: false, error: `${p.name} is not a valid date` };
    out[p.in][p.name] = v;
  }
  return { ok: true, ...out };
}

