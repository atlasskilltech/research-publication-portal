// Administrator review monitoring across ALL papers: every reviewer assignment
// with its review status, recommendation and deadline state, plus totals.
// Admin-only. Confidential comments are NOT included here (open the paper's
// review panel for the full record) — this list is for progress tracking.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { REVIEWER_ROLES, deadlineState, summarizeReviews } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const admin = createAdminClient();

    const { data: assigns, error } = await admin
      .from("paper_assignments")
      .select("paper_id, assignee, role, assigned_at, due_at")
      .in("role", REVIEWER_ROLES)
      .order("assigned_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    if (!assigns?.length) return NextResponse.json({ summary: summarizeReviews([]), rows: [] });

    const paperIds = [...new Set(assigns.map((a) => a.paper_id))];
    const reviewerIds = [...new Set(assigns.map((a) => a.assignee))];

    const [{ data: papers }, { data: reviews }, { data: profs }] = await Promise.all([
      admin.from("papers").select("id, title, status, current_round, submitted_by").in("id", paperIds),
      admin.from("reviews").select("paper_id, reviewer, round, status, recommendation, submitted_at, updated_at").in("paper_id", paperIds),
      admin.from("profiles").select("id, name, email").in("id", reviewerIds),
    ]);
    const paperById = new Map((papers || []).map((p) => [p.id, p]));
    // Only each paper's CURRENT round counts toward progress.
    const reviewByKey = new Map(
      (reviews || [])
        .filter((r) => r.round === (paperById.get(r.paper_id)?.current_round ?? 0))
        .map((r) => [`${r.paper_id}:${r.reviewer}`, r]),
    );
    const profById = new Map((profs || []).map((p) => [p.id, p]));

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
    console.error("admin/reviews GET:", e?.message);
    return NextResponse.json({ error: "Could not load review monitoring." }, { status: 500 });
  }
}
