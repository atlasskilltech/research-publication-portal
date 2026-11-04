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
import { db, T, isDuplicate } from "@/lib/db";
import { uuid } from "@/lib/auth/crypto.mjs";
import { logActivity } from "@/lib/repos/rows.mjs";
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
    const ctx = await loadPaperContext(db, id, me);
    if (!ctx || !isReviewerAssignee(ctx.assignments, me.id)) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const round = ctx.paper.current_round ?? 0;

    const mine = await db.query(
      `SELECT ${REVIEW_COLS} FROM \`${T.reviews}\` WHERE paper_id = ? AND reviewer = ? ORDER BY round ASC`,
      [id, me.id],
    );
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
    console.error("review GET:", e?.code || e?.message);
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
    const ctx = await loadPaperContext(db, id, me);
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

    const status = final ? "SUBMITTED" : "DRAFT";
    const v = verdict.value;
    const submittedAt = final ? new Date() : null;
    const values = [
      v.recommendation, v.technical_quality, v.originality, v.methodology, v.clarity,
      v.strengths, v.weaknesses, v.comments_to_author, v.confidential_to_editor,
    ];

    const existing = await db.one(
      `SELECT id, status FROM \`${T.reviews}\` WHERE paper_id = ? AND reviewer = ? AND round = ?`,
      [id, me.id, round],
    );
    if (existing?.status === "SUBMITTED") return already();

    if (existing) {
      // Conditional update: only a DRAFT can change. If a concurrent request
      // submitted in between, zero rows match → 409 instead of an overwrite.
      const r = await db.exec(
        `UPDATE \`${T.reviews}\` SET status = ?, recommendation = ?, technical_quality = ?, originality = ?, methodology = ?, clarity = ?,
                strengths = ?, weaknesses = ?, comments_to_author = ?, confidential_to_editor = ?, submitted_at = ?
          WHERE id = ? AND status = 'DRAFT'`,
        [status, ...values, submittedAt, existing.id],
      );
      if (r.affectedRows !== 1) return already();
    } else {
      try {
        await db.exec(
          `INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status, recommendation, technical_quality, originality, methodology, clarity,
                  strengths, weaknesses, comments_to_author, confidential_to_editor, submitted_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [uuid(), id, me.id, round, status, ...values, submittedAt],
        );
      } catch (insErr) {
        // Unique (paper_id, reviewer, round): a concurrent first save won.
        if (isDuplicate(insErr)) {
          return NextResponse.json({ error: "Your review was just saved elsewhere. Reload and try again." }, { status: 409 });
        }
        throw insErr;
      }
    }

    // Audit (admin-only visibility). Round 0 = REVIEW_*, later rounds = REREVIEW_*.
    // First save → *_STARTED, final → *_SUBMITTED; later draft saves aren't logged.
    const prefix = round > 0 ? "REREVIEW" : "REVIEW";
    const action = final ? `${prefix}_SUBMITTED` : existing ? null : `${prefix}_STARTED`;
    if (action) {
      await logActivity(db, id, me.id, action, final ? { round, recommendation: v.recommendation } : { round });
    }

    if (final) notifyLater("REVIEW_SUBMITTED", { paperId: id, actorId: me.id, round });
    return NextResponse.json({ ok: true, status, round });
  } catch (e) {
    console.error("review PUT:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not save the review." }, { status: 500 });
  }
}
