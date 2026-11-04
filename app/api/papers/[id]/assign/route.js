// Admin-only: assign the next responsible person to a submission. Reuses the
// EXISTING account role vocabulary — the assignee must already hold that role
// in the user_roles table (no parallel role system). Records the assignment and
// an audit entry; moves a freshly-submitted paper to UNDER_REVIEW on its first
// REVIEWER assignment (SPOC/EDITOR assignments don't start review).
// Blocks conflicts of interest (submitter or a listed author).
//
// DELETE removes an assignment, unless that reviewer already submitted a review.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T, toDate } from "@/lib/db";
import { logActivity } from "@/lib/repos/rows.mjs";
import { findUserById } from "@/lib/repos/users.mjs";
import { uuid } from "@/lib/auth/crypto.mjs";
import { notifyLater } from "@/lib/notifyServer";
import { assignmentConflict, assignmentBlock, statusAfterAssignment, REVIEWER_ROLES } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSIGNABLE = ["SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"];

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;

  let assignee, role, dueAt = null;
  try {
    const body = await request.json();
    assignee = String(body?.assignee || "");
    role = String(body?.role || "").toUpperCase();
    if (body?.dueAt) {
      const d = new Date(body.dueAt);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Invalid deadline." }, { status: 422 });
      dueAt = d.toISOString();
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!ASSIGNABLE.includes(role)) {
    return NextResponse.json({ error: "Choose a valid role (SPOC, Desk Reviewer, Peer Reviewer, Editor)." }, { status: 422 });
  }

  try {
    const paper = await db.one(`SELECT id, status, submitted_by FROM \`${T.papers}\` WHERE id = ?`, [id]);
    if (!paper) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    const blocked = assignmentBlock(paper, me.id, role);
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

    const profile = assignee ? await findUserById(db, assignee) : null;
    if (!profile) return NextResponse.json({ error: "That user does not exist." }, { status: 404 });

    // Conflict of interest: never assign a paper to its submitter or an author.
    const authorRows = await db.query(`SELECT email FROM \`${T.paperAuthors}\` WHERE paper_id = ?`, [id]);
    const conflict = assignmentConflict(
      { submittedBy: paper.submitted_by, authorEmails: authorRows.map((a) => a.email) },
      { id: profile.id, email: profile.email },
    );
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

    // Reuse the account-level role system: you can only assign someone a paper
    // role they actually hold in user_roles.
    const hasRole = await db.one(`SELECT role FROM \`${T.userRoles}\` WHERE user_id = ? AND role = ?`, [assignee, role]);
    if (!hasRole) {
      return NextResponse.json(
        { error: `That user does not have the ${role.replace("_", " ")} role. Grant it from People & roles first.` },
        { status: 422 },
      );
    }

    await db.transaction(async (tx) => {
      // Upsert on (paper_id, assignee, role). Re-assigning without a date keeps
      // the existing deadline.
      await tx.exec(
        `INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by, assigned_at, due_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?)
         ON DUPLICATE KEY UPDATE assigned_by = VALUES(assigned_by)${dueAt ? ", due_at = VALUES(due_at)" : ""}`,
        [uuid(), id, assignee, role, me.id, toDate(dueAt)],
      );
      // Only a reviewer assignment starts review (conditional update = race-safe).
      const nextStatus = statusAfterAssignment(paper.status, role);
      if (nextStatus) {
        await tx.exec(`UPDATE \`${T.papers}\` SET status = ? WHERE id = ? AND status = ?`, [nextStatus, id, paper.status]);
      }
      await logActivity(tx, id, me.id, "ASSIGNED", { assignee, role, dueAt });
    });

    if (REVIEWER_ROLES.includes(role)) notifyLater("REVIEW_ASSIGNED", { paperId: id, assignee, actorId: me.id, dueAt });
    else if (role === "EDITOR") notifyLater("EDITOR_ASSIGNED", { paperId: id, assignee, actorId: me.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("papers/[id]/assign:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not assign the user." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;

  let assignee, role;
  try {
    const body = await request.json();
    assignee = String(body?.assignee || "");
    role = String(body?.role || "").toUpperCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!assignee || !ASSIGNABLE.includes(role)) {
    return NextResponse.json({ error: "Specify the assignee and role to remove." }, { status: 422 });
  }

  try {
    const paper = await db.one(`SELECT id, submitted_by FROM \`${T.papers}\` WHERE id = ?`, [id]);
    if (!paper) return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    if (paper.submitted_by === me.id) return NextResponse.json({ error: "You can't manage assignments on a paper you submitted." }, { status: 409 });

    // A submitted review is part of the record — don't orphan it by unassigning.
    if (REVIEWER_ROLES.includes(role)) {
      // Any round: with multiple rounds there can be several rows.
      const rv = await db.one(
        `SELECT id FROM \`${T.reviews}\` WHERE paper_id = ? AND reviewer = ? AND status = 'SUBMITTED' LIMIT 1`, [id, assignee]);
      if (rv) {
        return NextResponse.json({ error: "This reviewer has already submitted a review and cannot be removed." }, { status: 409 });
      }
    }

    const removed = await db.transaction(async (tx) => {
      const r = await tx.exec(
        `DELETE FROM \`${T.paperAssignments}\` WHERE paper_id = ? AND assignee = ? AND role = ?`, [id, assignee, role]);
      if (r.affectedRows === 0) return false;
      // Drop an unfinished draft only if no reviewer-role assignment remains.
      const left = await tx.query(`SELECT role FROM \`${T.paperAssignments}\` WHERE paper_id = ? AND assignee = ?`, [id, assignee]);
      if (!left.some((a) => REVIEWER_ROLES.includes(a.role))) {
        await tx.exec(`DELETE FROM \`${T.reviews}\` WHERE paper_id = ? AND reviewer = ? AND status = 'DRAFT'`, [id, assignee]);
      }
      await logActivity(tx, id, me.id, "UNASSIGNED", { assignee, role });
      return true;
    });
    if (!removed) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("papers/[id]/assign DELETE:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not remove the assignment." }, { status: 500 });
  }
}
