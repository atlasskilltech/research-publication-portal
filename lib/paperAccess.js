import "server-only";

import { T } from "@/lib/db";
import { jrow, jrows } from "@/lib/repos/rows.mjs";
import { canManageRevisions, releasedRound, latestRevision } from "@/lib/revisionLogic";

/**
 * Load everything a paper route needs to authorize the caller, in one place:
 * the paper, its assignments and revisions, and the caller's relationship.
 * `q` is the MySQL handle (db or a transaction); every decision is made here,
 * server-side.
 *
 * Returns null when the paper doesn't exist.
 */
export async function loadPaperContext(q, paperId, me) {
  const paper = jrow(await q.one(
    `SELECT id, title, abstract, keywords, school_code, status, submitted_by, current_round, created_at, updated_at
       FROM \`${T.papers}\` WHERE id = ?`,
    [paperId],
  ));
  if (!paper) return null;

  const [assignments, revisions, decisions] = await Promise.all([
    q.query(`SELECT assignee, role, due_at FROM \`${T.paperAssignments}\` WHERE paper_id = ?`, [paperId]),
    q.query(
      `SELECT id, round, revision_type, instructions, due_at, status, review_ids, responses, requested_by, requested_at,
              started_at, submitted_at, rereview_started_at
         FROM \`${T.paperRevisions}\` WHERE paper_id = ? ORDER BY round ASC`,
      [paperId],
    ).then(jrows),
    // Editorial decisions. Includes confidential_note — routes must shape this
    // per viewer (decisionForAuthor / decisionForManager).
    q.query(
      `SELECT id, round, decision, summary, confidential_note, review_ids, revision_due_at, revision_id, version, decided_by,
              created_at, updated_at, released_at, released_by
         FROM \`${T.editorialDecisions}\` WHERE paper_id = ? ORDER BY round ASC`,
      [paperId],
    ).then(jrows),
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
