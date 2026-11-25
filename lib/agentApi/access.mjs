/**
 * IntelligenceOS Agent API — "acts as the signed-in user" (spec v1.1 §2a).
 *
 * When IntelligenceOS connects the portal with "This project acts as the
 * signed-in user", every request carries `X-IntelligenceOS-User: <email of the
 * agent's owner>`. The portal then answers AS THAT PERSON: the manifest lists
 * only what their account may use, and every action returns only the records
 * they could see in the portal itself.
 *
 *   no header      → the key acts on its own (admin connecting): everything
 *                    the key's scopes allow — unchanged from v1.0.
 *   header         → `viewer` = the ACTIVE portal account with that email
 *                    (case-insensitive). Unknown / inactive / malformed → 403.
 *
 * Access mirrors the portal (requirements-and-role-matrix.md, lib/session.js):
 *   - Administrator is the one global role: every paper, every person.
 *   - SPOC / Desk / Peer Reviewer / Editor are assigned PER PAPER.
 *   - Program Chair (role + allowlisted email): papers sent for final approval.
 *   - Everyone sees the papers they submitted, as their author.
 *   - A person with several roles sees all of them, each paper through the
 *     relationship they hold on THAT paper.
 *   - External AIDC authors (baseType AUTHOR) never hold roles, even if a row
 *     was edited by hand.
 *
 * Per-paper "view" (what an action may return about the paper):
 *   manager  — key without a user, Administrator, the paper's Editor, or the
 *              Program Chair on a paper with an approval request: reviewers
 *              (display names), review progress, decisions, notes, history.
 *   owner    — the person who submitted it (even an Administrator, as in the
 *              app): released decisions, revision requests, reviewer comments
 *              meant for the author — never reviewer identity or drafts.
 *   reviewer — Desk / Peer Reviewer / SPOC on the paper: the paper itself and
 *              their OWN assignment + review — never other reviewers, the desk
 *              review or the editor's decision.
 * Author identity (names, emails) is never returned to anyone.
 */
import { T } from "../db/tables.mjs";
import { ActionError, nonEmpty } from "./common.mjs";

export const USER_HEADER = "x-intelligenceos-user";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REVIEW_ROLES = ["DESK_REVIEWER", "PEER_REVIEWER", "SPOC"];

const norm = (e) => String(e || "").trim().toLowerCase();

/**
 * The portal account behind an X-IntelligenceOS-User header → viewer, or
 * throws ActionError(403) with a plain-language reason IntelligenceOS shows
 * to that person.
 */
export async function resolveViewer(db, rawEmail, { chairEmails = [] } = {}) {
  const email = norm(rawEmail);
  if (!email || email.length > 191 || !EMAIL_RE.test(email)) {
    throw new ActionError(403, "The signed-in user's email is not valid, so ATLAS Research can't tell who is asking.");
  }
  const u = await db.one(
    `SELECT id, name, email, baseType AS base_type, isAdmin AS is_admin, status FROM \`${T.users}\` WHERE email = ?`,
    [email],
  );
  if (!u) throw new ActionError(403, `There is no ATLAS Research portal account for ${email}. Sign in to the portal once with this email, or ask a portal administrator for access.`);
  if (u.status !== "ACTIVE") throw new ActionError(403, `The ATLAS Research portal account for ${email} is not active. Ask a portal administrator.`);
  const isAuthor = u.base_type === "AUTHOR";
  const roles = isAuthor ? [] : (await db.query(`SELECT role FROM \`${T.userRoles}\` WHERE user_id = ? ORDER BY role`, [u.id])).map((r) => r.role);
  const assignmentRoles = isAuthor
    ? []
    : (await db.query(`SELECT DISTINCT role FROM \`${T.paperAssignments}\` WHERE assignee = ? ORDER BY role`, [u.id])).map((r) => r.role);
  return {
    id: u.id,
    name: u.name || u.email,
    email: u.email,
    baseType: u.base_type || null,
    isAuthorAccount: isAuthor,
    isAdmin: isAuthor ? false : !!Number(u.is_admin),
    // Program Chair = the PROGRAM_CHAIR role AND an allowlisted email (as lib/session.js).
    isChair: roles.includes("PROGRAM_CHAIR") && chairEmails.map(norm).includes(email),
    roles,
    assignmentRoles,
  };
}

