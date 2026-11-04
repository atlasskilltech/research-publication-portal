// Author revision dashboard: the latest revision request for each of the
// caller's OWN submissions (ownership = papers.submitted_by, the existing
// model). Reviewer feedback is reduced to anonymous comments_to_author; no
// reviewer identity, scores, recommendation or confidential comments.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { jrows } from "@/lib/repos/rows.mjs";
import { revisionForAuthor, latestRevision } from "@/lib/revisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const papers = await db.query(
      `SELECT id, title, status, current_round FROM \`${T.papers}\` WHERE submitted_by = ?`, [me.id]);
    const paperIds = papers.map((p) => p.id);
    if (!paperIds.length) return NextResponse.json({ revisions: [] });

    const revs = jrows(await db.query(
      `SELECT id, paper_id, round, revision_type, instructions, due_at, status, review_ids, responses, requested_at, started_at, submitted_at
         FROM \`${T.paperRevisions}\` WHERE paper_id IN (?)`,
      [paperIds],
    ));
    if (!revs.length) return NextResponse.json({ revisions: [] });

    const byPaper = new Map();
    revs.forEach((r) => { byPaper.set(r.paper_id, [...(byPaper.get(r.paper_id) || []), r]); });
    const latest = [...byPaper.values()].map((list) => latestRevision(list));

    const reviewIds = [...new Set(latest.flatMap((r) => r.review_ids || []))];
    const [reviews, manuscripts] = await Promise.all([
      reviewIds.length
        ? db.query(`SELECT id, status, comments_to_author FROM \`${T.reviews}\` WHERE id IN (?)`, [reviewIds])
        : Promise.resolve([]),
      db.query(
        `SELECT paper_id, version, original_filename, mime_type, byte_size, created_at FROM \`${T.paperManuscripts}\` WHERE paper_id IN (?)`,
        [[...byPaper.keys()]],
      ),
    ]);
    const msKey = new Map(manuscripts.map((m) => [`${m.paper_id}:${m.version}`, m]));
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
    console.error("revisions dashboard GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load your revisions." }, { status: 500 });
  }
}
