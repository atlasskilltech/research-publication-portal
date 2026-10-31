// Single submission detail. Shape depends on the viewer's relationship, decided
// server-side:
//   owner / admin  → full: paper + AUTHORS + manuscript meta + assignments + activity
//   assigned reviewer → reviewer-facing: paper + manuscript meta (no identity),
//                       assignments; NEVER authors (double-blind).
//   anyone else → 404 (don't reveal existence).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignmentsForViewer, activityForViewer, isReviewerAssignee } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const { data: paper, error } = await admin
      .from("papers")
      .select("id, title, abstract, keywords, school_code, status, submitted_by, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!paper) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const isOwner = paper.submitted_by === me.id;
    const { data: assigned } = await admin
      .from("paper_assignments")
      .select("assignee, role, due_at")
      .eq("paper_id", id);
    const isAssigned = (assigned || []).some((a) => a.assignee === me.id);
    const privileged = me.isAdmin || isOwner; // may see author identity
    const viewerRole = me.isAdmin ? "admin" : isOwner ? "owner" : "reviewer";

    if (!privileged && !isAssigned) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const { data: manuscript } = await admin
      .from("paper_manuscripts")
      .select("mime_type, byte_size, original_filename, created_at")
      .eq("paper_id", id)
      .maybeSingle();

    const base = {
      id: paper.id,
      title: paper.title,
      abstract: paper.abstract,
      keywords: paper.keywords,
      school: paper.school_code || null,
      status: paper.status,
      createdAt: paper.created_at,
      updatedAt: paper.updated_at,
      manuscript: manuscript
        ? {
            mimeType: manuscript.mime_type,
            byteSize: manuscript.byte_size,
            // Original filename can carry identity → only owner/admin see it.
            originalFilename: privileged ? manuscript.original_filename : null,
          }
        : null,
      // Admin: all assignments. Owner: roles only (never reviewer identity).
      // Reviewer: only their own rows (can't discover co-reviewers).
      assignments: assignmentsForViewer(assigned, viewerRole, me.id),
      viewerRole,
      // Only a PEER/DESK reviewer assignment gets the review form.
      canReview: isReviewerAssignee(assigned, me.id),
    };

    if (!privileged) {
      // Reviewer: double-blind — no authors, ever.
      return NextResponse.json({ paper: base });
    }

    const { data: authors } = await admin
      .from("paper_authors")
      .select("full_name, email, affiliation, is_corresponding, author_order")
      .eq("paper_id", id)
      .order("author_order", { ascending: true });
    const { data: activity } = await admin
      .from("paper_activity")
      .select("action, detail, actor, created_at")
      .eq("paper_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json({
      paper: {
        ...base,
        authors: (authors || []).map((a) => ({
          fullName: a.full_name, email: a.email, affiliation: a.affiliation,
          isCorresponding: a.is_corresponding, order: a.author_order,
        })),
        // Owners see only allowlisted, actor-free events (reviewer anonymity).
        activity: activityForViewer(activity, viewerRole),
      },
    });
  } catch (e) {
    console.error("papers/[id] GET:", e?.message);
    return NextResponse.json({ error: "Could not load the submission." }, { status: 500 });
  }
}
