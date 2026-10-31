// Author revision dashboard: the latest revision request for each of the
// caller's OWN submissions (ownership = papers.submitted_by, the existing
// model). Reviewer feedback is reduced to anonymous comments_to_author; no
// reviewer identity, scores, recommendation or confidential comments.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisionForAuthor, latestRevision } from "@/lib/revisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const admin = createAdminClient();
    const { data: papers, error } = await admin
      .from("papers").select("id, title, status, current_round").eq("submitted_by", me.id);
    if (error) throw error;
    const paperIds = (papers || []).map((p) => p.id);
    if (!paperIds.length) return NextResponse.json({ revisions: [] });

    const { data: revs } = await admin
      .from("paper_revisions")
      .select("id, paper_id, round, revision_type, instructions, due_at, status, review_ids, responses, requested_at, started_at, submitted_at")
      .in("paper_id", paperIds);
    if (!revs?.length) return NextResponse.json({ revisions: [] });

    const byPaper = new Map();
    revs.forEach((r) => { byPaper.set(r.paper_id, [...(byPaper.get(r.paper_id) || []), r]); });
    const latest = [...byPaper.values()].map((list) => latestRevision(list));

    const reviewIds = [...new Set(latest.flatMap((r) => r.review_ids || []))];
    const [{ data: reviews }, { data: manuscripts }] = await Promise.all([
      reviewIds.length
        ? admin.from("reviews").select("id, status, comments_to_author").in("id", reviewIds)
        : Promise.resolve({ data: [] }),
      admin.from("paper_manuscripts").select("paper_id, version, original_filename, mime_type, byte_size, created_at").in("paper_id", [...byPaper.keys()]),
    ]);
    const msKey = new Map((manuscripts || []).map((m) => [`${m.paper_id}:${m.version}`, m]));
    const paperById = new Map(papers.map((p) => [p.id, p]));
    const now = new Date();

    const rows = latest
      .map((r) => ({
        paperId: r.paper_id,
        paperTitle: paperById.get(r.paper_id)?.title || null,
        paperStatus: paperById.get(r.paper_id)?.status || null,
        ...revisionForAuthor(r, reviews, msKey.get(`${r.paper_id}:${r.round}`), now),
      }))
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    return NextResponse.json({ revisions: rows });
  } catch (e) {
    console.error("revisions dashboard GET:", e?.message);
    return NextResponse.json({ error: "Could not load your revisions." }, { status: 500 });
  }
}
