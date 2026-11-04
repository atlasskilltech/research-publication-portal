// Schedule an ACCEPTED paper into an issue (admin or the paper's assigned
// EDITOR). Creates the publication record (status SCHEDULED) with a metadata
// snapshot; the original submission, manuscripts, reviews and decisions are
// untouched. Transactional + locked in schedulePublication
// (lib/services/workflow.mjs), which re-checks: manager, communicated ACCEPT
// decision, not rejected / revision pending, no existing record (unique
// paper_id), issue ∈ volume, manuscript belongs to the paper.
//   POST { paperId, volumeId, issueId, title, abstract, authors[{name,affiliation}],
//          keywords, pageStart?, pageEnd?, doi?, publicationDate?, manuscriptId?, manuscriptPublic? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T, isDuplicate } from "@/lib/db";
import { loadPaperContext } from "@/lib/paperAccess";
import { schedulePublication } from "@/lib/services/workflow.mjs";
import {
  validatePublicationMeta, publicationEligibility, issueBelongsToVolume, isUuid, dbErrorToHttp,
} from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const paperId = String(body?.paperId || "");
  if (!isUuid(paperId)) return NextResponse.json({ error: "Choose a paper." }, { status: 422 });
  const v = validatePublicationMeta(body);
  if (!v.ok) return NextResponse.json({ error: "Please fix the highlighted fields.", issues: v.fields }, { status: 422 });

  try {
    const ctx = await loadPaperContext(db, paperId, me);
    if (!ctx) return NextResponse.json({ error: "Paper not found." }, { status: 404 });
    if (!ctx.canManage) return NextResponse.json({ error: "Only an administrator or the paper's editor can schedule its publication." }, { status: 403 });

    const existing = await db.one(`SELECT id FROM \`${T.publications}\` WHERE paper_id = ?`, [paperId]);
    const pre = publicationEligibility({ paper: ctx.paper, decisions: ctx.decisions, revisions: ctx.revisions, existing });
    if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status });

    const issue = await db.one(`SELECT id, volume_id FROM \`${T.issues}\` WHERE id = ?`, [v.value.issueId]);
    if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    if (!issueBelongsToVolume(issue, v.value.volumeId)) {
      return NextResponse.json({ error: "The selected issue does not belong to the selected volume.", issues: { issueId: "Not in this volume." } }, { status: 422 });
    }

    const val = v.value;
    let id;
    try {
      id = await schedulePublication(db, {
        paperId, actorId: me.id, volumeId: val.volumeId, issueId: val.issueId,
        title: val.title, abstract: val.abstract, authors: val.authors, keywords: val.keywords,
        pageStart: val.pageStart, pageEnd: val.pageEnd, doi: val.doi, publicationDate: val.publicationDate,
        manuscriptId: val.manuscriptId, manuscriptPublic: val.manuscriptPublic,
      });
    } catch (error) {
      // The paper_id duplicate is pre-checked under lock (ALREADY_SCHEDULED), so a
      // unique violation here is the DOI.
      if (isDuplicate(error)) return NextResponse.json({ error: "Another publication already uses this DOI." }, { status: 409 });
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    console.error("publications POST:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not schedule the publication." }, { status: 500 });
  }
}
