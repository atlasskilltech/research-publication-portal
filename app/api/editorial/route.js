// Editorial dashboard data. Admins see every paper; a user assigned as EDITOR
// sees only the papers they edit. Anyone else gets an empty list (403 shape is
// avoided so the nav can stay simple). Author identity is NEVER included —
// editors stay blind to authors, consistent with the paper detail API.
//
// Each row: status, round, editorial category, editors, reviewer-report
// progress for the current round (pending / submitted / overdue), latest
// decision (no confidential notes) and revision status.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { REVIEWER_ROLES, deadlineState } from "@/lib/reviewLogic";
import { latestRevision, displayStatus } from "@/lib/revisionLogic";
import { editorialCategory, DECISION_LABEL } from "@/lib/decisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = ["AWAITING_DECISION", "AWAITING_REVIEWS", "REVISION", "ACCEPTED", "REJECTED", "OTHER"];

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();

    // Scope: all papers for admins; otherwise only papers where I am EDITOR.
    let paperQ = admin
      .from("papers")
      .select("id, title, status, current_round, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(500);
    if (me.isAdmin) paperQ = paperQ.neq("submitted_by", me.id); // never manage own paper
    else {
      const { data: mine } = await admin.from("paper_assignments").select("paper_id").eq("assignee", me.id).eq("role", "EDITOR");
      const ids = [...new Set((mine || []).map((a) => a.paper_id))];
      if (!ids.length) return NextResponse.json({ scope: "none", summary: emptySummary(), papers: [], editors: [] });
      paperQ = paperQ.in("id", ids);
    }
    const { data: papers, error } = await paperQ;
    if (error) throw error;
    if (!papers?.length) return NextResponse.json({ scope: me.isAdmin ? "all" : "editor", summary: emptySummary(), papers: [], editors: [] });

    const ids = papers.map((p) => p.id);
    const [{ data: assigns }, { data: reviews }, { data: decisions }, { data: revisions }] = await Promise.all([
      admin.from("paper_assignments").select("paper_id, assignee, role, due_at").in("paper_id", ids),
      admin.from("reviews").select("paper_id, reviewer, round, status").in("paper_id", ids),
      admin.from("editorial_decisions").select("paper_id, round, decision, released_at, updated_at").in("paper_id", ids),
      admin.from("paper_revisions").select("paper_id, round, revision_type, status, due_at").in("paper_id", ids),
    ]);

    const editorIds = [...new Set((assigns || []).filter((a) => a.role === "EDITOR").map((a) => a.assignee))];
    const nameById = new Map();
    if (editorIds.length) {
      const { data: profs } = await admin.from("profiles").select("id, name, email").in("id", editorIds);
      (profs || []).forEach((p) => nameById.set(p.id, p.name || p.email));
    }

    const group = (list) => {
      const m = new Map();
      (list || []).forEach((x) => m.set(x.paper_id, [...(m.get(x.paper_id) || []), x]));
      return m;
    };
    const aBy = group(assigns), rBy = group(reviews), dBy = group(decisions), vBy = group(revisions);
    const now = new Date();
    const summary = emptySummary();

    const rows = papers.map((p) => {
      const round = p.current_round ?? 0;
      const pa = aBy.get(p.id) || [];
      const roundReviews = (rBy.get(p.id) || []).filter((r) => r.round === round);
      const decs = (dBy.get(p.id) || []).sort((a, b) => a.round - b.round);
      const latestDec = decs[decs.length - 1] || null;
      const rev = latestRevision(vBy.get(p.id) || []);

      // Reviewer reports for the current round. Only counted while the paper
      // is actually under review (otherwise nothing is "pending").
      const reviewerAssigns = pa.filter((a) => REVIEWER_ROLES.includes(a.role));
      const statusOf = (uid) => roundReviews.find((r) => r.reviewer === uid)?.status || "PENDING";
      const open = p.status === "UNDER_REVIEW";
      const submitted = reviewerAssigns.filter((a) => statusOf(a.assignee) === "SUBMITTED").length;
      const pending = open ? reviewerAssigns.length - submitted : 0;
      const overdue = open ? reviewerAssigns.filter((a) => deadlineState(a.due_at, statusOf(a.assignee), now) === "overdue").length : 0;

      const category = editorialCategory(p, roundReviews, decs);
      summary[category]++;
      summary.pendingReports += pending;
      summary.overdueReviews += overdue;
      summary.completedDecisions += decs.filter((d) => d.released_at).length;

      return {
        id: p.id,
        title: p.title,
        status: p.status,
        round,
        submittedAt: p.created_at,
        updatedAt: p.updated_at,
        category,
        editors: pa.filter((a) => a.role === "EDITOR").map((a) => ({ id: a.assignee, name: nameById.get(a.assignee) || null })),
        reports: { assigned: reviewerAssigns.length, submitted, pending, overdue },
        decision: latestDec
          ? {
              round: latestDec.round,
              decision: latestDec.decision,
              label: DECISION_LABEL[latestDec.decision],
              released: !!latestDec.released_at,
              at: latestDec.released_at || latestDec.updated_at,
            }
          : null,
        revision: rev ? { round: rev.round, type: rev.revision_type, status: displayStatus(rev, now), dueAt: rev.due_at } : null,
      };
    });

    return NextResponse.json({
      scope: me.isAdmin ? "all" : "editor",
      summary,
      papers: rows,
      editors: editorIds.map((id) => ({ id, name: nameById.get(id) || null })),
    });
  } catch (e) {
    console.error("editorial GET:", e?.message);
    return NextResponse.json({ error: "Could not load the editorial dashboard." }, { status: 500 });
  }
}

function emptySummary() {
  const s = { pendingReports: 0, overdueReviews: 0, completedDecisions: 0 };
  CATEGORIES.forEach((c) => { s[c] = 0; });
  return s;
}
