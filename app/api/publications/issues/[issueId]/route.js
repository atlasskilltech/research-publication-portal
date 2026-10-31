// Edit an issue (administrators only).
//   PATCH { issueNumber, title, description, publicationDate } → metadata (not once
//          PUBLISHED; an issue never moves to another volume)
//   PATCH { status, publishPapers? } → set_issue_status(); publishing requires a
//          PUBLISHED volume and can publish all SCHEDULED papers in one transaction.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyLater } from "@/lib/notifyServer";
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
    const admin = createAdminClient();
    const { data: issue } = await admin.from("issues").select("id, volume_id, status").eq("id", issueId).maybeSingle();
    if (!issue) return NextResponse.json({ error: "Issue not found." }, { status: 404 });

    if (body?.status !== undefined) {
      const to = String(body.status).toUpperCase();
      if (!canTransitionContainer(issue.status, to)) {
        return NextResponse.json({ error: issue.status === "PUBLISHED" ? "A published issue cannot change status." : "Invalid status change." }, { status: 409 });
      }
      if (to === "PUBLISHED") {
        const { data: volume } = await admin.from("volumes").select("id, status").eq("id", issue.volume_id).maybeSingle();
        const pre = canPublishIssue(issue, volume);
        if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status });
      }
      // Papers this call may publish (to notify their authors afterwards).
      const { data: queued } = body?.publishPapers === true && to === "PUBLISHED"
        ? await admin.from("publications").select("id, paper_id").eq("issue_id", issueId).eq("status", "SCHEDULED")
        : { data: [] };
      const { data: published, error } = await admin.rpc("set_issue_status", {
        p_issue: issueId, p_actor: me.id, p_status: to, p_publish_papers: body?.publishPapers === true,
      });
      if (error) {
        const http = dbErrorToHttp(error);
        if (http) return NextResponse.json({ error: http.error }, { status: http.status });
        throw error;
      }
      if (published > 0 && queued?.length) {
        const { data: done } = await admin.from("publications").select("id, paper_id").in("id", queued.map((q) => q.id)).eq("status", "PUBLISHED");
        for (const p of done || []) notifyLater("PAPER_PUBLISHED", { paperId: p.paper_id, actorId: me.id, publicPath: `/publications/${p.id}` });
      }
      return NextResponse.json({ ok: true, papersPublished: published || 0 });
    }

    if (issue.status === "PUBLISHED") return NextResponse.json({ error: "A published issue can no longer be edited." }, { status: 409 });
    const v = validateIssue(body, { requireVolume: false });
    if (!v.ok) return NextResponse.json({ error: "Please fix the highlighted fields.", issues: v.fields }, { status: 422 });
    const meta = { issue_number: v.value.issue_number, title: v.value.title, description: v.value.description, publication_date: v.value.publication_date };
    const { data: upd, error } = await admin.from("issues").update(meta).eq("id", issueId).neq("status", "PUBLISHED").select("id");
    if (error) {
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    if (!upd?.length) return NextResponse.json({ error: "A published issue can no longer be edited." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("issue PATCH:", e?.message);
    return NextResponse.json({ error: "Could not update the issue." }, { status: 500 });
  }
}
