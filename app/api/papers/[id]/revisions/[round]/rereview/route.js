// Manager (admin / paper EDITOR) releases a SUBMITTED revision to the assigned
// reviewers: REVISION_SUBMITTED → REVISION_UNDER_REVIEW, paper back to
// UNDER_REVIEW, optional new review deadline for every reviewer assignment.
// Only after this can reviewers download the revised version and review the
// new round. Transactional via start_revision_rereview() (0007).
//   POST { dueAt?: ISO date }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyLater } from "@/lib/notifyServer";
import { loadPaperContext } from "@/lib/paperAccess";
import { canTransition, RS, mapRpcError } from "@/lib/revisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, round: roundParam } = await params;
  const round = Number(roundParam);
  if (!Number.isInteger(round) || round < 1) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let dueAt = null;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.dueAt) {
      const d = new Date(body.dueAt);
      if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        return NextResponse.json({ error: "The review deadline must be a future date." }, { status: 422 });
      }
      dueAt = d.toISOString();
    }
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const ctx = await loadPaperContext(admin, id, me);
    if (!ctx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!ctx.canManage) return NextResponse.json({ error: "Only an administrator or the paper's editor can start a re-review." }, { status: 403 });
    const rev = ctx.revisions.find((r) => r.round === round);
    if (!rev) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!canTransition(rev.status, RS.UNDER_REVIEW, "manager")) {
      return NextResponse.json({ error: "The author has not submitted this revision yet." }, { status: 409 });
    }

    const { error } = await admin.rpc("start_revision_rereview", { p_paper: id, p_round: round, p_actor: me.id, p_due: dueAt });
    if (error) {
      const mapped = mapRpcError(error);
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      throw error;
    }
    notifyLater("REREVIEW_REQUESTED", { paperId: id, actorId: me.id, round, dueAt });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("rereview POST:", e?.message);
    return NextResponse.json({ error: "Could not start the re-review." }, { status: 500 });
  }
}
