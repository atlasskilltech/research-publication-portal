// Edit a SCHEDULED publication's metadata and/or issue (admin or the paper's
// EDITOR). Published records are final. Optimistic concurrency: the caller
// sends the version it edited; a concurrent change → 409.
//   PATCH { expectedVersion, volumeId, issueId, title, abstract, authors, keywords,
//           pageStart?, pageEnd?, doi?, publicationDate?, manuscriptId?, manuscriptPublic? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T, isDuplicate } from "@/lib/db";
import { loadPaperContext } from "@/lib/paperAccess";
import { updatePublication } from "@/lib/services/workflow.mjs";
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
    const pub = await db.one(`SELECT id, paper_id, status, version FROM \`${T.publications}\` WHERE id = ?`, [pubId]);
    if (!pub) return NextResponse.json({ error: "Publication not found." }, { status: 404 });
    const ctx = await loadPaperContext(db, pub.paper_id, me);
    if (!ctx?.canManage) return NextResponse.json({ error: "Only an administrator or the paper's editor can edit this publication." }, { status: 403 });
    if (pub.status === "PUBLISHED") return NextResponse.json({ error: "A published record can no longer be edited." }, { status: 409 });
    if (pub.version !== expectedVersion) return NextResponse.json({ error: "This record was changed by someone else. Reload and try again." }, { status: 409 });

    const issue = await db.one(`SELECT id, volume_id FROM \`${T.issues}\` WHERE id = ?`, [v.value.issueId]);
    if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });
    if (!issueBelongsToVolume(issue, v.value.volumeId)) {
      return NextResponse.json({ error: "The selected issue does not belong to the selected volume.", issues: { issueId: "Not in this volume." } }, { status: 422 });
    }

    const val = v.value;
    let version;
    try {
      version = await updatePublication(db, {
        pubId, actorId: me.id, expectedVersion, volumeId: val.volumeId, issueId: val.issueId,
        title: val.title, abstract: val.abstract, authors: val.authors, keywords: val.keywords,
        pageStart: val.pageStart, pageEnd: val.pageEnd, doi: val.doi, publicationDate: val.publicationDate,
        manuscriptId: val.manuscriptId, manuscriptPublic: val.manuscriptPublic,
      });
    } catch (error) {
      // The only unique key an update can hit is the DOI.
      if (isDuplicate(error)) return NextResponse.json({ error: "Another publication already uses this DOI." }, { status: 409 });
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    return NextResponse.json({ ok: true, version });
  } catch (e) {
    console.error("publication PATCH:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not update the publication." }, { status: 500 });
  }
}