/** Is this viewer allowed to see everything (key on its own, or an Administrator)? */
export const seesAll = (viewer) => !viewer || viewer.isAdmin;
export const isEditorAnywhere = (viewer) => !!viewer?.assignmentRoles?.includes("EDITOR");

/**
 * SQL condition limiting papers (table alias `a`) to the ones the viewer can
 * open. → { sql, params }. Values are bound; nothing is spliced in.
 */
export function paperScope(viewer, a = "p") {
  if (seesAll(viewer)) return { sql: "1=1", params: [] };
  const parts = [
    `${a}.submitted_by = ?`,
    `${a}.id IN (SELECT paper_id FROM \`${T.paperAssignments}\` WHERE assignee = ?)`,
  ];
  const params = [viewer.id, viewer.id];
  if (viewer.isChair) parts.push(`${a}.id IN (SELECT paper_id FROM \`${T.decisionApprovals}\`)`);
  return { sql: `(${parts.join(" OR ")})`, params };
}

/**
 * The viewer's relationship to each paper → Map(paperId → access) where
 *   access = { view: "manager"|"owner"|"reviewer", myRoles: string[], canWrite: boolean,
 *              myAssignments: [{ role, dueAt, assignedAt }] }
 * Papers the viewer can't open are absent from the map.
 */
export async function accessFor(db, viewer, papers) {
  const out = new Map();
  const list = papers || [];
  if (!list.length) return out;
  if (!viewer) {
    for (const p of list) out.set(p.id, { view: "manager", myRoles: [], canWrite: true, myAssignments: [] });
    return out;
  }
  const ids = list.map((p) => p.id);
  const [assigns, approvals] = await Promise.all([
    viewer.isAuthorAccount
      ? []
      : db.query(`SELECT paper_id, role, assigned_at, due_at FROM \`${T.paperAssignments}\` WHERE assignee = ? AND paper_id IN (?)`, [viewer.id, nonEmpty(ids)]),
    viewer.isChair
      ? db.query(`SELECT DISTINCT paper_id FROM \`${T.decisionApprovals}\` WHERE paper_id IN (?)`, [nonEmpty(ids)])
      : [],
  ]);
  const byPaper = new Map();
  for (const a of assigns) {
    if (!byPaper.has(a.paper_id)) byPaper.set(a.paper_id, []);
    byPaper.get(a.paper_id).push(a);
  }
  const chairPapers = new Set(approvals.map((r) => r.paper_id));
  for (const p of list) {
    const mine = byPaper.get(p.id) || [];
    const roles = mine.map((a) => a.role);
    const owner = !!p.submitted_by && p.submitted_by === viewer.id;
    const chair = chairPapers.has(p.id);
    const myRoles = [
      ...(owner ? ["SUBMITTER"] : []),
      ...(viewer.isAdmin ? ["ADMINISTRATOR"] : []),
      ...(chair ? ["PROGRAM_CHAIR"] : []),
      ...roles,
    ];
    let view = null;
    // The paper's own author never manages it — not even an administrator.
    if (owner) view = "owner";
    else if (viewer.isAdmin || roles.includes("EDITOR") || chair) view = "manager";
    else if (roles.some((r) => REVIEW_ROLES.includes(r))) view = "reviewer";
    if (!view) continue;
    out.set(p.id, {
      view,
      myRoles,
      canWrite: !owner && (viewer.isAdmin || roles.includes("EDITOR")),
      myAssignments: mine.map((a) => ({ role: a.role, assignedAt: a.assigned_at, dueAt: a.due_at })),
    });
  }
  return out;
}

/** Access to ONE paper, or 404 (never 403 — don't confirm that a hidden paper exists). */
export async function accessOne(db, viewer, paper) {
  const acc = (await accessFor(db, viewer, [paper])).get(paper.id);
  if (!acc) throw new ActionError(404, "Submission not found");
  return acc;
}

/** Summary of who the viewer is, for the `whoami` action. */
export function viewerSummary(viewer) {
  if (!viewer) return null;
  return {
    name: viewer.name,
    email: viewer.email,
    accountType: viewer.baseType,
    administrator: viewer.isAdmin,
    programChair: viewer.isChair,
    accountRoles: viewer.roles,
    paperRoles: viewer.assignmentRoles,
  };
}
