// The current user's review assignments (reviewer dashboard data). Returns only
// reviewer-facing paper fields — NEVER author identity — joined with the user's
// own review status. A user sees only papers assigned to them.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { jrows } from "@/lib/repos/rows.mjs";
import { REVIEWER_ROLES } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const assigns = await db.query(
      `SELECT paper_id, role, assigned_at, due_at FROM \`${T.paperAssignments}\`
        WHERE assignee = ? AND role IN (?) ORDER BY assigned_at DESC`, // SPOC/EDITOR assignments are not reviews
      [me.id, REVIEWER_ROLES],
    );

    const ids = [...new Set(assigns.map((a) => a.paper_id))];
    if (ids.length === 0) return NextResponse.json({ assignments: [] });

    // Reviewer-facing paper fields only (no authors).
    const papers = jrows(await db.query(
      `SELECT id, title, abstract, keywords, status, current_round, created_at FROM \`${T.papers}\` WHERE id IN (?)`,
      [ids],
    ));
    const paperById = new Map(papers.map((p) => [p.id, p]));

    // The caller's OWN reviews only — for each paper's CURRENT round.
    const myReviews = await db.query(
      `SELECT paper_id, round, status, recommendation FROM \`${T.reviews}\` WHERE reviewer = ? AND paper_id IN (?)`,
      [me.id, ids],
    );
    const reviewByPaper = new Map(
      myReviews
        .filter((r) => r.round === (paperById.get(r.paper_id)?.current_round ?? 0))
        .map((r) => [r.paper_id, r]),
    );

    const assignments = assigns.map((a) => {
      const p = paperById.get(a.paper_id);
      const r = reviewByPaper.get(a.paper_id);
      return {
        paperId: a.paper_id,
        role: a.role,
        assignedAt: a.assigned_at,
        dueAt: a.due_at,
        title: p?.title || null,
        abstract: p?.abstract || null,
        keywords: p?.keywords || [],
        paperStatus: p?.status || null,
        round: p?.current_round ?? 0,
        isRevision: (p?.current_round ?? 0) > 0,  // revised submission → re-review
        openForReview: p?.status === "UNDER_REVIEW",
        reviewStatus: r?.status || "PENDING",       // PENDING | DRAFT | SUBMITTED
        myRecommendation: r?.recommendation || null,
      };
    });
    return NextResponse.json({ assignments });
  } catch (e) {
    console.error("reviews GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load your assignments." }, { status: 500 });
  }
}
