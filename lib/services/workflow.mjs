/**
 * Workflow state machine on MySQL — the transactional operations for revision
 * requests, author revisions, re-review, editorial decisions, volume/issue
 * status and publication.
 *
 * Every exported operation:
 *   - runs in ONE transaction (db.transaction) and locks the rows it decides on
 *     first (SELECT … FOR UPDATE: paper → revision/decision/publication);
 *   - re-checks authorization and state and raises `RPP:<CODE>` errors, which
 *     lib/revisionLogic.mapRpcError turns into HTTP responses;
 *   - writes the paper_activity audit rows for the transition.
 * Callers (routes) authorize first via lib/paperAccess.js; the checks here are
 * the race-safe backstop. Executed end-to-end by scripts/test-mysql-integration.mjs.
 *
 * `db` is a handle from lib/db (app) or lib/db/core.mjs (scripts/tests).
 */
import { T } from "../db/tables.mjs";
import { toDate } from "../db/core.mjs";
import { uuid } from "../auth/crypto.mjs";
import { jrow, logActivity } from "../repos/rows.mjs";

const fail = (code) => new Error(`RPP:${code}`);
const OPEN_REVISION = ["REVISION_REQUESTED", "REVISION_IN_PROGRESS", "REVISION_SUBMITTED"];
const REVIEWER_ROLES = ["PEER_REVIEWER", "DESK_REVIEWER"];
const uniq = (a) => [...new Set((a || []).filter(Boolean))];
const iso = (v) => (v ? new Date(v).toISOString() : null);

async function lockPaper(tx, paperId) {
  return jrow(await tx.one(`SELECT * FROM \`${T.papers}\` WHERE id = ? FOR UPDATE`, [paperId]));
}

/** _rpp_is_manager: administrator, or the paper's assigned EDITOR. */
async function isManager(tx, paperId, actorId) {
  const a = await tx.one(`SELECT isAdmin FROM \`${T.users}\` WHERE id = ?`, [actorId]);
  if (a?.isAdmin) return true;
  return !!(await tx.one(
    `SELECT 1 AS x FROM \`${T.paperAssignments}\` WHERE paper_id = ? AND assignee = ? AND role = 'EDITOR' LIMIT 1`,
    [paperId, actorId],
  ));
}
async function isAdmin(tx, actorId) {
  return !!(await tx.one(`SELECT isAdmin FROM \`${T.users}\` WHERE id = ?`, [actorId]))?.isAdmin;
}
async function hasOpenRevision(tx, paperId) {
  return !!(await tx.one(`SELECT 1 AS x FROM \`${T.paperRevisions}\` WHERE paper_id = ? AND status IN (?) LIMIT 1`, [paperId, OPEN_REVISION]));
}

// ---- Phase 3: revisions -------------------------------------------------------------

/** request_paper_revision — inside an existing transaction. Returns the revision id. */
async function requestRevisionTx(tx, { paperId, actorId, type, instructions, dueAt, reviewIds, viaApproval = false }) {
  const paper = await lockPaper(tx, paperId);
  if (!paper) throw fail("NOT_FOUND");
  // viaApproval: the Program Chair / admin approver was authorized by approveDecision.
  if (!viaApproval && !(await isManager(tx, paperId, actorId))) throw fail("FORBIDDEN");
  if (paper.status !== "UNDER_REVIEW") throw fail("NOT_UNDER_REVIEW");
  if (!["MINOR", "MAJOR"].includes(type)) throw fail("BAD_TYPE");
  if (await hasOpenRevision(tx, paperId)) throw fail("OPEN_REVISION");
  const ids = uniq(reviewIds);
  if (ids.length === 0) throw fail("NO_REVIEWS");
  const valid = Number((await tx.one(
    `SELECT COUNT(*) AS n FROM \`${T.reviews}\` WHERE id IN (?) AND paper_id = ? AND round = ? AND status = 'SUBMITTED'`,
    [ids, paperId, paper.current_round],
  )).n);
  if (valid !== ids.length) throw fail("BAD_REVIEWS");

  const id = uuid();
  const round = paper.current_round + 1;
  await tx.exec(
    `INSERT INTO \`${T.paperRevisions}\` (id, paper_id, round, revision_type, instructions, due_at, status, review_ids, responses, requested_by, requested_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'REVISION_REQUESTED', ?, '[]', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [id, paperId, round, type, String(instructions ?? ""), toDate(dueAt), JSON.stringify(ids), actorId],
  );
  await tx.exec(`UPDATE \`${T.papers}\` SET status = 'REVISION' WHERE id = ?`, [paperId]);
  await logActivity(tx, paperId, actorId, "REVISION_REQUESTED", { round, type, dueAt: iso(dueAt) });
  return id;
}

