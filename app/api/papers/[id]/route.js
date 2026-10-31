// Single submission detail. Shape depends on the viewer's relationship, decided
// server-side:
//   owner / admin  → full: paper + AUTHORS + every manuscript version + assignments + activity
//   assigned user  → reviewer-facing: paper + RELEASED manuscript versions only
//                    (no filenames), own assignments; NEVER authors (double-blind).
//   anyone else → 404 (don't reveal existence).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignmentsForViewer, activityForViewer, isReviewerAssignee } from "@/lib/reviewLogic";
import { loadPaperContext } from "@/lib/paperAccess";
import { permittedVersions, displayStatus } from "@/lib/revisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const ctx = await loadPaperContext(admin, id, me);
    if (!ctx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const { paper, assignments, isOwner, isAssigned, latest } = ctx;

    const privileged = me.isAdmin || isOwner; // may see author identity
    if (!privileged && !isAssigned) return NextResponse.json({ error: "Not found." }, { status: 404 });
    // On their own paper an administrator is the AUTHOR (never sees reviewers).
    const viewerRole = isOwner ? "owner" : me.isAdmin ? "admin" : "reviewer";

    const { data: manuscripts } = await admin
      .from("paper_manuscripts")
      .select("version, mime_type, byte_size, original_filename, created_at")
      .eq("paper_id", id);
    const versions = permittedVersions(privileged ? (isOwner ? "owner" : "admin") : "assigned", manuscripts, ctx.released);

    const base = {
      id: paper.id,
      title: paper.title,
      abstract: paper.abstract,
      keywords: paper.keywords,
      school: paper.school_code || null,
      status: paper.status,
      currentRound: paper.current_round,
      createdAt: paper.created_at,
      updatedAt: paper.updated_at,
      // Versions the caller may download. Original filenames can carry
      // identity → owner/admin only.
      manuscripts: versions.map((m) => ({
        version: m.version,
        mimeType: m.mime_type,
        byteSize: m.byte_size,
        uploadedAt: m.created_at,
        originalFilename: privileged ? m.original_filename : null,
      })),
      // Admin: all assignments. Owner: roles only (never reviewer identity).
      // Reviewer: only their own rows (can't discover co-reviewers).
      assignments: assignmentsForViewer(assignments, viewerRole, me.id),
      viewerRole,
      // Only a PEER/DESK reviewer assignment gets the review form.
      canReview: isReviewerAssignee(assignments, me.id),
      // Admin or the paper's EDITOR manages revision requests.
      canManage: ctx.canManage,
      // Minimal revision summary (details come from /revisions, shaped per viewer).
      revision: latest && (privileged || ctx.canManage)
        ? { round: latest.round, type: latest.revision_type, status: latest.status, displayStatus: displayStatus(latest), dueAt: latest.due_at }
        : null,
    };

    if (!privileged) {
      // Reviewer/editor: double-blind — no authors, ever.
      return NextResponse.json({ paper: base });
    }

    const [{ data: authors }, { data: activity }] = await Promise.all([
      admin
        .from("paper_authors")
        .select("full_name, email, affiliation, is_corresponding, author_order")
        .eq("paper_id", id)
        .order("author_order", { ascending: true }),
      admin
        .from("paper_activity")
        .select("action, detail, actor, created_at")
        .eq("paper_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

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
