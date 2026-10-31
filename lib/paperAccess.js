import "server-only";

import { canManageRevisions, releasedRound, latestRevision } from "@/lib/revisionLogic";

/**
 * Load everything a paper route needs to authorize the caller, in one place:
 * the paper, its assignments and revisions, and the caller's relationship.
 * Uses the service-role client; every decision is made here, server-side.
 *
 * Returns null when the paper doesn't exist.
 */
export async function loadPaperContext(admin, paperId, me) {
  const { data: paper, error } = await admin
    .from("papers")
    .select("id, title, abstract, keywords, school_code, status, submitted_by, current_round, created_at, updated_at")
    .eq("id", paperId)
    .maybeSingle();
  if (error) throw error;
  if (!paper) return null;

  const [{ data: assignments }, { data: revisions }, { data: decisions }] = await Promise.all([
    admin.from("paper_assignments").select("assignee, role, due_at").eq("paper_id", paperId),
    admin
      .from("paper_revisions")
      .select("id, round, revision_type, instructions, due_at, status, review_ids, responses, requested_by, requested_at, started_at, submitted_at, rereview_started_at")
      .eq("paper_id", paperId)
      .order("round", { ascending: true }),
    // Editorial decisions (0008). Includes confidential_note — routes must
    // shape this per viewer (decisionForAuthor / decisionForManager).
    admin
      .from("editorial_decisions")
      .select("id, round, decision, summary, confidential_note, review_ids, revision_due_at, revision_id, version, decided_by, created_at, updated_at, released_at, released_by")
      .eq("paper_id", paperId)
      .order("round", { ascending: true }),
  ]);

  const isOwner = paper.submitted_by === me.id;
  const isAssigned = (assignments || []).some((a) => a.assignee === me.id);
  return {
    paper,
    assignments: assignments || [],
    revisions: revisions || [],
    decisions: decisions || [],
    latest: latestRevision(revisions || []),
    released: releasedRound(revisions || []),
    isOwner,
    isAssigned,
    // The paper's own author never manages it — not even an administrator
    // (conflict of interest + double-blind: managers see reviewer identity).
    canManage: !isOwner && canManageRevisions(me, assignments || []),
  };
}
