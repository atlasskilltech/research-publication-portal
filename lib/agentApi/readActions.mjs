/**
 * IntelligenceOS Agent API — read-only actions for the rest of the portal:
 * who am I, review assignments, revisions, editorial decisions, final
 * approvals, publications, volumes/issues, faculty achievements, activity,
 * people and AIDC registration counts.
 *
 * Every action follows lib/agentApi/access.mjs: with no acting user the key
 * sees everything; with X-IntelligenceOS-User each record is filtered (in SQL,
 * with bound values) to what that person could see in the portal, and shaped
 * by their relationship to the paper. Author names and emails are never
 * returned to anyone; no user ids or emails at all.
 */
import { T } from "../db/tables.mjs";
import { jrows } from "../repos/rows.mjs";
import { PAPER_STATUSES } from "../repos/paperStats.mjs";
import { OWNER_VISIBLE_ACTIONS, deadlineState, summarizeReviews } from "../reviewLogic.js";
import { DECISION_LABEL } from "../decisionLogic.js";
import { displayStatus, STORED_STATUSES, OPEN_STATUSES } from "../revisionLogic.js";
import {
  ACHIEVEMENT_TYPES, ACHIEVEMENT_TYPE_KEYS, ACHIEVEMENT_SCHOOLS, ACHIEVEMENT_STATUSES, detailPairs,
} from "../achievementTypes.js";
import {
  ActionError, MAX_LIMIT, iso, day, paperRef, dateRange, findPaper, dateParam, limitParam,
  submissionFilterParam, departmentName,
} from "./common.mjs";
import { seesAll, isEditorAnywhere, viewerSummary } from "./access.mjs";

const SCAN_CAP = 2000; // rows read before a summary is computed (then sliced to `limit`)
const notAuthorAccount = (viewer) => !viewer || !viewer.isAuthorAccount;

/**
 * SQL: the paper (alias `p`) is one the viewer MANAGES — administrator, the
 * paper's editor, or Program Chair on a paper with an approval request — and
 * did not submit themselves (the author never manages their own paper).
 * → { sql, params }. Key on its own: everything.
 */
function managedCond(viewer, a = "p") {
  if (!viewer) return { sql: "1=1", params: [] };
  const notOwn = `(${a}.submitted_by IS NULL OR ${a}.submitted_by <> ?)`;
  if (viewer.isAdmin) return { sql: notOwn, params: [viewer.id] };
  const parts = [`${a}.id IN (SELECT paper_id FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = 'EDITOR')`];
  const params = [viewer.id];
  if (viewer.isChair) parts.push(`${a}.id IN (SELECT paper_id FROM \`${T.decisionApprovals}\`)`);
  return { sql: `(${notOwn} AND (${parts.join(" OR ")}))`, params: [viewer.id, ...params] };
}

/** Optional `submission` filter → condition on p.id (404 when the paper doesn't exist). */
async function submissionCond(db, query) {
  if (!query.submission) return null;
  const p = await findPaper(db, query.submission);
  return { sql: "p.id = ?", params: [p.id] };
}

function where(conds) {
  const list = conds.filter(Boolean);
  return {
    sql: list.length ? ` WHERE ${list.map((c) => c.sql).join(" AND ")}` : "",
    params: list.flatMap((c) => c.params),
  };
}
const c = (sql, ...params) => ({ sql, params });

const ACTIVITY_LABEL = {
  SUBMITTED: "Submitted",
  ASSIGNED: "Assignment added",
  UNASSIGNED: "Assignment removed",
  REVIEW_DRAFT_SAVED: "Review draft saved",
  REVIEW_SUBMITTED: "Review submitted",
  REVISION_REQUESTED: "Revision requested",
  REVISION_STARTED: "Revision started",
  REVISION_MANUSCRIPT_UPLOADED: "Revised manuscript uploaded",
  REVISION_RESPONSE_SAVED: "Response to reviewers saved",
  REVISION_SUBMITTED: "Revision submitted",
  REREVIEW_ASSIGNED: "Revision sent for re-review",
  DECISION_CREATED: "Decision drafted",
  DECISION_UPDATED: "Decision edited",
  DECISION_APPROVAL_REQUESTED: "Sent for final approval",
  DECISION_APPROVED: "Final approval given",
  DECISION_RETURNED: "Sent back by the Program Chair",
  DECISION_COMMUNICATED: "Decision communicated to author",
  PAPER_ACCEPTED: "Accepted",
  PAPER_REJECTED: "Rejected",
  PUBLICATION_SCHEDULED: "Scheduled for publication",
  PAPER_PUBLISHED: "Published",
  AGENT_NOTE_ADDED: "Note added by IntelligenceOS",
  AGENT_STATUS_CHANGED: "Status changed by IntelligenceOS",
};
const humanize = (a) => ACTIVITY_LABEL[a] || String(a || "").toLowerCase().replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());
const ACTIVITY_DETAIL_KEYS = ["round", "decision", "role", "type", "from", "to"];

// ---------------------------------------------------------------------------

