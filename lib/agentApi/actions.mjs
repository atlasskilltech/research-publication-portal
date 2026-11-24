/**
 * IntelligenceOS Agent API — the actions a key can call.
 *
 * Each action is { id, name, description, method, path, risk, scope, params, run }.
 * The manifest exposes everything except `scope`, `run` and the internal
 * validation hints (`min`, `max`, `pattern`, `maxLength`, `default`).
 *
 * Data rules:
 *   - every identifier comes from lib/db/tables.mjs; every value is a bound
 *     `?` parameter — nothing from the request is ever spliced into SQL;
 *   - only the fields an agent needs are returned. Author names/emails are
 *     NEVER returned (double-blind review + personal data); reviewer identity
 *     is limited to the display name; confidential reviewer comments, file
 *     names, user ids and emails never leave the portal;
 *   - there are no delete, password, payment or bulk-export actions.
 *
 * Writes go through the same audit trail as the app (research_paper_activity
 * via logActivity), with the agent name / run id recorded in the detail.
 */
import { T } from "../db/tables.mjs";
import { jrow, jrows, logActivity } from "../repos/rows.mjs";
import { PAPER_STATUSES } from "../repos/paperStats.mjs";
import { REF_PATTERN } from "../paperRef.mjs";
import { SCHOOLS } from "../constants.js";

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;
export const NOTE_MAX = 2000;
export const REASON_MAX = 500;
export const DEPARTMENTS = Object.freeze(Object.keys(SCHOOLS)); // ISDI, ISME, uGDX, LAW

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Paper activity actions that make up a submission's status history. */
const HISTORY = {
  SUBMITTED: { label: "Submitted", status: "SUBMITTED" },
  ASSIGNED: { label: "Assignment added", status: null },
  REVISION_REQUESTED: { label: "Revision requested", status: "REVISION" },
  REVISION_SUBMITTED: { label: "Revision submitted", status: null },
  REREVIEW_ASSIGNED: { label: "Revision sent for re-review", status: "UNDER_REVIEW" },
  DECISION_COMMUNICATED: { label: "Decision communicated to author", status: null },
  PAPER_ACCEPTED: { label: "Accepted", status: "ACCEPTED" },
  PAPER_REJECTED: { label: "Rejected", status: "REJECTED" },
  PUBLICATION_SCHEDULED: { label: "Scheduled for publication", status: null },
  PAPER_PUBLISHED: { label: "Published", status: "PUBLISHED" },
  AGENT_STATUS_CHANGED: { label: "Status changed by IntelligenceOS", status: null },
};
/** Only these detail keys may appear in the history (no user ids, no free text). */
const HISTORY_DETAIL_KEYS = ["round", "decision", "role", "type", "from", "to"];

export class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const departmentName = (code) => {
  if (!code) return null;
  const k = DEPARTMENTS.find((d) => d.toLowerCase() === String(code).toLowerCase());
  return k ? SCHOOLS[k].name : null;
};
const submissionSummary = (p) => ({
  id: p.id,
  refId: p.ref_id || null,
  title: p.title,
  status: p.status,
  department: p.school_code || null,
  departmentName: departmentName(p.school_code),
  currentRound: p.current_round,
  submittedAt: iso(p.created_at),
  updatedAt: iso(p.updated_at),
});

