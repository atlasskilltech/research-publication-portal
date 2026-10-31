// A reviewer's OWN review for a paper.
//   GET — the caller's review (draft or submitted), or null.
//   PUT — save a draft or submit the final review.
//
// Authorization: the caller must be assigned to the paper (checked against
// paper_assignments). A reviewer can only read/write THEIR OWN review (the
// (paper_id, reviewer) row). A SUBMITTED review is final — further writes are
// rejected, preventing duplicate final reviews. Author identity is never
// touched here.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateReview, isReviewerAssignee } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only a PEER_REVIEWER / DESK_REVIEWER assignment may read or write a review
// (a SPOC or EDITOR assignment does not make someone a reviewer).
async function assertAssigned(admin, paperId, userId) {
  const { data } = await admin
    .from("paper_assignments")
    .select("assignee, role")
    .eq("paper_id", paperId)
    .eq("assignee", userId);
  return isReviewerAssignee(data, userId);
}

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const admin = createAdminClient();
    if (!me.isAdmin && !(await assertAssigned(admin, id, me.id))) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const { data: review } = await admin
      .from("reviews")
      .select("status, recommendation, technical_quality, originality, methodology, clarity, strengths, weaknesses, comments_to_author, confidential_to_editor, submitted_at, updated_at")
      .eq("paper_id", id)
      .eq("reviewer", me.id)
      .maybeSingle();
    return NextResponse.json({ review: review || null });
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

    // Must be an assigned reviewer (admins may not ghost-write a review).
    if (!(await assertAssigned(admin, id, me.id))) {
      return NextResponse.json({ error: "You are not assigned to review this paper." }, { status: 403 });
    }

    const already = () =>
      NextResponse.json({ error: "You have already submitted this review." }, { status: 409 });

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
      .maybeSingle();
    if (existing?.status === "SUBMITTED") return already();

    if (existing) {
      // Conditional update: only a DRAFT can change. If a concurrent request
      // submitted in between, zero rows match and we report 409 instead of
      // overwriting the final review.
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
        .insert({ paper_id: id, reviewer: me.id, ...row });
      // 23505 = unique (paper_id, reviewer): a concurrent first save won the
      // race. Ask the client to retry rather than silently overwrite.
      if (insErr?.code === "23505") {
        return NextResponse.json({ error: "Your review was just saved elsewhere. Reload and try again." }, { status: 409 });
      }
      if (insErr) throw insErr;
    }

    // Audit: first save → REVIEW_STARTED, final → REVIEW_SUBMITTED (later draft
    // saves aren't logged to keep the trail readable). Admin-only visibility.
    const action = final ? "REVIEW_SUBMITTED" : existing ? null : "REVIEW_STARTED";
    if (action) {
      await admin.from("paper_activity").insert({
        paper_id: id, actor: me.id, action,
        detail: final ? { recommendation: verdict.value.recommendation } : {},
      });
    }

    return NextResponse.json({ ok: true, status: row.status });
  } catch (e) {
    console.error("review PUT:", e?.message);
    return NextResponse.json({ error: "Could not save the review." }, { status: 500 });
  }
}
