// Administrator review monitoring across ALL papers: every reviewer assignment
// with its review status, recommendation and deadline state, plus totals.
// Admin-only. Confidential comments are NOT included here (open the paper's
// review panel for the full record) — this list is for progress tracking.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { usersByIds } from "@/lib/repos/users.mjs";
import { REVIEWER_ROLES, deadlineState, summarizeReviews } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const assigns = await db.query(
      `SELECT paper_id, assignee, role, assigned_at, due_at FROM \`${T.paperAssignments}\`
        WHERE role IN (?) ORDER BY assigned_at DESC LIMIT 1000`,
      [REVIEWER_ROLES],
    );
    if (!assigns.length) return NextResponse.json({ summary: summarizeReviews([]), rows: [] });

    const paperIds = [...new Set(assigns.map((a) => a.paper_id))];
    const reviewerIds = [...new Set(assigns.map((a) => a.assignee))];

    const [papers, reviews, profMap] = await Promise.all([
      db.query(`SELECT id, title, status, current_round, submitted_by FROM \`${T.papers}\` WHERE id IN (?)`, [paperIds]),
      db.query(
        `SELECT paper_id, reviewer, round, status, recommendation, submitted_at, updated_at FROM \`${T.reviews}\` WHERE paper_id IN (?)`,
        [paperIds],
      ),
      usersByIds(db, reviewerIds),
    ]);
    const paperById = new Map(papers.map((p) => [p.id, p]));
    // Only each paper's CURRENT round counts toward progress.
    const reviewByKey = new Map(
      reviews
        .filter((r) => r.round === (paperById.get(r.paper_id)?.current_round ?? 0))
        .map((r) => [`${r.paper_id}:${r.reviewer}`, r]),
    );
    const profById = profMap;

    const now = new Date();
    // Never show an administrator the reviewers of a paper they authored.
    const ownPaper = (pid) => paperById.get(pid)?.submitted_by === me.id;
    const rows = assigns.filter((a) => !ownPaper(a.paper_id)).map((a) => {
      const r = reviewByKey.get(`${a.paper_id}:${a.assignee}`);
      const p = paperById.get(a.paper_id);
      const who = profById.get(a.assignee);
      const reviewStatus = r?.status || "PENDING";
      return {
        paperId: a.paper_id,
        paperTitle: p?.title || null,
        paperStatus: p?.status || null,
        round: p?.current_round ?? 0,
        reviewer: a.assignee,
        reviewerName: who?.name || null,
        reviewerEmail: who?.email || null,
        role: a.role,
        assignedAt: a.assigned_at,
        dueAt: a.due_at,
        reviewStatus,
        recommendation: r?.status === "SUBMITTED" ? r.recommendation : null,
        submittedAt: r?.submitted_at || null,
        lastActivity: r?.updated_at || a.assigned_at,
        deadline: deadlineState(a.due_at, reviewStatus, now),
      };
    });

    return NextResponse.json({ summary: summarizeReviews(rows), rows });
  } catch (e) {
    console.error("admin/reviews GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load review monitoring." }, { status: 500 });
  }
}
