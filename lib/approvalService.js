import "server-only";

import { db, T } from "@/lib/db";
import { programChairEmails } from "@/lib/config/env";
import { notifyLater } from "@/lib/notifyServer";
import { usersByIds } from "@/lib/repos/users.mjs";
import { jrows } from "@/lib/repos/rows.mjs";
import { mapRpcError } from "@/lib/revisionLogic";
import { DECISION_LABEL, approvalForManager } from "@/lib/decisionLogic";
import { approveDecision, returnDecision } from "@/lib/services/workflow.mjs";

/**
 * Program Chair final approval — server side.
 *
 * Who may act: the Program Chair (PROGRAM_CHAIR role + allowlisted email, both
 * resolved from the session — see lib/session.js) or, as backup, any
 * Administrator. The workflow transaction (lib/services/workflow.mjs
 * isApprover) re-checks this against MySQL, so the session flag is never the
 * only gate. The approver sees author names; they can approve or send back,
 * never change the decision.
 */
export const canApprove = (me) => !!me && (me.isAdmin || me.isProgramChair);

const name = (nameById, id) => (id ? nameById.get(id) || null : null);

/** Pending requests (with everything needed to judge them) + recent history. */
export async function loadApprovals(me) {
  const pending = await db.query(
    `SELECT * FROM \`${T.decisionApprovals}\` WHERE status = 'PENDING' ORDER BY requested_at ASC LIMIT 200`);
  const recent = await db.query(
    `SELECT * FROM \`${T.decisionApprovals}\` WHERE status <> 'PENDING' ORDER BY acted_at DESC LIMIT 50`);

  const paperIds = [...new Set([...pending, ...recent].map((a) => a.paper_id))];
  if (!paperIds.length) return { pending: [], recent: [] };

  const pendingPaperIds = [...new Set(pending.map((a) => a.paper_id))];
  const decisionIds = [...new Set(pending.map((a) => a.decision_id))];
  const [papers, authors, decisions, history, reviews] = await Promise.all([
    db.query(`SELECT id, ref_id, title, abstract, keywords, status, current_round, submitted_by, created_at FROM \`${T.papers}\` WHERE id IN (?)`, [paperIds]).then(jrows),
    pendingPaperIds.length
      ? db.query(`SELECT paper_id, full_name, email, affiliation, is_corresponding, author_order FROM \`${T.paperAuthors}\` WHERE paper_id IN (?) ORDER BY author_order ASC`, [pendingPaperIds])
      : [],
    decisionIds.length
      ? db.query(`SELECT id, paper_id, round, decision, summary, confidential_note, review_ids, revision_due_at, version, decided_by, updated_at
                    FROM \`${T.editorialDecisions}\` WHERE id IN (?)`, [decisionIds]).then(jrows)
      : [],
    decisionIds.length
      ? db.query(`SELECT * FROM \`${T.decisionApprovals}\` WHERE decision_id IN (?) ORDER BY requested_at ASC`, [decisionIds])
      : [],
    pendingPaperIds.length
      ? db.query(`SELECT id, paper_id, reviewer, round, recommendation, technical_quality, originality, methodology, clarity,
                         strengths, weaknesses, comments_to_author, confidential_to_editor, submitted_at
                    FROM \`${T.reviews}\` WHERE paper_id IN (?) AND status = 'SUBMITTED' ORDER BY submitted_at ASC`, [pendingPaperIds])
      : [],
  ]);

  const paperById = new Map(papers.map((p) => [p.id, p]));
  const decById = new Map(decisions.map((d) => [d.id, d]));
  const people = await usersByIds(db, [
    ...[...pending, ...recent, ...history].flatMap((a) => [a.requested_by, a.acted_by]),
    ...papers.map((p) => p.submitted_by),
    ...decisions.map((d) => d.decided_by),
    ...reviews.map((r) => r.reviewer),
  ]);
  const nameById = new Map([...people].map(([id, p]) => [id, p.name || p.email]));

  const pendingOut = pending.map((a) => {
    const p = paperById.get(a.paper_id) || {};
    const d = decById.get(a.decision_id) || {};
    const shared = new Set(d.review_ids || []);
    const submitter = p.submitted_by ? people.get(p.submitted_by) : null;
    return {
      id: a.id,
      requestedAt: a.requested_at,
      requestedBy: name(nameById, a.requested_by),
      // Nobody approves a decision on their own paper (enforced server-side too).
      canAct: !(p.submitted_by && p.submitted_by === me.id),
      paper: {
        id: p.id, refId: p.ref_id || null, title: p.title, abstract: p.abstract, keywords: p.keywords || [],
        status: p.status, round: p.current_round, submittedAt: p.created_at,
        manuscriptUrl: `/api/papers/${a.paper_id}/manuscript`,
      },
      submittedBy: submitter ? { name: submitter.name || submitter.email, email: submitter.email } : null,
      authors: authors.filter((x) => x.paper_id === a.paper_id).map((x) => ({
        name: x.full_name, email: x.email || null, affiliation: x.affiliation || null, corresponding: !!x.is_corresponding,
      })),
      decision: {
        decision: a.decision,
        label: DECISION_LABEL[a.decision] || a.decision,
        round: a.round,
        summary: d.summary || "",
        confidentialNote: d.confidential_note || null,
        revisionDueAt: d.revision_due_at || null,
        version: a.decision_version,
        decidedBy: name(nameById, d.decided_by),
      },
      reviews: reviews.filter((r) => r.paper_id === a.paper_id && r.round === a.round).map((r) => ({
        id: r.id,
        reviewer: name(nameById, r.reviewer) || "Reviewer",
        recommendation: r.recommendation,
        scores: { technicalQuality: r.technical_quality, originality: r.originality, methodology: r.methodology, clarity: r.clarity },
        strengths: r.strengths || null,
        weaknesses: r.weaknesses || null,
        commentsToAuthor: r.comments_to_author || null,
        confidentialToEditor: r.confidential_to_editor || null,
        submittedAt: r.submitted_at,
        sharedWithAuthor: shared.has(r.id),
      })),
      previous: history
        .filter((h) => h.decision_id === a.decision_id && h.id !== a.id)
        .map((h) => approvalForManager(h, nameById)),
    };
  });

  const recentOut = recent.map((a) => ({
    id: a.id,
    status: a.status,
    decision: a.decision,
    label: DECISION_LABEL[a.decision] || a.decision,
    round: a.round,
    paperId: a.paper_id,
    refId: paperById.get(a.paper_id)?.ref_id || null,
    title: paperById.get(a.paper_id)?.title || "Untitled submission",
    requestedBy: name(nameById, a.requested_by),
    requestedAt: a.requested_at,
    actedBy: name(nameById, a.acted_by),
    actedAt: a.acted_at,
    comment: a.comment || null,
  }));

  return { pending: pendingOut, recent: recentOut };
}

