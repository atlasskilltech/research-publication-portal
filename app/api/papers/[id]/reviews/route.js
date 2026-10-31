// Review management view for one paper (admin or the paper's EDITOR): every
// assigned reviewer's status for the CURRENT round (PENDING / DRAFT /
// SUBMITTED), recommendation, deadline state and — for managers only — the
// confidential-to-editor comments. Earlier rounds are returned separately in
// `history` (never merged or overwritten). Reviewers never reach this.
//
// (Accept/reject decisions are NOT implemented here — a later phase.)
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewForEditor, REVIEWER_ROLES, deadlineState, summarizeReviews } from "@/lib/reviewLogic";
import { loadPaperContext } from "@/lib/paperAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id, reviewer, round, status, recommendation, technical_quality, originality, methodology, clarity, strengths, weaknesses, comments_to_author, confidential_to_editor, submitted_at, updated_at";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const ctx = await loadPaperContext(admin, id, me);
    if (!ctx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!ctx.canManage) return NextResponse.json({ error: "Administrator or editor access is required." }, { status: 403 });
    const round = ctx.paper.current_round ?? 0;

    const assigns = ctx.assignments.filter((a) => REVIEWER_ROLES.includes(a.role)); // SPOC/EDITOR don't review
    const { data: reviews } = await admin.from("reviews").select(COLS).eq("paper_id", id).order("round", { ascending: true });

    const reviewerIds = [...new Set([...assigns.map((a) => a.assignee), ...(reviews || []).map((r) => r.reviewer)])];
    const nameById = new Map();
    if (reviewerIds.length) {
      const { data: profs } = await admin.from("profiles").select("id, name, email").in("id", reviewerIds);
      (profs || []).forEach((p) => nameById.set(p.id, { name: p.name, email: p.email }));
    }

    const currentByReviewer = new Map((reviews || []).filter((r) => r.round === round).map((r) => [r.reviewer, r]));
    const now = new Date();
    const rows = assigns.map((a) => {
      const r = currentByReviewer.get(a.assignee);
      const who = nameById.get(a.assignee) || {};
      const reviewStatus = r?.status || "PENDING"; // PENDING = assigned, no review row yet
      return {
        reviewer: a.assignee,
        reviewerName: who.name || null,
        reviewerEmail: who.email || null,
        role: a.role,
        dueAt: a.due_at,
        reviewStatus,
        deadline: deadlineState(a.due_at, reviewStatus, now),
        review: r ? reviewForEditor(r) : null, // full record incl. confidential (manager)
      };
    });

    // Earlier rounds, grouped. Kept read-only and separate.
    const history = [];
    for (let k = 0; k < round; k++) {
      const list = (reviews || []).filter((r) => r.round === k);
      history.push({
        round: k,
        reviews: list.map((r) => ({
          reviewer: r.reviewer,
          reviewerName: nameById.get(r.reviewer)?.name || null,
          review: reviewForEditor(r),
        })),
      });
    }

    return NextResponse.json({
      paperStatus: ctx.paper.status,
      round,
      summary: summarizeReviews(rows),
      reviewers: rows,
      history,
    });
  } catch (e) {
    console.error("papers/[id]/reviews GET:", e?.message);
    return NextResponse.json({ error: "Could not load reviews." }, { status: 500 });
  }
}