export const READ_ACTIONS = [
  {
    id: "whoami",
    name: "Who am I",
    description: "Who the agent is acting as in ATLAS Research, their roles (administrator, Program Chair, and per-paper roles such as editor, peer/desk reviewer, SPOC) and a summary of their work: own submissions by status, assignments by role, reviews still to submit, approvals waiting. Call this first to know what the user can see.",
    method: "GET",
    path: "/me",
    risk: "read",
    scope: "research.read",
    params: [],
    async run({ db, viewer, key }) {
      if (!viewer) {
        const n = await db.one(`SELECT COUNT(*) AS n FROM \`${T.papers}\``);
        return { body: { actingAs: null, access: "This key acts on its own (no signed-in user): every paper and record.", key: key.name, papers: Number(n.n) } };
      }
      const [own, assigns, pending, approvals, ach] = await Promise.all([
        db.query(`SELECT status, COUNT(*) AS n FROM \`${T.papers}\` WHERE submitted_by = ? GROUP BY status`, [viewer.id]),
        db.query(`SELECT role, COUNT(*) AS n FROM \`${T.paperAssignments}\` WHERE assignee = ? GROUP BY role`, [viewer.id]),
        db.one(
          `SELECT COUNT(*) AS n FROM \`${T.paperAssignments}\` a JOIN \`${T.papers}\` p ON p.id = a.paper_id
             LEFT JOIN \`${T.reviews}\` r ON r.paper_id = a.paper_id AND r.reviewer = a.assignee AND r.round = p.current_round
            WHERE a.assignee = ? AND a.role IN ('DESK_REVIEWER','PEER_REVIEWER') AND p.status IN ('SUBMITTED','UNDER_REVIEW')
              AND (r.status IS NULL OR r.status <> 'SUBMITTED')`, [viewer.id]),
        viewer.isChair || viewer.isAdmin
          ? db.one(`SELECT COUNT(*) AS n FROM \`${T.decisionApprovals}\` WHERE status = 'PENDING'`)
          : null,
        viewer.isAuthorAccount ? null : db.one(`SELECT COUNT(*) AS n FROM \`${T.achievements}\` WHERE user_id = ?`, [viewer.id]),
      ]);
      const mySubmissions = Object.fromEntries(own.map((r) => [r.status, Number(r.n)]));
      const lines = [];
      if (viewer.isAdmin) lines.push("Administrator: every paper and every person (except managing their own papers).");
      if (viewer.isChair) lines.push("Program Chair: papers sent for final approval.");
      if (assigns.length) lines.push(`Assigned papers: ${assigns.map((a) => `${a.role} × ${a.n}`).join(", ")}.`);
      lines.push("Own submissions, as their author.");
      return {
        body: {
          actingAs: viewerSummary(viewer),
          access: lines.join(" "),
          mySubmissions: { total: own.reduce((s, r) => s + Number(r.n), 0), byStatus: mySubmissions },
          myAssignments: Object.fromEntries(assigns.map((a) => [a.role, Number(a.n)])),
          reviewsToSubmit: Number(pending.n),
          ...(approvals ? { approvalsPending: Number(approvals.n) } : {}),
          ...(ach ? { myAchievements: Number(ach.n) } : {}),
        },
      };
    },
  },

  {
    id: "list_review_assignments",
    name: "List review assignments",
    description: "Desk and peer review assignments with review progress and deadlines. A reviewer sees only their own assignments; an editor sees every reviewer on the papers they edit; the Program Chair sees papers sent for final approval; an administrator sees all. Each row: paper, reviewer display name (managers only), role, due date, review status (NOT_STARTED, DRAFT, SUBMITTED), recommendation once submitted, and deadline state (overdue, due_soon, on_track, done, none). Also returns totals.",
    method: "GET",
    path: "/reviews",
    risk: "read",
    scope: "research.read",
    allow: notAuthorAccount,
    params: [
      { name: "reviewStatus", in: "query", type: "string", required: false, enum: ["NOT_STARTED", "DRAFT", "SUBMITTED"], description: "Only assignments whose review (current round) has this status." },
      { name: "overdue", in: "query", type: "boolean", required: false, description: "true = only assignments past their due date without a submitted review." },
      { name: "role", in: "query", type: "string", required: false, enum: ["DESK_REVIEWER", "PEER_REVIEWER"], description: "Only desk or only peer reviews." },
      { name: "mine", in: "query", type: "boolean", required: false, description: "true = only the signed-in user's own review assignments." },
      submissionFilterParam,
      limitParam("assignments"),
    ],
    async run({ db, query, viewer }) {
      const conds = [c("a.role IN ('DESK_REVIEWER','PEER_REVIEWER')")];
      if (viewer) {
        const m = managedCond(viewer);
        conds.push(query.mine ? c("a.assignee = ?", viewer.id) : c(`(a.assignee = ? OR ${m.sql})`, viewer.id, ...m.params));
      } else if (query.mine) throw new ActionError(400, "mine needs a signed-in user (X-IntelligenceOS-User)");
      if (query.role) conds.push(c("a.role = ?", query.role));
      if (query.reviewStatus === "NOT_STARTED") conds.push(c("r.id IS NULL"));
      else if (query.reviewStatus) conds.push(c("r.status = ?", query.reviewStatus));
      if (query.overdue === true) conds.push(c("a.due_at IS NOT NULL AND a.due_at < UTC_TIMESTAMP(3) AND (r.status IS NULL OR r.status <> 'SUBMITTED')"));
      conds.push(await submissionCond(db, query));
      const w = where(conds);
      const rows = await db.query(
        `SELECT p.id, p.ref_id, p.title, p.status, p.current_round, a.assignee, a.role, a.assigned_at, a.due_at,
                u.name AS reviewer_name, r.status AS review_status, r.recommendation, r.submitted_at
           FROM \`${T.paperAssignments}\` a
           JOIN \`${T.papers}\` p ON p.id = a.paper_id
           LEFT JOIN \`${T.users}\` u ON u.id = a.assignee
           LEFT JOIN \`${T.reviews}\` r ON r.paper_id = a.paper_id AND r.reviewer = a.assignee AND r.round = p.current_round
           ${w.sql}
          ORDER BY a.due_at IS NULL, a.due_at ASC, a.assigned_at DESC LIMIT ?`,
        [...w.params, SCAN_CAP],
      );
      const now = new Date();
      const shaped = rows.map((r) => {
        const reviewStatus = r.review_status || "NOT_STARTED";
        const mine = !!viewer && r.assignee === viewer.id;
        return {
          submission: paperRef(r),
          round: r.current_round,
          role: r.role,
          reviewer: mine ? "You" : r.reviewer_name || "Reviewer",
          assignedAt: iso(r.assigned_at),
          dueAt: iso(r.due_at),
          reviewStatus,
          recommendation: reviewStatus === "SUBMITTED" ? r.recommendation : null,
          submittedAt: iso(r.submitted_at),
          deadline: deadlineState(r.due_at, reviewStatus, now),
        };
      });
      return { body: { totals: summarizeReviews(shaped), returned: Math.min(shaped.length, query.limit), assignments: shaped.slice(0, query.limit) } };
    },
  },

  {
    id: "list_revisions",
    name: "List revisions",
    description: "Revision requests (minor/major) with instructions, due dates and status (REVISION_REQUESTED, REVISION_IN_PROGRESS, REVISION_SUBMITTED, REVISION_UNDER_REVIEW, OVERDUE). An author sees revisions of their own papers; an editor those of the papers they edit; an administrator all.",
    method: "GET",
    path: "/revisions",
    risk: "read",
    scope: "research.read",
    params: [
      { name: "status", in: "query", type: "string", required: false, enum: [...STORED_STATUSES], description: "Only revisions with this stored status." },
      { name: "open", in: "query", type: "boolean", required: false, description: "true = only revisions still open (requested, in progress or submitted)." },
      { name: "mine", in: "query", type: "boolean", required: false, description: "true = only revisions of the signed-in user's own papers." },
      submissionFilterParam,
      limitParam("revisions"),
    ],
    async run({ db, query, viewer }) {
      const conds = [];
      if (viewer) {
        const m = managedCond(viewer);
        conds.push(query.mine ? c("p.submitted_by = ?", viewer.id) : c(`(p.submitted_by = ? OR ${m.sql})`, viewer.id, ...m.params));
      } else if (query.mine) throw new ActionError(400, "mine needs a signed-in user (X-IntelligenceOS-User)");
      if (query.status) conds.push(c("rv.status = ?", query.status));
      if (query.open === true) conds.push(c("rv.status IN (?)", OPEN_STATUSES));
      conds.push(await submissionCond(db, query));
      const w = where(conds);
      const [count, rows] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n FROM \`${T.paperRevisions}\` rv JOIN \`${T.papers}\` p ON p.id = rv.paper_id${w.sql}`, w.params),
        db.query(
          `SELECT p.id, p.ref_id, p.title, p.status, p.submitted_by, rv.round, rv.revision_type, rv.instructions, rv.due_at, rv.status AS rv_status,
                  rv.requested_at, rv.submitted_at
             FROM \`${T.paperRevisions}\` rv JOIN \`${T.papers}\` p ON p.id = rv.paper_id${w.sql}
            ORDER BY rv.requested_at DESC LIMIT ?`, [...w.params, query.limit]),
      ]);
      return {
        body: {
          total: Number(count.n),
          returned: rows.length,
          revisions: rows.map((r) => ({
            submission: paperRef(r),
            ...(viewer ? { mine: r.submitted_by === viewer.id } : {}),
            round: r.round,
            type: r.revision_type,
            status: displayStatus({ status: r.rv_status, due_at: r.due_at }),
            instructions: r.instructions,
            dueAt: iso(r.due_at),
            requestedAt: iso(r.requested_at),
            submittedAt: iso(r.submitted_at),
          })),
        },
      };
    },
  },

  {
    id: "list_decisions",
    name: "List editorial decisions",
    description: "Editorial decisions (Accept, Minor revision, Major revision, Reject) per paper and round. Editors, the Program Chair and administrators see every decision on the papers they manage, with who decided, whether it was released to the author and its final-approval status. An author sees only the decisions released to them on their own papers. Confidential notes are never returned.",
    method: "GET",
    path: "/decisions",
    risk: "read",
    scope: "research.read",
    params: [
      { name: "decision", in: "query", type: "string", required: false, enum: Object.keys(DECISION_LABEL), description: "Only this decision." },
      { name: "released", in: "query", type: "boolean", required: false, description: "true = only decisions communicated to the author; false = only ones not yet released." },
      submissionFilterParam,
      dateParam("from", "Decided on or after this date (YYYY-MM-DD, UTC)."),
      dateParam("to", "Decided on or before this date (YYYY-MM-DD, UTC)."),
      limitParam("decisions"),
    ],
    async run({ db, query, viewer }) {
      const conds = [];
      if (viewer) {
        const m = managedCond(viewer);
        conds.push(c(`(${m.sql} OR (p.submitted_by = ? AND d.released_at IS NOT NULL))`, ...m.params, viewer.id));
      }
      if (query.decision) conds.push(c("d.decision = ?", query.decision));
      if (query.released === true) conds.push(c("d.released_at IS NOT NULL"));
      if (query.released === false) conds.push(c("d.released_at IS NULL"));
      const r = dateRange(query, "d.created_at");
      if (r.parts.length) conds.push(c(r.parts.join(" AND "), ...r.params));
      conds.push(await submissionCond(db, query));
      const w = where(conds);
      const [count, rows] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n FROM \`${T.editorialDecisions}\` d JOIN \`${T.papers}\` p ON p.id = d.paper_id${w.sql}`, w.params),
        db.query(
          `SELECT p.id, p.ref_id, p.title, p.status, p.submitted_by, d.id AS decision_id, d.round, d.decision, d.summary, d.created_at, d.released_at,
                  u.name AS decided_by_name,
                  (SELECT ap.status FROM \`${T.decisionApprovals}\` ap WHERE ap.decision_id = d.id ORDER BY ap.requested_at DESC LIMIT 1) AS approval_status
             FROM \`${T.editorialDecisions}\` d JOIN \`${T.papers}\` p ON p.id = d.paper_id
             LEFT JOIN \`${T.users}\` u ON u.id = d.decided_by${w.sql}
            ORDER BY d.created_at DESC LIMIT ?`, [...w.params, query.limit]),
      ]);
      return {
        body: {
          total: Number(count.n),
          returned: rows.length,
          decisions: rows.map((d) => {
            const base = { submission: paperRef(d), round: d.round, decision: d.decision, label: DECISION_LABEL[d.decision] || d.decision };
            if (viewer && d.submitted_by === viewer.id) {
              return { ...base, mine: true, message: d.summary, decidedAt: iso(d.released_at) };
            }
            return {
              ...base, summary: d.summary, decidedBy: d.decided_by_name || null, decidedAt: iso(d.created_at),
              releasedToAuthorAt: iso(d.released_at), finalApproval: d.approval_status || null,
            };
          }),
        },
      };
    },
  },

  {
    id: "list_approvals",
    name: "List final approvals",
    description: "Program Chair final approvals of Accept / Minor revision / Major revision decisions: waiting (PENDING), APPROVED or RETURNED (sent back to the editor), with the paper, the decision, who requested it, who acted and the chair's comment. Only for the Program Chair and administrators.",
    method: "GET",
    path: "/approvals",
    risk: "read",
    scope: "research.read",
    allow: (viewer) => seesAll(viewer) || !!viewer?.isChair,
    params: [
      { name: "status", in: "query", type: "string", required: false, enum: ["PENDING", "APPROVED", "RETURNED"], description: "Only approvals with this status." },
      submissionFilterParam,
      limitParam("approvals"),
    ],
    async run({ db, query, viewer }) {
      const conds = [];
      if (viewer) conds.push(c("(p.submitted_by IS NULL OR p.submitted_by <> ?)", viewer.id));
      if (query.status) conds.push(c("ap.status = ?", query.status));
      conds.push(await submissionCond(db, query));
      const w = where(conds);
      const [count, rows] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n FROM \`${T.decisionApprovals}\` ap JOIN \`${T.papers}\` p ON p.id = ap.paper_id${w.sql}`, w.params),
        db.query(
          `SELECT p.id, p.ref_id, p.title, p.status, ap.round, ap.decision, ap.status AS ap_status, ap.requested_at, ap.acted_at, ap.comment,
                  rq.name AS requested_by_name, ac.name AS acted_by_name
             FROM \`${T.decisionApprovals}\` ap JOIN \`${T.papers}\` p ON p.id = ap.paper_id
             LEFT JOIN \`${T.users}\` rq ON rq.id = ap.requested_by
             LEFT JOIN \`${T.users}\` ac ON ac.id = ap.acted_by${w.sql}
            ORDER BY ap.status = 'PENDING' DESC, ap.requested_at DESC LIMIT ?`, [...w.params, query.limit]),
      ]);
      return {
        body: {
          total: Number(count.n),
          returned: rows.length,
          approvals: rows.map((a) => ({
            submission: paperRef(a),
            round: a.round,
            decision: a.decision,
            label: DECISION_LABEL[a.decision] || a.decision,
            status: a.ap_status,
            requestedBy: a.requested_by_name || null,
            requestedAt: iso(a.requested_at),
            actedBy: a.acted_by_name || null,
            actedAt: iso(a.acted_at),
            comment: a.comment || null,
          })),
        },
      };
    },
  },

  {
    id: "list_publications",
    name: "List publications",
    description: "Papers published (or scheduled) in the journal, with volume, issue, DOI, pages and publication date. Everyone sees what is publicly published; administrators and the paper's editor also see scheduled ones; an author also sees their own. Author names are not included.",
    method: "GET",
    path: "/publications",
    risk: "read",
    scope: "research.read",
    params: [
      { name: "status", in: "query", type: "string", required: false, enum: ["SCHEDULED", "PUBLISHED"], description: "Only publications with this status." },
      { name: "year", in: "query", type: "integer", required: false, min: 1900, max: 2200, description: "Only publications in volumes of this year." },
      { name: "volume", in: "query", type: "integer", required: false, min: 1, max: 9999, description: "Only this volume number." },
      { name: "search", in: "query", type: "string", required: false, maxLength: 100, description: "Words to find in the title or keywords." },
      limitParam("publications"),
    ],
    async run({ db, query, viewer }) {
      const publicCond = "(pb.status = 'PUBLISHED' AND i.status = 'PUBLISHED' AND v.status = 'PUBLISHED')";
      const conds = [];
      if (viewer && !viewer.isAdmin) {
        conds.push(c(
          `(${publicCond} OR p.submitted_by = ? OR p.id IN (SELECT paper_id FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = 'EDITOR'))`,
          viewer.id, viewer.id));
      }
      if (query.status) conds.push(c("pb.status = ?", query.status));
      if (query.year) conds.push(c("v.year = ?", query.year));
      if (query.volume) conds.push(c("v.volume_number = ?", query.volume));
      if (query.search) {
        const like = `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
        conds.push(c("(pb.title LIKE ? OR CAST(pb.keywords AS CHAR) LIKE ?)", like, like));
      }
      const w = where(conds);
      const from = `FROM \`${T.publications}\` pb
           JOIN \`${T.papers}\` p ON p.id = pb.paper_id
           JOIN \`${T.volumes}\` v ON v.id = pb.volume_id
           JOIN \`${T.issues}\` i ON i.id = pb.issue_id`;
      const [count, rows] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n ${from}${w.sql}`, w.params),
        db.query(
          `SELECT p.id, p.ref_id, p.status, pb.title, pb.keywords, pb.page_start, pb.page_end, pb.doi, pb.publication_date,
                  pb.status AS pub_status, pb.published_at, pb.scheduled_at,
                  v.volume_number, v.year, v.title AS volume_title, i.issue_number, i.title AS issue_title
             ${from}${w.sql}
            ORDER BY v.year DESC, v.volume_number DESC, i.issue_number DESC, pb.page_start ASC LIMIT ?`, [...w.params, query.limit]).then(jrows),
      ]);
      return {
        body: {
          total: Number(count.n),
          returned: rows.length,
          publications: rows.map((r) => ({
            submission: { id: r.id, refId: r.ref_id || null },
            title: r.title,
            keywords: Array.isArray(r.keywords) ? r.keywords : [],
            status: r.pub_status,
            volume: { number: r.volume_number, year: r.year, title: r.volume_title },
            issue: { number: r.issue_number, title: r.issue_title },
            pages: r.page_start ? (r.page_end ? `${r.page_start}–${r.page_end}` : String(r.page_start)) : null,
            doi: r.doi || null,
            publicationDate: day(r.publication_date),
            publishedAt: iso(r.published_at),
            scheduledAt: iso(r.scheduled_at),
          })),
        },
      };
    },
  },

  {
    id: "list_volumes",
    name: "List volumes and issues",
    description: "Journal volumes with their issues, status (DRAFT, SCHEDULED, PUBLISHED), publication dates and how many papers each issue holds. Everyone sees published volumes and issues; administrators and editors also see drafts and scheduled ones.",
    method: "GET",
    path: "/volumes",
    risk: "read",
    scope: "research.read",
    params: [
      { name: "year", in: "query", type: "integer", required: false, min: 1900, max: 2200, description: "Only volumes of this year." },
      { name: "status", in: "query", type: "string", required: false, enum: ["DRAFT", "SCHEDULED", "PUBLISHED"], description: "Only volumes with this status." },
    ],
    async run({ db, query, viewer }) {
      const all = seesAll(viewer) || isEditorAnywhere(viewer);
      const conds = [];
      if (!all) conds.push(c("v.status = 'PUBLISHED'"));
      if (query.year) conds.push(c("v.year = ?", query.year));
      if (query.status) conds.push(c("v.status = ?", query.status));
      const w = where(conds);
      const volumes = await db.query(
        `SELECT v.id, v.volume_number, v.year, v.title, v.description, v.status, v.published_at FROM \`${T.volumes}\` v${w.sql}
          ORDER BY v.year DESC, v.volume_number DESC LIMIT ?`, [...w.params, MAX_LIMIT]);
      const ids = volumes.map((v) => v.id);
      const issues = ids.length
        ? await db.query(
          `SELECT i.id, i.volume_id, i.issue_number, i.title, i.status, i.publication_date, i.published_at,
                  (SELECT COUNT(*) FROM \`${T.publications}\` pb WHERE pb.issue_id = i.id${all ? "" : " AND pb.status = 'PUBLISHED'"}) AS papers
             FROM \`${T.issues}\` i WHERE i.volume_id IN (?)${all ? "" : " AND i.status = 'PUBLISHED'"} ORDER BY i.issue_number ASC`, [ids])
        : [];
      return {
        body: {
          total: volumes.length,
          volumes: volumes.map((v) => ({
            number: v.volume_number,
            year: v.year,
            title: v.title,
            description: v.description,
            status: v.status,
            publishedAt: iso(v.published_at),
            issues: issues.filter((i) => i.volume_id === v.id).map((i) => ({
              number: i.issue_number, title: i.title, status: i.status, publicationDate: day(i.publication_date),
              publishedAt: iso(i.published_at), papers: Number(i.papers),
            })),
          })),
        },
      };
    },
  },

  {
    id: "list_achievements",
    name: "List faculty achievements",
    description: "Faculty achievement records (professional achievements, fellowships, awards, consultancy, external grants) with type, title, school, date, amount (INR), verification status and the type-specific details. Faculty and students see their own records; administrators see everyone's, with the faculty member's name. File names are never returned.",
    method: "GET",
    path: "/achievements",
    risk: "read",
    scope: "research.read",
    allow: notAuthorAccount,
    params: [
      { name: "type", in: "query", type: "string", required: false, enum: [...ACHIEVEMENT_TYPE_KEYS], description: "Only this type: PROFESSIONAL, FELLOWSHIP, AWARD, CONSULTANCY or GRANT." },
      { name: "status", in: "query", type: "string", required: false, enum: [...ACHIEVEMENT_STATUSES], description: "SUBMITTED (awaiting check), VERIFIED or REJECTED." },
      { name: "school", in: "query", type: "string", required: false, enum: [...ACHIEVEMENT_SCHOOLS], description: "Only this school." },
      { name: "mine", in: "query", type: "boolean", required: false, description: "true = only the signed-in user's own records (useful for administrators)." },
      dateParam("from", "Achievement date on or after (YYYY-MM-DD)."),
      dateParam("to", "Achievement date on or before (YYYY-MM-DD)."),
      limitParam("records"),
    ],
    async run({ db, query, viewer }) {
      const conds = [];
      if (viewer && (!viewer.isAdmin || query.mine)) conds.push(c("a.user_id = ?", viewer.id));
      else if (!viewer && query.mine) throw new ActionError(400, "mine needs a signed-in user (X-IntelligenceOS-User)");
      if (query.type) conds.push(c("a.type = ?", query.type));
      if (query.status) conds.push(c("a.status = ?", query.status));
      if (query.school) conds.push(c("a.school_code = ?", query.school));
      if (query.from && query.to && query.from > query.to) throw new ActionError(400, "from must be on or before to");
      if (query.from) conds.push(c("a.achievement_date >= ?", query.from));
      if (query.to) conds.push(c("a.achievement_date <= ?", query.to));
      const w = where(conds);
      const showName = seesAll(viewer);
      const [count, rows] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n FROM \`${T.achievements}\` a${w.sql}`, w.params),
        db.query(
          `SELECT a.id, a.user_id, a.type, a.school_code, a.title, a.achievement_date, a.amount_inr, a.atlas_affiliation, a.details,
                  a.status, a.review_note, a.reviewed_at, a.created_at, u.name AS faculty_name
             FROM \`${T.achievements}\` a LEFT JOIN \`${T.users}\` u ON u.id = a.user_id${w.sql}
            ORDER BY a.achievement_date DESC, a.created_at DESC LIMIT ?`, [...w.params, query.limit]).then(jrows),
      ]);
      return {
        body: {
          total: Number(count.n),
          returned: rows.length,
          achievements: rows.map((a) => {
            const details = typeof a.details === "string" ? (() => { try { return JSON.parse(a.details); } catch { return {}; } })() : a.details || {};
            return {
              id: a.id,
              type: a.type,
              typeLabel: ACHIEVEMENT_TYPES[a.type]?.name || a.type,
              title: a.title,
              school: a.school_code,
              date: day(a.achievement_date),
              amountInr: a.amount_inr == null ? null : Number(a.amount_inr),
              atlasAffiliation: a.atlas_affiliation || null,
              status: a.status,
              reviewNote: a.review_note || null,
              reviewedAt: iso(a.reviewed_at),
              submittedAt: iso(a.created_at),
              details: detailPairs(a.type, details).map(({ label, value }) => ({ label, value })),
              ...(showName ? { faculty: viewer && a.user_id === viewer.id ? "You" : a.faculty_name || null } : {}),
            };
          }),
        },
      };
    },
  },

  {
    id: "achievement_stats",
    name: "Achievement statistics",
    description: "Count faculty achievements by type, status and school, with the total amount (INR) per type, optionally for a date range. Faculty see their own numbers; administrators see the whole university.",
    method: "GET",
    path: "/stats/achievements",
    risk: "read",
    scope: "research.read",
    allow: notAuthorAccount,
    params: [
      dateParam("from", "Achievement date on or after (YYYY-MM-DD)."),
      dateParam("to", "Achievement date on or before (YYYY-MM-DD)."),
      { name: "school", in: "query", type: "string", required: false, enum: [...ACHIEVEMENT_SCHOOLS], description: "Only this school." },
    ],
    async run({ db, query, viewer }) {
      const conds = [];
      if (!seesAll(viewer)) conds.push(c("user_id = ?", viewer.id));
      if (query.school) conds.push(c("school_code = ?", query.school));
      if (query.from && query.to && query.from > query.to) throw new ActionError(400, "from must be on or before to");
      if (query.from) conds.push(c("achievement_date >= ?", query.from));
      if (query.to) conds.push(c("achievement_date <= ?", query.to));
      const w = where(conds);
      const rows = await db.query(
        `SELECT type, status, school_code, COUNT(*) AS n, COALESCE(SUM(amount_inr), 0) AS amount
           FROM \`${T.achievements}\`${w.sql} GROUP BY type, status, school_code`, w.params);
      const byType = Object.fromEntries(ACHIEVEMENT_TYPE_KEYS.map((k) => [k, { label: ACHIEVEMENT_TYPES[k].name, count: 0, amountInr: 0 }]));
      const byStatus = Object.fromEntries(ACHIEVEMENT_STATUSES.map((s) => [s, 0]));
      const bySchool = {};
      let total = 0;
      for (const r of rows) {
        const n = Number(r.n);
        total += n;
        if (byType[r.type]) { byType[r.type].count += n; byType[r.type].amountInr += Number(r.amount); }
        byStatus[r.status] = (byStatus[r.status] || 0) + n;
        bySchool[r.school_code] = (bySchool[r.school_code] || 0) + n;
      }
      return { body: { total, byType, byStatus, bySchool, from: query.from || null, to: query.to || null, scope: seesAll(viewer) ? "all" : "mine" } };
    },
  },

  {
    id: "list_activity",
    name: "List activity",
    description: "Recent activity on submissions, newest first (submitted, assigned, review submitted, revision requested, decision communicated, published …). Managers (administrators, the paper's editor, the Program Chair) see every event with who did it; an author sees the milestones of their own papers without names; anyone sees their own actions.",
    method: "GET",
    path: "/activity",
    risk: "read",
    scope: "research.read",
    params: [
      submissionFilterParam,
      dateParam("from", "On or after this date (YYYY-MM-DD, UTC)."),
      dateParam("to", "On or before this date (YYYY-MM-DD, UTC)."),
      limitParam("events"),
    ],
    async run({ db, query, viewer }) {
      const conds = [];
      if (viewer) {
        const m = managedCond(viewer);
        conds.push(c(
          `(${m.sql} OR (p.submitted_by = ? AND pa.action IN (?)) OR pa.actor = ?)`,
          ...m.params, viewer.id, OWNER_VISIBLE_ACTIONS, viewer.id));
      }
      const r = dateRange(query, "pa.created_at");
      if (r.parts.length) conds.push(c(r.parts.join(" AND "), ...r.params));
      conds.push(await submissionCond(db, query));
      const w = where(conds);
      const rows = await db.query(
        `SELECT p.id, p.ref_id, p.title, p.status, p.submitted_by, pa.action, pa.actor, pa.detail, pa.created_at, u.name AS actor_name
           FROM \`${T.paperActivity}\` pa JOIN \`${T.papers}\` p ON p.id = pa.paper_id
           LEFT JOIN \`${T.users}\` u ON u.id = pa.actor${w.sql}
          ORDER BY pa.created_at DESC LIMIT ?`, [...w.params, query.limit]).then(jrows);
      // Which papers does the viewer manage? (decides whether names/detail may be shown)
      let managed = null;
      if (viewer && rows.length) {
        const m = managedCond(viewer);
        const ids = [...new Set(rows.map((x) => x.id))];
        managed = new Set((await db.query(`SELECT p.id FROM \`${T.papers}\` p WHERE p.id IN (?) AND ${m.sql}`, [ids, ...m.params])).map((x) => x.id));
      }
      return {
        body: {
          returned: rows.length,
          activity: rows.map((a) => {
            const own = !!viewer && a.actor === viewer.id;
            const full = !viewer || managed.has(a.id);
            const d = a.detail || {};
            const detail = full ? Object.fromEntries(ACTIVITY_DETAIL_KEYS.filter((k) => d[k] !== undefined && d[k] !== null).map((k) => [k, d[k]])) : {};
            return {
              at: iso(a.created_at),
              submission: paperRef(a),
              event: a.action,
              label: humanize(a.action),
              ...(own ? { by: "You" } : full ? { by: a.actor_name || (a.actor ? "Portal user" : "System / IntelligenceOS") } : {}),
              ...(Object.keys(detail).length ? { detail } : {}),
            };
          }),
        },
      };
    },
  },

  {
    id: "list_users",
    name: "List portal people",
    description: "People with portal accounts (faculty and students; external AIDC authors are only counted), with account type, school, administrator flag, roles (Editor, Peer/Desk Reviewer, SPOC, Program Chair …), status and last sign-in. Emails are not returned. Administrators only.",
    method: "GET",
    path: "/users",
    risk: "read",
    scope: "research.read",
    allow: seesAll,
    params: [
      { name: "role", in: "query", type: "string", required: false, enum: ["ADMINISTRATOR", "SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR", "PROGRAM_CHAIR"], description: "Only people holding this role." },
      { name: "accountType", in: "query", type: "string", required: false, enum: ["FACULTY", "STUDENT"], description: "Only faculty or only students." },
      { name: "status", in: "query", type: "string", required: false, enum: ["ACTIVE", "DISABLED"], description: "Only active or only disabled accounts." },
      { name: "search", in: "query", type: "string", required: false, maxLength: 100, description: "Part of the person's name." },
      limitParam("people"),
    ],
    async run({ db, query }) {
      const conds = [c("u.baseType <> 'AUTHOR'")];
      if (query.role === "ADMINISTRATOR") conds.push(c("(u.isAdmin = 1 OR u.id IN (SELECT user_id FROM `" + T.userRoles + "` WHERE role = 'ADMINISTRATOR'))"));
      else if (query.role) conds.push(c(`u.id IN (SELECT user_id FROM \`${T.userRoles}\` WHERE role = ?)`, query.role));
      if (query.accountType) conds.push(c("u.baseType = ?", query.accountType));
      if (query.status) conds.push(c("u.status = ?", query.status));
      if (query.search) conds.push(c("u.name LIKE ?", `%${query.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`));
      const w = where(conds);
      const [count, rows, byType] = await Promise.all([
        db.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` u${w.sql}`, w.params),
        db.query(
          `SELECT u.id, u.name, u.baseType AS base_type, u.isAdmin AS is_admin, u.status, u.schoolCode AS school_code, u.createdAt AS created_at, u.lastLoginAt AS last_login_at
             FROM \`${T.users}\` u${w.sql} ORDER BY u.name ASC LIMIT ?`, [...w.params, query.limit]),
        db.query(`SELECT baseType AS t, COUNT(*) AS n FROM \`${T.users}\` GROUP BY baseType`),
      ]);
      const ids = rows.map((u) => u.id);
      const [roles, assigns] = ids.length
        ? await Promise.all([
          db.query(`SELECT user_id, role FROM \`${T.userRoles}\` WHERE user_id IN (?) ORDER BY role`, [ids]),
          db.query(`SELECT assignee, role, COUNT(*) AS n FROM \`${T.paperAssignments}\` WHERE assignee IN (?) GROUP BY assignee, role`, [ids]),
        ])
        : [[], []];
      return {
        body: {
          total: Number(count.n),
          returned: rows.length,
          accounts: Object.fromEntries(byType.map((r) => [r.t, Number(r.n)])),
          people: rows.map((u) => ({
            name: u.name || "(no name)",
            accountType: u.base_type,
            school: u.school_code || null,
            schoolName: departmentName(u.school_code),
            administrator: !!Number(u.is_admin),
            roles: roles.filter((r) => r.user_id === u.id).map((r) => r.role),
            assignedPapers: Object.fromEntries(assigns.filter((a) => a.assignee === u.id).map((a) => [a.role, Number(a.n)])),
            status: u.status,
            joinedAt: iso(u.created_at),
            lastSignInAt: iso(u.last_login_at),
          })),
        },
      };
    },
  },

  {
    id: "registration_stats",
    name: "AIDC registration statistics",
    description: "AIDC (ATLAS conference) external author registrations as numbers only: author accounts by current status and conference, registrations started but not finished, and how many papers they submitted by status. No names, emails or phone numbers. Administrators only.",
    method: "GET",
    path: "/stats/registrations",
    risk: "read",
    scope: "research.read",
    allow: seesAll,
    params: [],
    async run({ db }) {
      const [byStatus, byConf, pending, papers] = await Promise.all([
        db.query(`SELECT current_status AS k, COUNT(*) AS n FROM \`${T.authorProfiles}\` GROUP BY current_status`),
        db.query(`SELECT conference AS k, COUNT(*) AS n FROM \`${T.authorProfiles}\` GROUP BY conference`),
        db.one(`SELECT COUNT(*) AS n FROM \`${T.authorRegistrations}\` WHERE expires_at > UTC_TIMESTAMP(3)`),
        db.query(
          `SELECT p.status AS k, COUNT(*) AS n FROM \`${T.papers}\` p JOIN \`${T.users}\` u ON u.id = p.submitted_by
            WHERE u.baseType = 'AUTHOR' GROUP BY p.status`),
      ]);
      const total = byStatus.reduce((s, r) => s + Number(r.n), 0);
      const paperByStatus = Object.fromEntries(PAPER_STATUSES.map((s) => [s, 0]));
      for (const r of papers) paperByStatus[r.k] = Number(r.n);
      return {
        body: {
          authors: total,
          byCurrentStatus: Object.fromEntries(byStatus.map((r) => [r.k, Number(r.n)])),
          byConference: Object.fromEntries(byConf.map((r) => [r.k, Number(r.n)])),
          registrationsInProgress: Number(pending.n),
          papers: { total: papers.reduce((s, r) => s + Number(r.n), 0), byStatus: paperByStatus },
        },
      };
    },
  },
];

