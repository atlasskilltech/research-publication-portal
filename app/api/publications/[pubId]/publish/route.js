// Publish one SCHEDULED paper (admin or the paper's EDITOR). Its issue must be
// PUBLISHED (which requires a PUBLISHED volume). publish_paper() (0009) locks
// the records, re-checks the paper is still ACCEPTED (not rejected / revision
// pending), sets papers.status = PUBLISHED and logs activity, atomically.
//   POST { expectedVersion }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyLater } from "@/lib/notifyServer";
import { loadPaperContext } from "@/lib/paperAccess";
import { canPublishPaper, isUuid, dbErrorToHttp } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { pubId } = await params;
  if (!isUuid(pubId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: "Reload before publishing." }, { status: 422 });

  try {
    const admin = createAdminClient();
    const { data: pub } = await admin.from("publications").select("id, paper_id, issue_id, status, version").eq("id", pubId).maybeSingle();
    if (!pub) return NextResponse.json({ error: "Publication not found." }, { status: 404 });
    const ctx = await loadPaperContext(admin, pub.paper_id, me);
    if (!ctx?.canManage) return NextResponse.json({ error: "Only an administrator or the paper's editor can publish this paper." }, { status: 403 });

    const { data: issue } = await admin.from("issues").select("id, status").eq("id", pub.issue_id).maybeSingle();
    const pre = canPublishPaper({ publication: pub, paper: ctx.paper, issue });
    if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status });
    if (pub.version !== expectedVersion) return NextResponse.json({ error: "This record was changed by someone else. Reload and try again." }, { status: 409 });

    const { error } = await admin.rpc("publish_paper", { p_pub: pubId, p_actor: me.id, p_expected_version: expectedVersion });
    if (error) {
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    notifyLater("PAPER_PUBLISHED", { paperId: pub.paper_id, actorId: me.id, publicPath: `/publications/${pubId}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("publication publish:", e?.message);
    return NextResponse.json({ error: "Could not publish the paper." }, { status: 500 });
  }
}
