// Real dashboard data for the signed-in user. Sections depend on what the user
// can ACTUALLY do (server-side facts), never on the cosmetic "view as" role:
//   author      — always (own submissions only)
//   reviewer    — if the user holds PEER/DESK reviewer assignments
//   editorial   — admin (all papers) or EDITOR assignments (their papers)
//   publication — same scope as editorial
//   people      — admins only
// No author identity in reviewer/editorial sections; no reviewer identity or
// confidential content anywhere.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeAuthor, summarizeReviewer, summarizeEditorial, summarizeUsers } from "@/lib/dashboardLogic";
import { REVIEWER_ROLES } from "@/lib/reviewLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const none = Promise.resolve({ data: [] });

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const now = new Date();

    // ---- Author (own papers) ----------------------------------------------
    const { data: myPapers } = await admin.from("papers").select("id, title, status, current_round, created_at").eq("submitted_by", me.id);
    const myIds = (myPapers || []).map((p) => p.id);
    const [{ data: myRevs }, { data: myDecs }] = await Promise.all([
      myIds.length ? admin.from("paper_revisions").select("paper_id, round, revision_type, status, due_at").in("paper_id", myIds) : none,
      // decision + released_at only — never summary drafts or confidential notes
      myIds.length ? admin.from("editorial_decisions").select("paper_id, decision, released_at").in("paper_id", myIds).not("released_at", "is", null) : none,
    ]);
    const body = { name: me.name, author: summarizeAuthor({ papers: myPapers, revisions: myRevs, decisions: myDecs }, now) };

    // ---- Reviewer -----------------------------------------------------------
    const { data: myAssigns } = await admin.from("paper_assignments").select("paper_id, assignee, role, due_at").eq("assignee", me.id);
    const reviewerAssigns = (myAssigns || []).filter((a) => REVIEWER_ROLES.includes(a.role));
    if (reviewerAssigns.length) {
      const ids = [...new Set(reviewerAssigns.map((a) => a.paper_id))];
      const [{ data: rp }, { data: rr }] = await Promise.all([
        admin.from("papers").select("id, title, status, current_round").in("id", ids), // reviewer-facing fields only
        admin.from("reviews").select("paper_id, reviewer, round, status").eq("reviewer", me.id).in("paper_id", ids),
      ]);
      body.reviewer = summarizeReviewer({ assignments: reviewerAssigns, papers: rp, reviews: rr, viewerId: me.id }, now);
    }

    // ---- Editorial + publication (admin: all; editor: own EDITOR papers) ---
    const editedIds = [...new Set((myAssigns || []).filter((a) => a.role === "EDITOR").map((a) => a.paper_id))];
    if (me.isAdmin || editedIds.length) {
      let pq = admin.from("papers").select("id, status, current_round").limit(2000);
      pq = me.isAdmin ? pq.neq("submitted_by", me.id) : pq.in("id", editedIds); // never own papers
      const { data: ep } = await pq;
      const eids = (ep || []).map((p) => p.id);
      const [{ data: er }, { data: ed }, { data: ea }, { data: pubs }] = await Promise.all([
        eids.length ? admin.from("reviews").select("paper_id, reviewer, round, status").in("paper_id", eids) : none,
        eids.length ? admin.from("editorial_decisions").select("paper_id, round, decision, released_at").in("paper_id", eids) : none,
        eids.length ? admin.from("paper_assignments").select("paper_id, assignee, role, due_at").in("paper_id", eids) : none,
        eids.length ? admin.from("publications").select("paper_id, status").in("paper_id", eids) : none,
      ]);
      body.editorial = summarizeEditorial({ papers: ep, reviews: er, decisions: ed, assignments: ea }, now);
      const pubPapers = new Set((pubs || []).map((p) => p.paper_id));
      const acceptedReady = (ep || []).filter((p) => p.status === "ACCEPTED" && !pubPapers.has(p.id)).length;
      body.publication = {
        awaiting: acceptedReady,
        scheduled: (pubs || []).filter((p) => p.status === "SCHEDULED").length,
        published: (pubs || []).filter((p) => p.status === "PUBLISHED").length,
      };
    }

    // ---- People (admin) -------------------------------------------------------
    if (me.isAdmin) {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        admin.from("profiles").select("base_type, is_admin").limit(10000),
        admin.from("user_roles").select("role").limit(20000),
      ]);
      body.people = summarizeUsers({ profiles, roles });
    }

    return NextResponse.json(body);
  } catch (e) {
    console.error("dashboard GET:", e?.message);
    return NextResponse.json({ error: "Could not load your dashboard." }, { status: 500 });
  }
}
