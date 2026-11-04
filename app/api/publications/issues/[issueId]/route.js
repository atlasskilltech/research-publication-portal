// Edit an issue (administrators only).
//   PATCH { issueNumber, title, description, publicationDate } → metadata (not once
//          PUBLISHED; an issue never moves to another volume)
//   PATCH { status, publishPapers? } → setIssueStatus (lib/services/workflow.mjs);
//          publishing requires a PUBLISHED volume and can publish all SCHEDULED
//          papers in one transaction.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T, isDuplicate } from "@/lib/db";
import { notifyLater } from "@/lib/notifyServer";
import { setIssueStatus } from "@/lib/services/workflow.mjs";
import { canManageVolumes, validateIssue, canTransitionContainer, canPublishIssue, isUuid, dbErrorToHttp } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canManageVolumes(me)) return NextResponse.json({ error: "Only administrators can manage issues." }, { status: 403 });
  const { issueId } = await params;
  if (!isUuid(issueId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  try {
    const issue = await db.one(`SELECT id, volume_id, status FROM \`${T.issues}\` WHERE id = ?`, [issueId]);
    if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });

    if (body?.status !== undefined) {
      const to = String(body.status).toUpperCase();
      if (!canTransitionContainer(issue.status, to)) {
        return NextResponse.json({ error: issue.status === "PUBLISHED" ? "A published issue cannot change status." : "Invalid status change." }, { status: 409 });
      }
      if (to === "PUBLISHED") {
        const volume = await db.one(`SELECT id, status FROM \`${T.volumes}\` WHERE id = ?`, [issue.volume_id]);
        const pre = canPublishIssue(issue, volume);
        if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status });
      }
      // Papers this call may publish (to notify their authors afterwards).
      const queued = body?.publishPapers === true && to === "PUBLISHED"
        ? await db.query(`SELECT id, paper_id FROM \`${T.publications}\` WHERE issue_id = ? AND status = 'SCHEDULED'`, [issueId])
        : [];
      let published;
      try {
        published = await setIssueStatus(db, { issueId, actorId: me.id, status: to, publishPapers: body?.publishPapers === true });
      } catch (error) {
        const http = dbErrorToHttp(error);
        if (http) return NextResponse.json({ error: http.error }, { status: http.status });
        throw error;
      }
      if (published > 0 && queued.length) {
        const done = await db.query(
          `SELECT id, paper_id FROM \`${T.publications}\` WHERE id IN (?) AND status = 'PUBLISHED'`, [queued.map((q) => q.id)]);
        for (const p of done) notifyLater("PAPER_PUBLISHED", { paperId: p.paper_id, actorId: me.id, publicPath: `/publications/${p.id}` });
      }
      return NextResponse.json({ ok: true, papersPublished: published || 0 });
    }

    if (issue.status === "PUBLISHED") return NextResponse.json({ error: "A published issue can no longer be edited." }, { status: 409 });
    const v = validateIssue(body, { requireVolume: false });
    if (!v.ok) return NextResponse.json({ error: "Please fix the highlighted fields.", issues: v.fields }, { status: 422 });
    let upd;
    try {
      upd = await db.exec(
        `UPDATE \`${T.issues}\` SET issue_number = ?, title = ?, description = ?, publication_date = ? WHERE id = ? AND status <> 'PUBLISHED'`,
        [v.value.issue_number, v.value.title, v.value.description ?? "", v.value.publication_date || null, issueId],
      );
    } catch (error) {
      if (isDuplicate(error)) return NextResponse.json({ error: "This volume already has an issue with that number." }, { status: 409 });
      throw error;
    }
    if (upd.affectedRows !== 1) return NextResponse.json({ error: "A published issue can no longer be edited." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("issue PATCH:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not update the issue." }, { status: 500 });
  }
}
