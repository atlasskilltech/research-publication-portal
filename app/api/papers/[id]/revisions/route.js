// Revision requests for one paper.
//   GET  — revision history, shaped for the caller:
//            manager (admin / paper EDITOR) → full, incl. which reviewer each
//                                              response answers
//            owner (author)                → anonymous reviewer comments
//                                              (comments_to_author ONLY), own
//                                              responses, no requester identity
//            anyone else                   → 404
//   POST — (kept for compatibility) manager issues a revision request. Since
//          Phase 4 this is a thin wrapper over the EDITORIAL DECISION flow: it
//          saves a MINOR_/MAJOR_REVISION decision and communicates it, which
//          calls request_paper_revision() (0007) inside release_editorial_decision()
//          (0008). So every revision request has a decision record, and there is
//          one code path. A reviewer's recommendation never triggers it.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPaperContext } from "@/lib/paperAccess";
import { validateRevisionRequest, revisionForAuthor, revisionForManager } from "@/lib/revisionLogic";
import { saveDecision, releaseDecision } from "@/lib/decisionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const ctx = await loadPaperContext(admin, id, me);
    if (!ctx || (!ctx.canManage && !ctx.isOwner)) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const reviewIds = [...new Set(ctx.revisions.flatMap((r) => r.review_ids || []))];
    const [{ data: reviews }, { data: manuscripts }] = await Promise.all([
      reviewIds.length
        ? admin.from("reviews").select("id, reviewer, status, comments_to_author").in("id", reviewIds)
        : Promise.resolve({ data: [] }),
      admin.from("paper_manuscripts").select("version, original_filename, mime_type, byte_size, created_at").eq("paper_id", id),
    ]);
    const msByVersion = new Map((manuscripts || []).map((m) => [m.version, m]));
    const now = new Date();

    if (ctx.canManage) {
      const reviewerIds = [...new Set((reviews || []).map((r) => r.reviewer))];
      const nameByReviewer = new Map();
      if (reviewerIds.length) {
        const { data: profs } = await admin.from("profiles").select("id, name, email").in("id", reviewerIds);
        (profs || []).forEach((p) => nameByReviewer.set(p.id, p.name || p.email));
      }
      const nameByReview = new Map((reviews || []).map((r) => [r.id, nameByReviewer.get(r.reviewer) || null]));
      return NextResponse.json({
        view: "manager",
        currentRound: ctx.paper.current_round,
        paperStatus: ctx.paper.status,
        revisions: ctx.revisions.map((r) => revisionForManager(r, nameByReview, msByVersion.get(r.round), now, { withFilename: !!me.isAdmin })),
      });
    }

    // Author view. `reviews` here carries only id/status/comments_to_author —
    // the shaper drops everything else anyway (defence in depth).
    return NextResponse.json({
      view: "author",
      currentRound: ctx.paper.current_round,
      paperStatus: ctx.paper.status,
      revisions: ctx.revisions.map((r) => revisionForAuthor(r, reviews, msByVersion.get(r.round), now)),
    });
  } catch (e) {
    console.error("revisions GET:", e?.message);
    return NextResponse.json({ error: "Could not load revisions." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const v = validateRevisionRequest(body);
  if (!v.ok) return NextResponse.json({ error: "Please complete the revision request.", issues: v.fields }, { status: 422 });

  try {
    const admin = createAdminClient();
    // Legacy one-step endpoint (save + release). Never overwrite another
    // editor's unreleased draft decision for this round — that must go through
    // the decision panel (with its stale-version confirmation).
    const ctx = await loadPaperContext(admin, id, me);
    if (!ctx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const currentRound = ctx.paper.current_round ?? 0;
    if (ctx.decisions.some((d) => d.round === currentRound && !d.released_at)) {
      return NextResponse.json({ error: "A draft decision already exists for this round. Review it in the decision panel.", code: "DRAFT_EXISTS" }, { status: 409 });
    }
    const saved = await saveDecision(admin, id, me, {
      decision: v.value.type === "MINOR" ? "MINOR_REVISION" : "MAJOR_REVISION",
      summary: v.value.instructions,
      confidentialNote: null,
      reviewIds: v.value.reviewIds,
      dueAt: v.value.dueAt,
    });
    if (saved.status !== 200) return NextResponse.json(saved.body, { status: saved.status });
    const { id: decisionId, version, round } = saved.body.decision;
    const released = await releaseDecision(admin, id, me, decisionId, version);
    if (released.status !== 200) return NextResponse.json(released.body, { status: released.status });
    return NextResponse.json({ ok: true, round: round + 1, decisionId }, { status: 201 });
  } catch (e) {
    console.error("revisions POST:", e?.message);
    return NextResponse.json({ error: "Could not create the revision request." }, { status: 500 });
  }
}
