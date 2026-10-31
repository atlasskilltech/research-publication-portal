// The current user's review assignments (reviewer dashboard data). Returns only
// reviewer-facing paper fields — NEVER author identity — joined with the user's
// own review status. A user sees only papers assigned to them.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { REVIEWER_ROLES } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: assigns, error } = await admin
      .from("paper_assignments")
      .select("paper_id, role, assigned_at, due_at")
      .eq("assignee", me.id)
      .in("role", REVIEWER_ROLES) // SPOC/EDITOR assignments are not reviews
      .order("assigned_at", { ascending: false });
    if (error) throw error;

    const ids = [...new Set((assigns || []).map((a) => a.paper_id))];
    if (ids.length === 0) return NextResponse.json({ assignments: [] });

    // Reviewer-facing paper fields only (no authors).
    const { data: papers } = await admin
      .from("papers")
      .select("id, title, abstract, keywords, status, created_at")
      .in("id", ids);
    const paperById = new Map((papers || []).map((p) => [p.id, p]));

    // The caller's OWN reviews only.
    const { data: myReviews } = await admin
      .from("reviews")
      .select("paper_id, status, recommendation")
      .eq("reviewer", me.id)
      .in("paper_id", ids);
    const reviewByPaper = new Map((myReviews || []).map((r) => [r.paper_id, r]));

    const assignments = (assigns || []).map((a) => {
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
        reviewStatus: r?.status || "PENDING",       // PENDING | DRAFT | SUBMITTED
        myRecommendation: r?.recommendation || null,
      };
    });
    return NextResponse.json({ assignments });
  } catch (e) {
    console.error("reviews GET:", e?.message);
    return NextResponse.json({ error: "Could not load your assignments." }, { status: 500 });
  }
}
