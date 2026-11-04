import "server-only";

import { db, T } from "@/lib/db";
import { loadPaperContext } from "@/lib/paperAccess";
import { notifyLater } from "@/lib/notifyServer";
import { mapRpcError } from "@/lib/revisionLogic";
import { decisionEligibility, canRelease } from "@/lib/decisionLogic";
import { saveEditorialDecision, releaseEditorialDecision } from "@/lib/services/workflow.mjs";

/** Turn a workflow RPP:<CODE> error into { status, body }; rethrow anything else. */
function mapped(e) {
  const m = mapRpcError(e);
  if (m) return { status: m.status, body: { error: m.error } };
  throw e;
}

/**
 * Save (create/update) the current round's unreleased decision.
 * Authorize → pre-check eligibility → saveEditorialDecision (one transaction,
 * paper row locked). Returns { status, body }; body.decision = { id, version, round }.
 */
export async function saveDecision(paperId, me, value) {
  const ctx = await loadPaperContext(db, paperId, me);
  if (!ctx) return { status: 404, body: { error: "Submission not found." } };
  if (!ctx.canManage) return { status: 403, body: { error: "Only an administrator or the paper's editor can make decisions." } };

  const reviews = await db.query(
    `SELECT id, round, status FROM \`${T.reviews}\` WHERE paper_id = ? AND round = ?`, [paperId, ctx.paper.current_round]);
  const pre = decisionEligibility({
    paper: ctx.paper, reviews, decisions: ctx.decisions, revisions: ctx.revisions,
    reviewIds: value.reviewIds, decision: value.decision,
  });
  if (!pre.ok) return { status: pre.status, body: { error: pre.error } };

  try {
    const decision = await saveEditorialDecision(db, {
      paperId, actorId: me.id, decision: value.decision, summary: value.summary,
      note: value.confidentialNote, reviewIds: value.reviewIds, dueAt: value.dueAt,
    });
    return { status: 200, body: { ok: true, decision } };
  } catch (e) {
    return mapped(e);
  }
}

/**
 * Communicate a saved decision to the author and apply its effect
 * (accept / reject / revision request — all in one transaction).
 * `expectedVersion` must match the draft the caller reviewed.
 */
export async function releaseDecision(paperId, me, decisionId, expectedVersion) {
  const ctx = await loadPaperContext(db, paperId, me);
  if (!ctx) return { status: 404, body: { error: "Submission not found." } };
  if (!ctx.canManage) return { status: 403, body: { error: "Only an administrator or the paper's editor can communicate decisions." } };

  const decision = ctx.decisions.find((d) => d.id === decisionId);
  const pre = canRelease({ paper: ctx.paper, decision, expectedVersion });
  if (!pre.ok) return { status: pre.status, body: { error: pre.error } };

  let result;
  try {
    result = await releaseEditorialDecision(db, { paperId, actorId: me.id, decisionId, expectedVersion });
  } catch (e) {
    return mapped(e);
  }
  // Every communicated decision (accept / reject / revision) → tell the author.
  notifyLater("DECISION_AVAILABLE", { paperId, actorId: me.id, round: decision?.round });
  return { status: 200, body: { ok: true, result } };
}
