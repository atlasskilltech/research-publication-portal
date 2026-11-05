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
import { db, T } from "@/lib/db";
import { summarizeAuthor, summarizeReviewer, summarizeEditorial, summarizeUsers } from "@/lib/dashboardLogic";
import { REVIEWER_ROLES } from "@/lib/reviewLogic";
import { findAuthorProfile } from "@/lib/repos/authors.mjs";
import { CONFERENCE_NAME, authorStatusLabel } from "@/lib/authorRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const none = Promise.resolve([]);

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const now = new Date();

    // ---- Author (own papers) ----------------------------------------------
    const myPapers = await db.query(
      `SELECT id, title, status, current_round, created_at FROM \`${T.papers}\` WHERE submitted_by = ?`, [me.id]);
    const myIds = myPapers.map((p) => p.id);
    const [myRevs, myDecs] = await Promise.all([
      myIds.length
        ? db.query(`SELECT paper_id, round, revision_type, status, due_at FROM \`${T.paperRevisions}\` WHERE paper_id IN (?)`, [myIds])
        : none,
      // decision + released_at only — never summary drafts or confidential notes
      myIds.length
        ? db.query(`SELECT paper_id, decision, released_at FROM \`${T.editorialDecisions}\` WHERE paper_id IN (?) AND released_at IS NOT NULL`, [myIds])
        : none,
    ]);
    const body = { name: me.name, author: summarizeAuthor({ papers: myPapers, revisions: myRevs, decisions: myDecs }, now) };

    // ---- External author (AIDC 2026): own profile only ------------------------
    if (me.baseType === "AUTHOR") {
      const p = await findAuthorProfile(db, me.id);
      body.externalAuthor = {
        conference: CONFERENCE_NAME,
        email: me.email,
        profile: p ? {
          phone: p.phone, organization: p.organization, currentStatus: authorStatusLabel(p.current_status),
          designation: p.designation, location: p.location,
        } : null,
      };
    }

    // ---- Reviewer -----------------------------------------------------------
    const myAssigns = await db.query(
      `SELECT paper_id, assignee, role, due_at FROM \`${T.paperAssignments}\` WHERE assignee = ?`, [me.id]);
    const reviewerAssigns = myAssigns.filter((a) => REVIEWER_ROLES.includes(a.role));
    if (reviewerAssigns.length) {
      const ids = [...new Set(reviewerAssigns.map((a) => a.paper_id))];
      const [rp, rr] = await Promise.all([
        // reviewer-facing fields only
        db.query(`SELECT id, title, status, current_round FROM \`${T.papers}\` WHERE id IN (?)`, [ids]),
        db.query(`SELECT paper_id, reviewer, round, status FROM \`${T.reviews}\` WHERE reviewer = ? AND paper_id IN (?)`, [me.id, ids]),
      ]);
      body.reviewer = summarizeReviewer({ assignments: reviewerAssigns, papers: rp, reviews: rr, viewerId: me.id }, now);
    }

    // ---- Editorial + publication (admin: all; editor: own EDITOR papers) ---
    const editedIds = [...new Set(myAssigns.filter((a) => a.role === "EDITOR").map((a) => a.paper_id))];
    if (me.isAdmin || editedIds.length) {
      // never own papers
      const ep = me.isAdmin
        ? await db.query(`SELECT id, status, current_round FROM \`${T.papers}\` WHERE submitted_by <> ? LIMIT 2000`, [me.id])
        : await db.query(`SELECT id, status, current_round FROM \`${T.papers}\` WHERE id IN (?) LIMIT 2000`, [editedIds]);
      const eids = ep.map((p) => p.id);
      const [er, ed, ea, pubs] = await Promise.all([
        eids.length ? db.query(`SELECT paper_id, reviewer, round, status FROM \`${T.reviews}\` WHERE paper_id IN (?)`, [eids]) : none,
        eids.length ? db.query(`SELECT paper_id, round, decision, released_at FROM \`${T.editorialDecisions}\` WHERE paper_id IN (?)`, [eids]) : none,
        eids.length ? db.query(`SELECT paper_id, assignee, role, due_at FROM \`${T.paperAssignments}\` WHERE paper_id IN (?)`, [eids]) : none,
        eids.length ? db.query(`SELECT paper_id, status FROM \`${T.publications}\` WHERE paper_id IN (?)`, [eids]) : none,
      ]);
      body.editorial = summarizeEditorial({ papers: ep, reviews: er, decisions: ed, assignments: ea }, now);
      const pubPapers = new Set(pubs.map((p) => p.paper_id));
      const acceptedReady = ep.filter((p) => p.status === "ACCEPTED" && !pubPapers.has(p.id)).length;
      body.publication = {
        awaiting: acceptedReady,
        scheduled: pubs.filter((p) => p.status === "SCHEDULED").length,
        published: pubs.filter((p) => p.status === "PUBLISHED").length,
      };
    }

    // ---- People (admin) -------------------------------------------------------
    if (me.isAdmin) {
      const [profiles, roles] = await Promise.all([
        db.query(`SELECT baseType AS base_type, isAdmin AS is_admin FROM \`${T.users}\` LIMIT 10000`),
        db.query(`SELECT role FROM \`${T.userRoles}\` LIMIT 20000`),
      ]);
      body.people = summarizeUsers({ profiles, roles });
    }

    return NextResponse.json(body);
  } catch (e) {
    console.error("dashboard GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load your dashboard." }, { status: 500 });
  }
}
