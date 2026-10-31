// Schedule an ACCEPTED paper into an issue (admin or the paper's assigned
// EDITOR). Creates the publication record (status SCHEDULED) with a metadata
// snapshot; the original submission, manuscripts, reviews and decisions are
// untouched. Transactional + locked in schedule_publication() (0009), which
// re-checks: manager, communicated ACCEPT decision, not rejected / revision
// pending, no existing record (unique paper_id), issue ∈ volume, manuscript
// belongs to the paper.
//   POST { paperId, volumeId, issueId, title, abstract, authors[{name,affiliation}],
//          keywords, pageStart?, pageEnd?, doi?, publicationDate?, manuscriptId?, manuscriptPublic? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPaperContext } from "@/lib/paperAccess";
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
    const admin = createAdminClient();
    const ctx = await loadPaperContext(admin, paperId, me);
    if (!ctx) return NextResponse.json({ error: "Paper not found." }, { status: 404 });
    if (!ctx.canManage) return NextResponse.json({ error: "Only an administrator or the paper's editor can schedule its publication." }, { status: 403 });

    const { data: existing } = await admin.from("publications").select("id").eq("paper_id", paperId).maybeSingle();
    const pre = publicationEligibility({ paper: ctx.paper, decisions: ctx.decisions, revisions: ctx.revisions, existing });
    if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status });

    const { data: issue } = await admin.from("issues").select("id, volume_id").eq("id", v.value.issueId).maybeSingle();
    if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    if (!issueBelongsToVolume(issue, v.value.volumeId)) {
      return NextResponse.json({ error: "The selected issue does not belong to the selected volume.", issues: { issueId: "Not in this volume." } }, { status: 422 });
    }

    const val = v.value;
    const { data: id, error } = await admin.rpc("schedule_publication", {
      p_paper: paperId, p_actor: me.id, p_volume: val.volumeId, p_issue: val.issueId,
      p_title: val.title, p_abstract: val.abstract, p_authors: val.authors, p_keywords: val.keywords,
      p_page_start: val.pageStart, p_page_end: val.pageEnd, p_doi: val.doi, p_pub_date: val.publicationDate,
      p_manuscript: val.manuscriptId, p_manuscript_public: val.manuscriptPublic,
    });
    if (error) {
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    console.error("publications POST:", e?.message);
    return NextResponse.json({ error: "Could not schedule the publication." }, { status: 500 });
  }
}
