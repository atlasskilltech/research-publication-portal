// A reviewer's OWN review for a paper, per review ROUND (Phase 3).
//   GET — { round, isRevision, canWrite, review (current round), history }
//         history = the caller's earlier-round reviews, each with the author's
//         responses to THAT review (only once the revision was released for
//         re-review; never responses to other reviewers).
//   PUT — save a draft or submit the final review for the CURRENT round.
//
// Authorization: the caller must hold a PEER/DESK reviewer assignment. Writes
// are only accepted while the paper is UNDER_REVIEW, always for
// papers.current_round, so a re-review is a NEW row and earlier rounds are
// never overwritten. A SUBMITTED review is final (409 on further writes).
// Author identity is never touched here.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyLater } from "@/lib/notifyServer";
import { validateReview, isReviewerAssignee } from "@/lib/reviewLogic";
import { loadPaperContext } from "@/lib/paperAccess";
import { responsesForReviewer, RS } from "@/lib/revisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REVIEW_COLS = "id, round, status, recommendation, technical_quality, originality, methodology, clarity, strengths, weaknesses, comments_to_author, confidential_to_editor, submitted_at, updated_at";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const ctx = await loadPaperContext(admin, id, me);
    if (!ctx || !isReviewerAssignee(ctx.assignments, me.id)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const round = ctx.paper.current_round ?? 0;

    const { data: mine } = await admin
      .from("reviews").select(REVIEW_COLS).eq("paper_id", id).eq("reviewer", me.id).order("round", { ascending: true });
    const current = (mine || []).find((r) => r.round === round) || null;

    // Earlier rounds + the author's answers to this reviewer, from the revision
    // that followed each round — only once that revision was released.
    const history = (mine || [])
      .filter((r) => r.round < round)
      .map((r) => {
        const rev = ctx.revisions.find((x) => x.round === r.round + 1);
        const released = rev && rev.status === RS.UNDER_REVIEW;
        return {
          round: r.round,
          review: r,
          revisionType: released ? rev.revision_type : null,
          authorResponses: released ? responsesForReviewer(rev.responses, r.id) : [],
        };
      });

    return NextResponse.json({
      round,
      isRevision: round > 0,
      canWrite: ctx.paper.status === "UNDER_REVIEW",
      review: current,
      history,
    });
  } catch (e) {
    console.error("review GET:", e?.message);
    return NextResponse.json({ error: "Could not load the review." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const final = body?.status === "SUBMITTED" || body?.submit === true;

  const verdict = validateReview(body, { final });
  if (!verdict.ok) {
    return NextResponse.json({ error: "Please complete the review.", issues: verdict.fields }, { status: 422 });
  }

  try {
    const admin = createAdminClient();
    const ctx = await loadPaperContext(admin, id, me);
    // Must be an assigned PEER/DESK reviewer (admins may not ghost-write a review).
    if (!ctx || !isReviewerAssignee(ctx.assignments, me.id)) {
      return NextResponse.json({ error: "You are not assigned to review this paper." }, { status: 403 });
    }
    if (ctx.paper.status !== "UNDER_REVIEW") {
      return NextResponse.json({ error: "This paper is not open for review right now." }, { status: 409 });
    }
    const round = ctx.paper.current_round ?? 0;
    const already = () =>
      NextResponse.json({ error: "You have already submitted your review for this round." }, { status: 409 });

    const row = {
      status: final ? "SUBMITTED" : "DRAFT",
      ...verdict.value,
      submitted_at: final ? new Date().toISOString() : null,
    };

    const { data: existing } = await admin
      .from("reviews")
      .select("id, status")
      .eq("paper_id", id)
      .eq("reviewer", me.id)
      .eq("round", round)
      .maybeSingle();
    if (existing?.status === "SUBMITTED") return already();

    if (existing) {
      // Conditional update: only a DRAFT can change. If a concurrent request
      // submitted in between, zero rows match → 409 instead of an overwrite.
      const { data: updated, error: updErr } = await admin
        .from("reviews")
        .update(row)
        .eq("id", existing.id)
        .eq("status", "DRAFT")
        .select("id");
      if (updErr) throw updErr;
      if (!updated?.length) return already();
    } else {
      const { error: insErr } = await admin
        .from("reviews")
        .insert({ paper_id: id, reviewer: me.id, round, ...row });
      // 23505 = unique (paper_id, reviewer, round): a concurrent first save won.
      if (insErr?.code === "23505") {
        return NextResponse.json({ error: "Your review was just saved elsewhere. Reload and try again." }, { status: 409 });
      }
      if (insErr) throw insErr;
    }

    // Audit (admin-only visibility). Round 0 = REVIEW_*, later rounds = REREVIEW_*.
    // First save → *_STARTED, final → *_SUBMITTED; later draft saves aren't logged.
    const prefix = round > 0 ? "REREVIEW" : "REVIEW";
    const action = final ? `${prefix}_SUBMITTED` : existing ? null : `${prefix}_STARTED`;
    if (action) {
      await admin.from("paper_activity").insert({
        paper_id: id, actor: me.id, action,
        detail: final ? { round, recommendation: verdict.value.recommendation } : { round },
      });
    }

    if (final) notifyLater("REVIEW_SUBMITTED", { paperId: id, actorId: me.id, round });
    return NextResponse.json({ ok: true, status: row.status, round });
  } catch (e) {
    console.error("review PUT:", e?.message);
    return NextResponse.json({ error: "Could not save the review." }, { status: 500 });
  }
}
