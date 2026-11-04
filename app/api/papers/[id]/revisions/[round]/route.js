// Author saves (draft) or submits their point-by-point response for revision
// <round>. Only the paper's owner, only while the revision is editable.
//   PUT { responses: [{ reviewKey, comment, response, addressed }], submit?: true }
//
// Reviewer references arrive as anonymous keys (R1, R2…) and are mapped to
// review ids server-side. Final submission runs in submitPaperRevision()
// (lib/services/workflow.mjs, one transaction), which locks the revision row,
// requires this round's manuscript, and rejects a duplicate/concurrent submit
// with 409.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { saveRevisionDraft, submitPaperRevision } from "@/lib/services/workflow.mjs";
import { notifyLater } from "@/lib/notifyServer";
import { loadPaperContext } from "@/lib/paperAccess";
import { canAuthorEdit, validateResponses, mapRpcError } from "@/lib/revisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, round: roundParam } = await params;
  const round = Number(roundParam);
  if (!Number.isInteger(round) || round < 1) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const final = body?.submit === true;

  try {
    const ctx = await loadPaperContext(db, id, me);
    if (!ctx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const revision = ctx.revisions.find((r) => r.round === round);
    const gate = canAuthorEdit({ paper: ctx.paper, revision, userId: me.id });
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const v = validateResponses(body?.responses, { final, reviewIds: revision.review_ids || [] });
    if (!v.ok) return NextResponse.json({ error: v.error, issues: v.errors }, { status: 422 });

    if (final) {
      const ms = await db.one(`SELECT id FROM \`${T.paperManuscripts}\` WHERE paper_id = ? AND version = ?`, [id, round]);
      if (!ms) return NextResponse.json({ error: "Upload the revised manuscript before submitting." }, { status: 422 });
    }

    try {
      await (final ? submitPaperRevision : saveRevisionDraft)(db, { paperId: id, round, actorId: me.id, responses: v.value });
    } catch (error) {
      const mapped = mapRpcError(error);
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      throw error;
    }
    if (final) notifyLater("REVISION_SUBMITTED", { paperId: id, actorId: me.id, round });
    return NextResponse.json({ ok: true, status: final ? "REVISION_SUBMITTED" : "REVISION_IN_PROGRESS" });
  } catch (e) {
    console.error("revision PUT:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not save the revision." }, { status: 500 });
  }
}
