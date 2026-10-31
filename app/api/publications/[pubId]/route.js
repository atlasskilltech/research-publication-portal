// Edit a SCHEDULED publication's metadata and/or issue (admin or the paper's
// EDITOR). Published records are final. Optimistic concurrency: the caller
// sends the version it edited; a concurrent change → 409.
//   PATCH { expectedVersion, volumeId, issueId, title, abstract, authors, keywords,
//           pageStart?, pageEnd?, doi?, publicationDate?, manuscriptId?, manuscriptPublic? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPaperContext } from "@/lib/paperAccess";
import { validatePublicationMeta, issueBelongsToVolume, isUuid, dbErrorToHttp } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { pubId } = await params;
  if (!isUuid(pubId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: "Reload before editing." }, { status: 422 });
  const v = validatePublicationMeta(body);
  if (!v.ok) return NextResponse.json({ error: "Please fix the highlighted fields.", issues: v.fields }, { status: 422 });

  try {
    const admin = createAdminClient();
    const { data: pub } = await admin.from("publications").select("id, paper_id, status, version").eq("id", pubId).maybeSingle();
    if (!pub) return NextResponse.json({ error: "Publication not found." }, { status: 404 });
    const ctx = await loadPaperContext(admin, pub.paper_id, me);
    if (!ctx?.canManage) return NextResponse.json({ error: "Only an administrator or the paper's editor can edit this publication." }, { status: 403 });
    if (pub.status === "PUBLISHED") return NextResponse.json({ error: "A published record can no longer be edited." }, { status: 409 });
    if (pub.version !== expectedVersion) return NextResponse.json({ error: "This record was changed by someone else. Reload and try again." }, { status: 409 });

    const { data: issue } = await admin.from("issues").select("id, volume_id").eq("id", v.value.issueId).maybeSingle();
    if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    if (!issueBelongsToVolume(issue, v.value.volumeId)) {
      return NextResponse.json({ error: "The selected issue does not belong to the selected volume.", issues: { issueId: "Not in this volume." } }, { status: 422 });
    }

    const val = v.value;
    const { data: version, error } = await admin.rpc("update_publication", {
      p_pub: pubId, p_actor: me.id, p_expected_version: expectedVersion, p_volume: val.volumeId, p_issue: val.issueId,
      p_title: val.title, p_abstract: val.abstract, p_authors: val.authors, p_keywords: val.keywords,
      p_page_start: val.pageStart, p_page_end: val.pageEnd, p_doi: val.doi, p_pub_date: val.publicationDate,
      p_manuscript: val.manuscriptId, p_manuscript_public: val.manuscriptPublic,
    });
    if (error) {
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    return NextResponse.json({ ok: true, version });
  } catch (e) {
    console.error("publication PATCH:", e?.message);
    return NextResponse.json({ error: "Could not update the publication." }, { status: 500 });
  }
}
