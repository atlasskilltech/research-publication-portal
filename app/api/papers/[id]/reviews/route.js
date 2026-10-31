// Administrator review-management view for one paper: every assigned reviewer,
// each one's review status (PENDING / DRAFT / SUBMITTED), recommendation, and —
// for admins only — the confidential-to-editor comments. Admin-only; reviewers
// never reach this (they use /api/papers/[id]/review for their own).
//
// (Editorial decisions are NOT implemented here — a later phase.)
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewForEditor, REVIEWER_ROLES, deadlineState, summarizeReviews } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;

  try {
    const admin = createAdminClient();

    const { data: paper } = await admin.from("papers").select("id, status").eq("id", id).maybeSingle();
    if (!paper) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const { data: assigns } = await admin
      .from("paper_assignments")
      .select("assignee, role, assigned_at, due_at")
      .eq("paper_id", id)
      .in("role", REVIEWER_ROLES); // SPOC/EDITOR assignments don't review

    const { data: reviews } = await admin
      .from("reviews")
      .select("reviewer, status, recommendation, technical_quality, originality, methodology, clarity, strengths, weaknesses, comments_to_author, confidential_to_editor, submitted_at, updated_at")
      .eq("paper_id", id);
    const reviewByReviewer = new Map((reviews || []).map((r) => [r.reviewer, r]));

    // Reviewer display names (admins are authorized to see who the reviewers are).
    const reviewerIds = [...new Set((assigns || []).map((a) => a.assignee))];
    const nameById = new Map();
    if (reviewerIds.length) {
      const { data: profs } = await admin.from("profiles").select("id, name, email").in("id", reviewerIds);
      (profs || []).forEach((p) => nameById.set(p.id, { name: p.name, email: p.email }));
    }

    const now = new Date();
    const rows = (assigns || []).map((a) => {
      const r = reviewByReviewer.get(a.assignee);
      const who = nameById.get(a.assignee) || {};
      const reviewStatus = r?.status || "PENDING"; // PENDING = assigned, no review row yet
      return {
        reviewer: a.assignee,
        reviewerName: who.name || null,
        reviewerEmail: who.email || null,
        role: a.role,
        assignedAt: a.assigned_at,
        dueAt: a.due_at,
        reviewStatus,
        deadline: deadlineState(a.due_at, reviewStatus, now),
        review: r ? reviewForEditor(r) : null,   // full record incl. confidential (admin)
      };
    });

    return NextResponse.json({
      paperStatus: paper.status,
      summary: summarizeReviews(rows),
      reviewers: rows,
    });
  } catch (e) {
    console.error("papers/[id]/reviews GET:", e?.message);
    return NextResponse.json({ error: "Could not load reviews." }, { status: 500 });
  }
}