/** created_at range from YYYY-MM-DD strings (to = inclusive). → { sql, params } */
function dateRange(query, col = "created_at") {
  const parts = [];
  const params = [];
  if (query.from) { parts.push(`${col} >= ?`); params.push(new Date(`${query.from}T00:00:00.000Z`)); }
  if (query.to) {
    const end = new Date(`${query.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    parts.push(`${col} < ?`);
    params.push(end);
  }
  if (query.from && query.to && query.from > query.to) throw new ActionError(400, "from must be on or before to");
  return { parts, params };
}

/** Find a paper by UUID or reference ID (ISDI-2026-0001). */
async function findPaper(q, id, { forUpdate = false } = {}) {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const cols = "id, ref_id, title, abstract, keywords, school_code, status, current_round, created_at, updated_at";
  let row = null;
  if (UUID_RE.test(id)) row = await q.one(`SELECT ${cols} FROM \`${T.papers}\` WHERE id = ?${lock}`, [id.toLowerCase()]);
  else if (REF_PATTERN.test(id.toUpperCase())) row = await q.one(`SELECT ${cols} FROM \`${T.papers}\` WHERE ref_id = ?${lock}`, [id.toUpperCase()]);
  if (!row) throw new ActionError(404, "Submission not found");
  return row;
}

const dateParam = (name, description) => ({ name, in: "query", type: "string", required: false, pattern: DATE_RE, description });
const idParam = { name: "id", in: "path", type: "string", required: true, maxLength: 64, description: "Submission id (UUID) or reference ID such as ISDI-2026-0001." };

export const ACTIONS = Object.freeze([
  {
    id: "list_submissions",
    name: "List submissions",
    description: "List research paper submissions, newest first. Filter by status, department (school) and submission date range. Returns id, reference ID, title, status, department and dates — no author details.",
    method: "GET",
    path: "/submissions",
    risk: "read",
    scope: "research.read",
    params: [
      { name: "status", in: "query", type: "string", required: false, enum: [...PAPER_STATUSES], description: "Only submissions with this status." },
      { name: "department", in: "query", type: "string", required: false, enum: [...DEPARTMENTS], description: "Only submissions from this school/department code." },
      dateParam("from", "Submitted on or after this date (YYYY-MM-DD, UTC)."),
      dateParam("to", "Submitted on or before this date (YYYY-MM-DD, UTC)."),
      { name: "limit", in: "query", type: "integer", required: false, min: 1, max: MAX_LIMIT, default: DEFAULT_LIMIT, description: `How many to return (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).` },
    ],
    async run({ db, query }) {
      const where = [];
      const params = [];
      if (query.status) { where.push("status = ?"); params.push(query.status); }
      if (query.department) { where.push("school_code = ?"); params.push(query.department); }
      const r = dateRange(query);
      where.push(...r.parts);
      params.push(...r.params);
      const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
      const [count, rows] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n FROM \`${T.papers}\`${w}`, params),
        db.query(
          `SELECT id, ref_id, title, status, school_code, current_round, created_at, updated_at FROM \`${T.papers}\`${w} ORDER BY created_at DESC, id ASC LIMIT ?`,
          [...params, query.limit],
        ),
      ]);
      return { body: { total: Number(count.n), returned: rows.length, submissions: rows.map(submissionSummary) } };
    },
  },
  {
    id: "get_submission",
    name: "Get submission",
    description: "Get one submission by id or reference ID: title, abstract, keywords, status, department, assigned reviewers/editors with their review progress, review notes and the status history. Author identity is never included (double-blind).",
    method: "GET",
    path: "/submissions/{id}",
    risk: "read",
    scope: "research.read",
    params: [idParam],
    async run({ db, path }) {
      const p = jrow(await findPaper(db, path.id));
      const [assignments, reviews, activity] = await Promise.all([
        db.query(
          `SELECT a.role, a.assignee, a.assigned_at, a.due_at, u.name
             FROM \`${T.paperAssignments}\` a LEFT JOIN \`${T.users}\` u ON u.id = a.assignee
            WHERE a.paper_id = ? ORDER BY a.assigned_at ASC`, [p.id]),
        db.query(
          `SELECT reviewer, round, status, recommendation, submitted_at FROM \`${T.reviews}\` WHERE paper_id = ? ORDER BY round DESC`, [p.id]),
        db.query(
          `SELECT action, detail, created_at FROM \`${T.paperActivity}\`
            WHERE paper_id = ? AND action IN (?) ORDER BY created_at ASC LIMIT 500`,
          [p.id, [...Object.keys(HISTORY), "AGENT_NOTE_ADDED"]]).then(jrows),
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
      const statusHistory = activity.filter((a) => HISTORY[a.action]).map((a) => {
        const d = a.detail || {};
        const detail = Object.fromEntries(HISTORY_DETAIL_KEYS.filter((k) => d[k] !== undefined && d[k] !== null).map((k) => [k, d[k]]));
        return { at: iso(a.created_at), event: a.action, label: HISTORY[a.action].label, status: a.action === "AGENT_STATUS_CHANGED" ? d.to || null : HISTORY[a.action].status, ...(Object.keys(detail).length ? { detail } : {}) };
      });
      const notes = activity.filter((a) => a.action === "AGENT_NOTE_ADDED").map((a) => ({ at: iso(a.created_at), note: a.detail?.note || "", agent: a.detail?.agent || null }));
      return {
        body: {
          submission: {
            ...submissionSummary(p),
            abstract: p.abstract,
            keywords: Array.isArray(p.keywords) ? p.keywords : [],
            reviewers,
            editors,
            notes,
            statusHistory,
          },
        },
      };
    },
  },
  {
    id: "submission_stats",
    name: "Submission statistics",
    description: "Count submissions by status and by department (school), optionally limited to a submission date range.",
    method: "GET",
    path: "/stats/submissions",
    risk: "read",
    scope: "research.read",
    params: [
      dateParam("from", "Count submissions on or after this date (YYYY-MM-DD, UTC)."),
      dateParam("to", "Count submissions on or before this date (YYYY-MM-DD, UTC)."),
    ],
    async run({ db, query }) {
      const r = dateRange(query);
      const w = r.parts.length ? ` WHERE ${r.parts.join(" AND ")}` : "";
      const [byStatus, byDept] = await Promise.all([
        db.query(`SELECT status AS k, COUNT(*) AS n FROM \`${T.papers}\`${w} GROUP BY status`, r.params),
        db.query(`SELECT school_code AS k, COUNT(*) AS n FROM \`${T.papers}\`${w} GROUP BY school_code`, r.params),
      ]);
      const status = Object.fromEntries(PAPER_STATUSES.map((s) => [s, 0]));
      for (const row of byStatus) status[row.k] = Number(row.n);
      const department = {};
      for (const row of byDept) {
        const k = row.k ? (DEPARTMENTS.find((d) => d.toLowerCase() === row.k.toLowerCase()) || row.k) : "UNSPECIFIED";
        department[k] = (department[k] || 0) + Number(row.n);
      }
      const total = byStatus.reduce((s, row) => s + Number(row.n), 0);
      return { body: { total, byStatus: status, byDepartment: department, from: query.from || null, to: query.to || null } };
    },
  },
  {
    id: "add_review_note",
    name: "Add review note",
    description: `Add a note to a submission's record (visible to portal administrators, not to authors). Max ${NOTE_MAX} characters.`,
    method: "POST",
    path: "/submissions/{id}/notes",
    risk: "write",
    scope: "research.write",
    params: [
      idParam,
      { name: "note", in: "body", type: "string", required: true, maxLength: NOTE_MAX, description: `The note text (1–${NOTE_MAX} characters).` },
    ],
    async run({ db, path, body, agent, runId, key }) {
      const note = body.note.trim();
      if (!note) throw new ActionError(400, "note must not be empty");
      const p = await findPaper(db, path.id);
      await logActivity(db, p.id, null, "AGENT_NOTE_ADDED", { note, agent: agent || null, runId: runId || null, key: key.name });
      return { status: 201, body: { saved: true, note: { submissionId: p.id, refId: p.ref_id || null, note, agent: agent || null, at: new Date().toISOString() } } };
    },
  },
  {
    id: "update_submission_status",
    name: "Update submission status",
    description: "Change a submission's status. Allowed: SUBMITTED → UNDER_REVIEW or ARCHIVED; UNDER_REVIEW → ARCHIVED; REJECTED → ARCHIVED. Accept, reject, revision and publish decisions are made by editors in the portal and cannot be set here.",
    method: "POST",
    path: "/submissions/{id}/status",
    risk: "write",
    scope: "research.write",
    params: [
      idParam,
      { name: "status", in: "body", type: "string", required: true, enum: [...AGENT_SETTABLE_STATUSES], description: "The new status." },
      { name: "reason", in: "body", type: "string", required: false, maxLength: REASON_MAX, description: `Why the status is changing (max ${REASON_MAX} characters).` },
    ],
    async run({ db, path, body, agent, runId, key }) {
      const to = body.status;
      return db.transaction(async (tx) => {
        const p = await findPaper(tx, path.id, { forUpdate: true });
        if (p.status === to) throw new ActionError(400, `Submission is already ${to}`);
        const allowed = AGENT_STATUS_TRANSITIONS[p.status] || [];
        if (!allowed.includes(to)) throw new ActionError(400, `Cannot change status from ${p.status} to ${to}`);
        await tx.exec(`UPDATE \`${T.papers}\` SET status = ? WHERE id = ? AND status = ?`, [to, p.id, p.status]);
        await logActivity(tx, p.id, null, "AGENT_STATUS_CHANGED", {
          from: p.status, to, reason: body.reason?.trim() || null, agent: agent || null, runId: runId || null, key: key.name,
        });
        return { body: { updated: true, submission: { id: p.id, refId: p.ref_id || null, previousStatus: p.status, status: to } } };
      });
    },
  },
]);

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

/** Match METHOD + relative path → { action, pathParams } | { pathMatched: true } | null. */
export function matchAction(method, path) {
  let pathMatched = false;
  for (const a of ACTIONS) {
    const re = new RegExp(`^${a.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{(\w+)\}/g, "(?<$1>[^/]+)")}$`);
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
    if (p.pattern === DATE_RE && Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) return { ok: false, error: `${p.name} is not a valid date` };
    out[p.in][p.name] = v;
  }
  return { ok: true, ...out };
}