export function requestPaperRevision(db, args) {
  return db.transaction((tx) => requestRevisionTx(tx, args));
}

/** _rpp_lock_editable: the open revision of an OWN paper that is not yet submitted. */
async function lockEditable(tx, paperId, round, actorId) {
  const rev = jrow(await tx.one(`SELECT * FROM \`${T.paperRevisions}\` WHERE paper_id = ? AND round = ? FOR UPDATE`, [paperId, round]));
  if (!rev) throw fail("NOT_FOUND");
  const own = await tx.one(`SELECT 1 AS x FROM \`${T.papers}\` WHERE id = ? AND submitted_by = ?`, [paperId, actorId]);
  if (!own) throw fail("FORBIDDEN");
  if (rev.status === "REVISION_SUBMITTED" || rev.status === "REVISION_UNDER_REVIEW") throw fail("ALREADY_SUBMITTED");
  return rev;
}

async function markStarted(tx, rev, actorId) {
  if (rev.status === "REVISION_REQUESTED") {
    await tx.exec(`UPDATE \`${T.paperRevisions}\` SET status = 'REVISION_IN_PROGRESS', started_at = UTC_TIMESTAMP(3) WHERE id = ?`, [rev.id]);
    await logActivity(tx, rev.paper_id, actorId, "REVISION_STARTED", { round: rev.round });
  }
}