/**
 * Approve or send back one request. → { status, body }
 *   approve: the editor's decision is communicated to the author unchanged.
 *   return:  back to the editor with a required comment; nothing reaches the author.
 */
export async function actOnApproval(approvalId, me, action, comment) {
  if (!canApprove(me)) return { status: 403, body: { error: "Only the Program Chair or an administrator can do this." } };
  if (action !== "approve" && action !== "return") return { status: 422, body: { error: "Choose approve or send back." } };
  const args = { approvalId, actorId: me.id, chairEmails: programChairEmails(), comment };
  let r;
  try {
    r = action === "approve" ? await approveDecision(db, args) : await returnDecision(db, args);
  } catch (e) {
    const m = mapRpcError(e);
    if (m) return { status: m.status, body: { error: m.error } };
    throw e;
  }
  if (action === "approve") {
    notifyLater("DECISION_AVAILABLE", { paperId: r.paperId, actorId: me.id, round: r.round });
    notifyLater("DECISION_APPROVED", { paperId: r.paperId, actorId: me.id, round: r.round, ref: approvalId });
  } else {
    notifyLater("DECISION_RETURNED", { paperId: r.paperId, actorId: me.id, round: r.round, ref: approvalId });
  }
  return { status: 200, body: { ok: true, result: r } };
}
