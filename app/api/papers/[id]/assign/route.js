// Admin-only: assign the next responsible person to a submission. Reuses the
// EXISTING user_roles vocabulary — the assignee must already hold that role in
// public.user_roles (no parallel role system). Records the assignment and an
// audit entry; moves a freshly-submitted paper to UNDER_REVIEW on first assign.
// Blocks conflicts of interest (submitter or a listed author).
//
// DELETE removes an assignment, unless that reviewer already submitted a review.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { assignmentConflict, REVIEWER_ROLES } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSIGNABLE = ["SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"];

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;

  let assignee, role, dueAt = null;
  try {
    const body = await request.json();
    assignee = String(body?.assignee || "");
    role = String(body?.role || "").toUpperCase();
    if (body?.dueAt) {
      const d = new Date(body.dueAt);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: "Invalid deadline." }, { status: 422 });
      dueAt = d.toISOString();
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!ASSIGNABLE.includes(role)) {
    return NextResponse.json({ error: "Choose a valid role (SPOC, Desk Reviewer, Peer Reviewer, Editor)." }, { status: 422 });
  }

  try {
    const admin = createAdminClient();

    const { data: paper } = await admin.from("papers").select("id, status, submitted_by").eq("id", id).maybeSingle();
    if (!paper) return NextResponse.json({ error: "Submission not found." }, { status: 404 });

    const { data: profile } = await admin.from("profiles").select("id, email").eq("id", assignee).maybeSingle();
    if (!profile) return NextResponse.json({ error: "That user does not exist." }, { status: 404 });

    // Conflict of interest: never assign a paper to its submitter or an author.
    const { data: authorRows } = await admin.from("paper_authors").select("email").eq("paper_id", id);
    const conflict = assignmentConflict(
      { submittedBy: paper.submitted_by, authorEmails: (authorRows || []).map((a) => a.email) },
      { id: profile.id, email: profile.email },
    );
    if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });

    // Reuse the account-level role system: you can only assign someone a paper
    // role they actually hold in user_roles.
    const { data: hasRole } = await admin.from("user_roles").select("role").eq("user_id", assignee).eq("role", role).maybeSingle();
    if (!hasRole) {
      return NextResponse.json(
        { error: `That user does not have the ${role.replace("_", " ")} role. Grant it from People & roles first.` },
        { status: 422 },
      );
    }

    const { error: insErr } = await admin
      .from("paper_assignments")
      .upsert({ paper_id: id, assignee, role, assigned_by: me.id, due_at: dueAt }, { onConflict: "paper_id,assignee,role" });
    if (insErr) throw insErr;

    if (paper.status === "SUBMITTED") {
      await admin.from("papers").update({ status: "UNDER_REVIEW" }).eq("id", id);
    }
    await admin.from("paper_activity").insert({ paper_id: id, actor: me.id, action: "ASSIGNED", detail: { assignee, role, dueAt } });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("papers/[id]/assign:", e?.message);
    return NextResponse.json({ error: "Could not assign the user." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;

  let assignee, role;
  try {
    const body = await request.json();
    assignee = String(body?.assignee || "");
    role = String(body?.role || "").toUpperCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!assignee || !ASSIGNABLE.includes(role)) {
    return NextResponse.json({ error: "Specify the assignee and role to remove." }, { status: 422 });
  }

  try {
    const admin = createAdminClient();

    // A submitted review is part of the record — don't orphan it by unassigning.
    if (REVIEWER_ROLES.includes(role)) {
      const { data: rv } = await admin.from("reviews").select("status").eq("paper_id", id).eq("reviewer", assignee).maybeSingle();
      if (rv?.status === "SUBMITTED") {
        return NextResponse.json({ error: "This reviewer has already submitted a review and cannot be removed." }, { status: 409 });
      }
    }

    const { data: removed, error } = await admin
      .from("paper_assignments")
      .delete()
      .eq("paper_id", id)
      .eq("assignee", assignee)
      .eq("role", role)
      .select("id");
    if (error) throw error;
    if (!removed?.length) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });

    // Drop an unfinished draft only if no reviewer-role assignment remains.
    const { data: left } = await admin.from("paper_assignments").select("role").eq("paper_id", id).eq("assignee", assignee);
    if (!(left || []).some((a) => REVIEWER_ROLES.includes(a.role))) {
      await admin.from("reviews").delete().eq("paper_id", id).eq("reviewer", assignee).eq("status", "DRAFT");
    }

    await admin.from("paper_activity").insert({ paper_id: id, actor: me.id, action: "UNASSIGNED", detail: { assignee, role } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("papers/[id]/assign DELETE:", e?.message);
    return NextResponse.json({ error: "Could not remove the assignment." }, { status: 500 });
  }
}