/** attach_revision_manuscript → the replaced storage key (or null). */
export function attachRevisionManuscript(db, { paperId, round, actorId, key, filename, mime, size, sha }) {
  return db.transaction(async (tx) => {
    const rev = await lockEditable(tx, paperId, round, actorId);
    const old = await tx.one(`SELECT storage_key FROM \`${T.paperManuscripts}\` WHERE paper_id = ? AND version = ? FOR UPDATE`, [paperId, round]);
    if (old) {
      await tx.exec(
        `UPDATE \`${T.paperManuscripts}\` SET storage_key = ?, original_filename = ?, mime_type = ?, byte_size = ?, sha256 = ?, uploaded_by = ?, created_at = UTC_TIMESTAMP(3)
          WHERE paper_id = ? AND version = ?`,
        [key, filename, mime, size, sha, actorId, paperId, round],
      );
    } else {
      await tx.exec(
        `INSERT INTO \`${T.paperManuscripts}\` (id, paper_id, version, storage_key, original_filename, mime_type, byte_size, sha256, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [uuid(), paperId, round, key, filename, mime, size, sha, actorId],
      );
    }
    await markStarted(tx, rev, actorId);
    await logActivity(tx, paperId, actorId, "REVISION_MANUSCRIPT_UPLOADED", { round, bytes: size, replaced: !!old });
    return old ? old.storage_key : null;
  });
}

/** save_revision_draft */
export function saveRevisionDraft(db, { paperId, round, actorId, responses }) {
  return db.transaction(async (tx) => {
    const rev = await lockEditable(tx, paperId, round, actorId);
    const list = Array.isArray(responses) ? responses : [];
    await tx.exec(`UPDATE \`${T.paperRevisions}\` SET responses = ? WHERE id = ?`, [JSON.stringify(list), rev.id]);
    await markStarted(tx, rev, actorId);
    await logActivity(tx, paperId, actorId, "REVISION_RESPONSE_SAVED", { round, entries: list.length });
  });
}

/** submit_paper_revision */
export function submitPaperRevision(db, { paperId, round, actorId, responses }) {
  return db.transaction(async (tx) => {
    const rev = await lockEditable(tx, paperId, round, actorId);
    const ms = await tx.one(`SELECT 1 AS x FROM \`${T.paperManuscripts}\` WHERE paper_id = ? AND version = ?`, [paperId, round]);
    if (!ms) throw fail("NO_MANUSCRIPT");
    const list = Array.isArray(responses) ? responses : [];
    if (list.length === 0) throw fail("NO_RESPONSES");
    await tx.exec(
      `UPDATE \`${T.paperRevisions}\` SET status = 'REVISION_SUBMITTED', responses = ?, started_at = COALESCE(started_at, UTC_TIMESTAMP(3)),
              submitted_at = UTC_TIMESTAMP(3), submitted_by = ? WHERE id = ?`,
      [JSON.stringify(list), actorId, rev.id],
    );
    await tx.exec(`UPDATE \`${T.papers}\` SET current_round = ? WHERE id = ?`, [round, paperId]);
    await logActivity(tx, paperId, actorId, "REVISION_SUBMITTED", { round });
  });
}

/** start_revision_rereview */
export function startRevisionRereview(db, { paperId, round, actorId, dueAt }) {
  return db.transaction(async (tx) => {
    const rev = jrow(await tx.one(`SELECT * FROM \`${T.paperRevisions}\` WHERE paper_id = ? AND round = ? FOR UPDATE`, [paperId, round]));
    if (!rev) throw fail("NOT_FOUND");
    if (!(await isManager(tx, paperId, actorId))) throw fail("FORBIDDEN");
    if (rev.status !== "REVISION_SUBMITTED") throw fail("NOT_SUBMITTED");
    const reviewers = await tx.one(`SELECT 1 AS x FROM \`${T.paperAssignments}\` WHERE paper_id = ? AND role IN (?) LIMIT 1`, [paperId, REVIEWER_ROLES]);
    if (!reviewers) throw fail("NO_REVIEWERS");
    await tx.exec(`UPDATE \`${T.paperRevisions}\` SET status = 'REVISION_UNDER_REVIEW', rereview_started_at = UTC_TIMESTAMP(3) WHERE id = ?`, [rev.id]);
    await tx.exec(`UPDATE \`${T.papers}\` SET status = 'UNDER_REVIEW' WHERE id = ?`, [paperId]);
    if (dueAt) {
      await tx.exec(`UPDATE \`${T.paperAssignments}\` SET due_at = ? WHERE paper_id = ? AND role IN (?)`, [toDate(dueAt), paperId, REVIEWER_ROLES]);
    }
    await logActivity(tx, paperId, actorId, "REREVIEW_ASSIGNED", { round, dueAt: iso(dueAt) });
  });
}

// ---- Phase 4: editorial decisions ------------------------------------------------------

const DECISIONS = ["ACCEPT", "MINOR_REVISION", "MAJOR_REVISION", "REJECT"];
const isRevisionDecision = (d) => d === "MINOR_REVISION" || d === "MAJOR_REVISION";
const nullIfBlank = (s) => {
  const t = String(s ?? "").trim();
  return t ? t : null;
};

/** save_editorial_decision → { id, version, round } */
export function saveEditorialDecision(db, { paperId, actorId, decision, summary, note, reviewIds, dueAt }) {
  return db.transaction(async (tx) => {
    const paper = await lockPaper(tx, paperId);
    if (!paper) throw fail("NOT_FOUND");
    if (!(await isManager(tx, paperId, actorId))) throw fail("FORBIDDEN");
    if (paper.status !== "UNDER_REVIEW") throw fail("NOT_UNDER_REVIEW");
    if (!DECISIONS.includes(decision)) throw fail("BAD_DECISION");
    const text = String(summary ?? "").trim();
    if (!text) throw fail("NO_SUMMARY");
    if (await hasOpenRevision(tx, paperId)) throw fail("OPEN_REVISION");
    const anySubmitted = await tx.one(
      `SELECT 1 AS x FROM \`${T.reviews}\` WHERE paper_id = ? AND round = ? AND status = 'SUBMITTED' LIMIT 1`, [paperId, paper.current_round]);
    if (!anySubmitted) throw fail("NO_SUBMITTED_REVIEWS");
    const ids = uniq(reviewIds);
    if (isRevisionDecision(decision) && ids.length === 0) throw fail("NO_REVIEWS");
    if (ids.length > 0) {
      const valid = Number((await tx.one(
        `SELECT COUNT(*) AS n FROM \`${T.reviews}\` WHERE id IN (?) AND paper_id = ? AND round = ? AND status = 'SUBMITTED'`,
        [ids, paperId, paper.current_round],
      )).n);
      if (valid !== ids.length) throw fail("BAD_REVIEWS");
    }
    const due = isRevisionDecision(decision) ? toDate(dueAt) : null;
    const existing = await tx.one(
      `SELECT id, round, version, released_at FROM \`${T.editorialDecisions}\` WHERE paper_id = ? AND round = ? FOR UPDATE`, [paperId, paper.current_round]);
    if (existing) {
      if (existing.released_at) throw fail("DECISION_EXISTS");
      // Locked while the Program Chair is reviewing it (approve or send back first).
      if (await pendingApprovalFor(tx, existing.id)) throw fail("APPROVAL_PENDING");
      // Guarded by released_at IS NULL: a communicated decision is immutable.
      const r = await tx.exec(
        `UPDATE \`${T.editorialDecisions}\` SET decision = ?, summary = ?, confidential_note = ?, review_ids = ?, revision_due_at = ?,
                decided_by = ?, version = version + 1 WHERE id = ? AND released_at IS NULL`,
        [decision, text, nullIfBlank(note), JSON.stringify(ids), due, actorId, existing.id],
      );
      if (r.affectedRows !== 1) throw fail("DECISION_FINAL");
      const version = existing.version + 1;
      await logActivity(tx, paperId, actorId, "DECISION_UPDATED", { round: existing.round, decision, version });
      return { id: existing.id, version, round: existing.round };
    }
    const id = uuid();
    await tx.exec(
      `INSERT INTO \`${T.editorialDecisions}\` (id, paper_id, round, decision, summary, confidential_note, review_ids, revision_due_at, version, decided_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, paperId, paper.current_round, decision, text, nullIfBlank(note), JSON.stringify(ids), due, actorId],
    );
    await logActivity(tx, paperId, actorId, "DECISION_CREATED", { round: paper.current_round, decision });
    return { id, version: 1, round: paper.current_round };
  });
}

/**
 * Apply a decision's effect and mark it communicated — inside an existing
 * transaction, with the paper and decision rows already locked and checked.
 *   ACCEPT → ACCEPTED, REJECT → REJECTED, MINOR/MAJOR → revision request.
 */
async function applyReleaseTx(tx, { paperId, actorId, dec }) {
  let revisionId = null;
  if (dec.decision === "ACCEPT") {
    await tx.exec(`UPDATE \`${T.papers}\` SET status = 'ACCEPTED' WHERE id = ?`, [paperId]);
    await logActivity(tx, paperId, actorId, "PAPER_ACCEPTED", { round: dec.round });
  } else if (dec.decision === "REJECT") {
    await tx.exec(`UPDATE \`${T.papers}\` SET status = 'REJECTED' WHERE id = ?`, [paperId]);
    await logActivity(tx, paperId, actorId, "PAPER_REJECTED", { round: dec.round });
  } else {
    revisionId = await requestRevisionTx(tx, {
      paperId, actorId: dec.decided_by || actorId, type: dec.decision === "MINOR_REVISION" ? "MINOR" : "MAJOR",
      instructions: dec.summary, dueAt: dec.revision_due_at, reviewIds: dec.review_ids, viaApproval: true,
    });
  }
  const r = await tx.exec(
    `UPDATE \`${T.editorialDecisions}\` SET released_at = UTC_TIMESTAMP(3), released_by = ?, revision_id = ? WHERE id = ? AND released_at IS NULL`,
    [actorId, revisionId, dec.id],
  );
  if (r.affectedRows !== 1) throw fail("DECISION_EXISTS");
  await logActivity(tx, paperId, actorId, "DECISION_COMMUNICATED", { round: dec.round, decision: dec.decision });
  return { id: dec.id, decision: dec.decision, revisionId };
}

/** Lock + validate the decision a manager wants to communicate / send for approval. */
async function lockDecisionForRelease(tx, { paperId, actorId, decisionId, expectedVersion }) {
  const paper = await lockPaper(tx, paperId);
  if (!paper) throw fail("NOT_FOUND");
  if (!(await isManager(tx, paperId, actorId))) throw fail("FORBIDDEN");
  const dec = jrow(await tx.one(`SELECT * FROM \`${T.editorialDecisions}\` WHERE id = ? AND paper_id = ? FOR UPDATE`, [decisionId, paperId]));
  if (!dec) throw fail("NOT_FOUND");
  if (dec.released_at) throw fail("DECISION_EXISTS");
  if (dec.version !== Number(expectedVersion)) throw fail("STALE");
  if (paper.status !== "UNDER_REVIEW" || dec.round !== paper.current_round) throw fail("NOT_UNDER_REVIEW");
  if (await pendingApprovalFor(tx, dec.id)) throw fail("APPROVAL_PENDING");
  return { paper, dec };
}

/**
 * release_editorial_decision → { id, decision, revisionId }
 * Only REJECT is communicated directly by the editor. ACCEPT and MINOR/MAJOR
 * revision decisions need the Program Chair's approval first
 * (requestDecisionApproval → approveDecision), so they are refused here.
 */
export function releaseEditorialDecision(db, { paperId, actorId, decisionId, expectedVersion }) {
  return db.transaction(async (tx) => {
    const { dec } = await lockDecisionForRelease(tx, { paperId, actorId, decisionId, expectedVersion });
    if (NEEDS_APPROVAL.includes(dec.decision)) throw fail("NEEDS_APPROVAL");
    return applyReleaseTx(tx, { paperId, actorId, dec });
  });
}

// ---- Program Chair final approval (005) ------------------------------------------------

/** Decisions that must be approved by the Program Chair before reaching the author. */
export const NEEDS_APPROVAL = Object.freeze(["ACCEPT", "MINOR_REVISION", "MAJOR_REVISION"]);
const COMMENT_MAX = 10000;

async function pendingApprovalFor(tx, decisionId) {
  return tx.one(
    `SELECT id FROM \`${T.decisionApprovals}\` WHERE decision_id = ? AND status = 'PENDING' LIMIT 1 FOR UPDATE`, [decisionId]);
}

/**
 * May this account act as final approver? An ACTIVE administrator (backup), or
 * an ACTIVE holder of the PROGRAM_CHAIR role whose email is on the allowlist
 * (re-checked on every use, so removing an email withdraws the power at once).
 */
export async function isApprover(q, actorId, chairEmails = []) {
  const u = await q.one(`SELECT email, isAdmin, status, baseType FROM \`${T.users}\` WHERE id = ?`, [actorId]);
  if (!u || u.status !== "ACTIVE" || u.baseType === "AUTHOR") return false;
  if (u.isAdmin) return true;
  const allowed = (chairEmails || []).map((e) => String(e).trim().toLowerCase());
  if (!allowed.includes(String(u.email || "").trim().toLowerCase())) return false;
  return !!(await q.one(`SELECT 1 AS x FROM \`${T.userRoles}\` WHERE user_id = ? AND role = 'PROGRAM_CHAIR'`, [actorId]));
}

/**
 * Editor sends a saved ACCEPT / MINOR / MAJOR decision to the Program Chair.
 * The decision is then locked (no edits) until approved or sent back.
 * → { approvalId, decision, round }
 */
export function requestDecisionApproval(db, { paperId, actorId, decisionId, expectedVersion }) {
  return db.transaction(async (tx) => {
    const { dec } = await lockDecisionForRelease(tx, { paperId, actorId, decisionId, expectedVersion });
    if (!NEEDS_APPROVAL.includes(dec.decision)) throw fail("NO_APPROVAL_NEEDED");
    const id = uuid();
    await tx.exec(
      `INSERT INTO \`${T.decisionApprovals}\` (id, paper_id, decision_id, round, decision, decision_version, status, requested_by, requested_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, paperId, dec.id, dec.round, dec.decision, dec.version, actorId],
    );
    await logActivity(tx, paperId, actorId, "APPROVAL_REQUESTED", { round: dec.round, decision: dec.decision });
    return { approvalId: id, decision: dec.decision, round: dec.round };
  });
}

/** Lock a PENDING approval (paper → approval → decision) and authorize the approver. */
async function lockPendingApproval(tx, { approvalId, actorId, chairEmails }) {
  const head = await tx.one(`SELECT paper_id FROM \`${T.decisionApprovals}\` WHERE id = ?`, [approvalId]);
  if (!head) throw fail("NOT_FOUND");
  const paper = await lockPaper(tx, head.paper_id);
  if (!paper) throw fail("NOT_FOUND");
  if (!(await isApprover(tx, actorId, chairEmails))) throw fail("FORBIDDEN");
  // Conflict of interest: nobody approves a decision on their own paper.
  if (paper.submitted_by && paper.submitted_by === actorId) throw fail("FORBIDDEN");
  const ap = await tx.one(`SELECT * FROM \`${T.decisionApprovals}\` WHERE id = ? FOR UPDATE`, [approvalId]);
  if (!ap || ap.status !== "PENDING") throw fail("APPROVAL_DONE");
  const dec = jrow(await tx.one(`SELECT * FROM \`${T.editorialDecisions}\` WHERE id = ? AND paper_id = ? FOR UPDATE`, [ap.decision_id, paper.id]));
  if (!dec) throw fail("NOT_FOUND");
  return { paper, ap, dec };
}

/**
 * Program Chair (or an administrator) approves: the decision is communicated
 * to the author exactly as the editor wrote it (the approver cannot change it).
 * → { paperId, decision, round, revisionId }
 */
export function approveDecision(db, { approvalId, actorId, chairEmails, comment }) {
  return db.transaction(async (tx) => {
    const { paper, ap, dec } = await lockPendingApproval(tx, { approvalId, actorId, chairEmails });
    const note = nullIfBlank(comment);
    if (note && note.length > COMMENT_MAX) throw fail("COMMENT_TOO_LONG");
    if (dec.released_at) throw fail("DECISION_EXISTS");
    if (dec.version !== ap.decision_version || dec.decision !== ap.decision) throw fail("STALE");
    if (paper.status !== "UNDER_REVIEW" || dec.round !== paper.current_round) throw fail("NOT_UNDER_REVIEW");
    const r = await tx.exec(
      `UPDATE \`${T.decisionApprovals}\` SET status = 'APPROVED', acted_by = ?, acted_at = UTC_TIMESTAMP(3), comment = ? WHERE id = ? AND status = 'PENDING'`,
      [actorId, note, ap.id],
    );
    if (r.affectedRows !== 1) throw fail("APPROVAL_DONE");
    await logActivity(tx, paper.id, actorId, "DECISION_APPROVED", { round: dec.round, decision: dec.decision });
    const out = await applyReleaseTx(tx, { paperId: paper.id, actorId, dec });
    return { paperId: paper.id, decision: dec.decision, round: dec.round, revisionId: out.revisionId };
  });
}

/**
 * Program Chair (or an administrator) sends the decision back to the editor
 * with a required comment. Nothing reaches the author; the editor can revise
 * the draft and send it again. → { paperId, decision, round }
 */
export function returnDecision(db, { approvalId, actorId, chairEmails, comment }) {
  return db.transaction(async (tx) => {
    const { paper, ap, dec } = await lockPendingApproval(tx, { approvalId, actorId, chairEmails });
    const note = nullIfBlank(comment);
    if (!note) throw fail("NO_COMMENT");
    if (note.length > COMMENT_MAX) throw fail("COMMENT_TOO_LONG");
    const r = await tx.exec(
      `UPDATE \`${T.decisionApprovals}\` SET status = 'RETURNED', acted_by = ?, acted_at = UTC_TIMESTAMP(3), comment = ? WHERE id = ? AND status = 'PENDING'`,
      [actorId, note, ap.id],
    );
    if (r.affectedRows !== 1) throw fail("APPROVAL_DONE");
    await logActivity(tx, paper.id, actorId, "DECISION_RETURNED", { round: dec.round, decision: dec.decision });
    return { paperId: paper.id, decision: dec.decision, round: dec.round };
  });
}

// ---- Phase 5: volumes, issues, publications --------------------------------------------

const VI_STATUS = ["DRAFT", "SCHEDULED", "PUBLISHED"];

/** set_volume_status (admin only; PUBLISHED is final). */
export function setVolumeStatus(db, { volumeId, actorId, status }) {
  return db.transaction(async (tx) => {
    if (!(await isAdmin(tx, actorId))) throw fail("FORBIDDEN");
    const v = await tx.one(`SELECT id, status FROM \`${T.volumes}\` WHERE id = ? FOR UPDATE`, [volumeId]);
    if (!v) throw fail("NOT_FOUND");
    if (!VI_STATUS.includes(status)) throw fail("BAD_STATUS");
    if (v.status === "PUBLISHED") throw fail("ALREADY_PUBLISHED");
    if (v.status === status) return;
    await tx.exec(
      `UPDATE \`${T.volumes}\` SET status = ?, published_at = ${status === "PUBLISHED" ? "UTC_TIMESTAMP(3)" : "NULL"} WHERE id = ?`,
      [status, volumeId],
    );
  });
}

/** set_issue_status → number of papers published along with the issue. */
export function setIssueStatus(db, { issueId, actorId, status, publishPapers }) {
  return db.transaction(async (tx) => {
    if (!(await isAdmin(tx, actorId))) throw fail("FORBIDDEN");
    let issue = await tx.one(`SELECT * FROM \`${T.issues}\` WHERE id = ? FOR UPDATE`, [issueId]);
    if (!issue) throw fail("NOT_FOUND");
    if (!VI_STATUS.includes(status)) throw fail("BAD_STATUS");
    if (issue.status === "PUBLISHED" && status !== "PUBLISHED") throw fail("ALREADY_PUBLISHED");
    let count = 0;
    if (status === "PUBLISHED") {
      const vol = await tx.one(`SELECT status FROM \`${T.volumes}\` WHERE id = ? FOR UPDATE`, [issue.volume_id]);
      if (vol?.status !== "PUBLISHED") throw fail("VOLUME_NOT_PUBLISHED");
      if (issue.status !== "PUBLISHED") {
        await tx.exec(
          `UPDATE \`${T.issues}\` SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(3), publication_date = COALESCE(publication_date, UTC_DATE()) WHERE id = ?`,
          [issueId],
        );
        issue = await tx.one(`SELECT * FROM \`${T.issues}\` WHERE id = ?`, [issueId]);
      }
      if (publishPapers) {
        const rows = await tx.query(
          `SELECT pb.id, pb.paper_id FROM \`${T.publications}\` pb JOIN \`${T.papers}\` p ON p.id = pb.paper_id
            WHERE pb.issue_id = ? AND pb.status = 'SCHEDULED' AND p.status = 'ACCEPTED' FOR UPDATE`,
          [issueId],
        );
        for (const r of rows) {
          await tx.exec(
            `UPDATE \`${T.publications}\` SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(3), published_by = ?,
                    publication_date = COALESCE(publication_date, ?), version = version + 1 WHERE id = ?`,
            [actorId, issue.publication_date, r.id],
          );
          await tx.exec(`UPDATE \`${T.papers}\` SET status = 'PUBLISHED' WHERE id = ?`, [r.paper_id]);
          await logActivity(tx, r.paper_id, actorId, "PAPER_PUBLISHED", { issueId, viaIssue: true });
          count++;
        }
      }
    } else if (issue.status !== status) {
      await tx.exec(`UPDATE \`${T.issues}\` SET status = ? WHERE id = ?`, [status, issueId]);
    }
    return count;
  });
}

async function checkIssueAndManuscript(tx, { paperId, volumeId, issueId, manuscriptId }) {
  const issue = await tx.one(`SELECT volume_id FROM \`${T.issues}\` WHERE id = ?`, [issueId]);
  if (!issue) throw fail("ISSUE_NOT_FOUND");
  if (issue.volume_id !== volumeId) throw fail("ISSUE_VOLUME_MISMATCH");
  if (manuscriptId) {
    const m = await tx.one(`SELECT 1 AS x FROM \`${T.paperManuscripts}\` WHERE id = ? AND paper_id = ?`, [manuscriptId, paperId]);
    if (!m) throw fail("BAD_MANUSCRIPT");
  }
}

function pubValues(v) {
  return [
    v.volumeId, v.issueId, v.title, String(v.abstract ?? ""), JSON.stringify(v.authors ?? []), JSON.stringify(v.keywords ?? []),
    v.pageStart ?? null, v.pageEnd ?? null, nullIfBlank(v.doi), v.publicationDate || null, v.manuscriptId || null, v.manuscriptPublic ? 1 : 0,
  ];
}

/** schedule_publication → publication id */
export function schedulePublication(db, { paperId, actorId, ...v }) {
  return db.transaction(async (tx) => {
    const paper = await lockPaper(tx, paperId);
    if (!paper) throw fail("NOT_FOUND");
    if (!(await isManager(tx, paperId, actorId))) throw fail("FORBIDDEN");
    if (paper.status === "REJECTED") throw fail("PAPER_REJECTED");
    if (paper.status === "REVISION") throw fail("REVISION_PENDING");
    if (paper.status !== "ACCEPTED") throw fail("NOT_ACCEPTED");
    const accepted = await tx.one(
      `SELECT 1 AS x FROM \`${T.editorialDecisions}\` WHERE paper_id = ? AND decision = 'ACCEPT' AND released_at IS NOT NULL LIMIT 1`, [paperId]);
    if (!accepted) throw fail("NOT_ACCEPTED");
    if (await tx.one(`SELECT 1 AS x FROM \`${T.publications}\` WHERE paper_id = ? FOR UPDATE`, [paperId])) throw fail("ALREADY_SCHEDULED");
    await checkIssueAndManuscript(tx, { paperId, volumeId: v.volumeId, issueId: v.issueId, manuscriptId: v.manuscriptId });
    const id = uuid();
    await tx.exec(
      `INSERT INTO \`${T.publications}\` (id, paper_id, volume_id, issue_id, title, abstract, authors, keywords, page_start, page_end, doi,
              publication_date, manuscript_id, manuscript_public, status, version, scheduled_by, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', 1, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, paperId, ...pubValues(v), actorId],
    );
    await logActivity(tx, paperId, actorId, "PUBLICATION_SCHEDULED", { issueId: v.issueId, volumeId: v.volumeId });
    return id;
  });
}

/** update_publication → new version */
export function updatePublication(db, { pubId, actorId, expectedVersion, ...v }) {
  return db.transaction(async (tx) => {
    const pub = await tx.one(`SELECT id, paper_id, status, version FROM \`${T.publications}\` WHERE id = ? FOR UPDATE`, [pubId]);
    if (!pub) throw fail("NOT_FOUND");
    if (!(await isManager(tx, pub.paper_id, actorId))) throw fail("FORBIDDEN");
    if (pub.status === "PUBLISHED") throw fail("ALREADY_PUBLISHED");
    if (pub.version !== Number(expectedVersion)) throw fail("STALE");
    await checkIssueAndManuscript(tx, { paperId: pub.paper_id, volumeId: v.volumeId, issueId: v.issueId, manuscriptId: v.manuscriptId });
    await tx.exec(
      `UPDATE \`${T.publications}\` SET volume_id = ?, issue_id = ?, title = ?, abstract = ?, authors = ?, keywords = ?, page_start = ?, page_end = ?,
              doi = ?, publication_date = ?, manuscript_id = ?, manuscript_public = ?, version = version + 1 WHERE id = ?`,
      [...pubValues(v), pubId],
    );
    const version = pub.version + 1;
    await logActivity(tx, pub.paper_id, actorId, "PUBLICATION_UPDATED", { version });
    return version;
  });
}

/** publish_paper */
export function publishPaper(db, { pubId, actorId, expectedVersion }) {
  return db.transaction(async (tx) => {
    const pub = await tx.one(`SELECT id, paper_id, issue_id, status, version FROM \`${T.publications}\` WHERE id = ? FOR UPDATE`, [pubId]);
    if (!pub) throw fail("NOT_FOUND");
    if (!(await isManager(tx, pub.paper_id, actorId))) throw fail("FORBIDDEN");
    if (pub.status === "PUBLISHED") throw fail("ALREADY_PUBLISHED");
    if (pub.version !== Number(expectedVersion)) throw fail("STALE");
    const paper = await lockPaper(tx, pub.paper_id);
    if (paper.status === "REJECTED") throw fail("PAPER_REJECTED");
    if (paper.status === "REVISION") throw fail("REVISION_PENDING");
    if (paper.status !== "ACCEPTED") throw fail("NOT_ACCEPTED");
    const issue = await tx.one(`SELECT status, publication_date FROM \`${T.issues}\` WHERE id = ?`, [pub.issue_id]);
    if (issue?.status !== "PUBLISHED") throw fail("ISSUE_NOT_PUBLISHED");
    await tx.exec(
      `UPDATE \`${T.publications}\` SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP(3), published_by = ?,
              publication_date = COALESCE(publication_date, ?, UTC_DATE()), version = version + 1 WHERE id = ?`,
      [actorId, issue.publication_date, pubId],
    );
    await tx.exec(`UPDATE \`${T.papers}\` SET status = 'PUBLISHED' WHERE id = ?`, [pub.paper_id]);
    await logActivity(tx, pub.paper_id, actorId, "PAPER_PUBLISHED", { issueId: pub.issue_id });
  });
}

