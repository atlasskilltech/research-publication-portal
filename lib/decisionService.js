import "server-only";

import { loadPaperContext } from "@/lib/paperAccess";
import { notifyLater } from "@/lib/notifyServer";
import { mapRpcError } from "@/lib/revisionLogic";
import { decisionEligibility, canRelease } from "@/lib/decisionLogic";

/**
 * Save (create/update) the current round's unreleased decision.
 * Authorize → pre-check eligibility → save_editorial_decision() (0008, locked,
 * transactional). Returns { status, body }; body.decision = { id, version, round }.
 */
export async function saveDecision(admin, paperId, me, value) {
  const ctx = await loadPaperContext(admin, paperId, me);
  if (!ctx) return { status: 404, body: { error: "Submission not found." } };
  if (!ctx.canManage) return { status: 403, body: { error: "Only an administrator or the paper's editor can make decisions." } };

  const { data: reviews } = await admin
    .from("reviews").select("id, round, status").eq("paper_id", paperId).eq("round", ctx.paper.current_round);
  const pre = decisionEligibility({
    paper: ctx.paper, reviews, decisions: ctx.decisions, revisions: ctx.revisions,
    reviewIds: value.reviewIds, decision: value.decision,
  });
  if (!pre.ok) return { status: pre.status, body: { error: pre.error } };

  const { data, error } = await admin.rpc("save_editorial_decision", {
    p_paper: paperId, p_actor: me.id, p_decision: value.decision, p_summary: value.summary,
    p_note: value.confidentialNote, p_review_ids: value.reviewIds, p_due: value.dueAt,
  });
  if (error) {
    const mapped = mapRpcError(error);
    if (mapped) return { status: mapped.status, body: { error: mapped.error } };
    throw error;
  }
  return { status: 200, body: { ok: true, decision: data } };
}

/**
 * Communicate a saved decision to the author and apply its effect
 * (release_editorial_decision(): accept / reject / Phase 3 revision request).
 * `expectedVersion` must match the draft the caller reviewed.
 */
export async function releaseDecision(admin, paperId, me, decisionId, expectedVersion) {
  const ctx = await loadPaperContext(admin, paperId, me);
  if (!ctx) return { status: 404, body: { error: "Submission not found." } };
  if (!ctx.canManage) return { status: 403, body: { error: "Only an administrator or the paper's editor can communicate decisions." } };

  const decision = ctx.decisions.find((d) => d.id === decisionId);
  const pre = canRelease({ paper: ctx.paper, decision, expectedVersion });
  if (!pre.ok) return { status: pre.status, body: { error: pre.error } };

  const { data, error } = await admin.rpc("release_editorial_decision", {
    p_paper: paperId, p_actor: me.id, p_decision: decisionId, p_expected_version: expectedVersion,
  });
  if (error) {
    const mapped = mapRpcError(error);
    if (mapped) return { status: mapped.status, body: { error: mapped.error } };
    throw error;
  }
  // Every communicated decision (accept / reject / revision) → tell the author.
  notifyLater("DECISION_AVAILABLE", { paperId, actorId: me.id, round: decision?.round });
  return { status: 200, body: { ok: true, result: data } };
}
