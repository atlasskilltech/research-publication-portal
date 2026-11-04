// Editorial decisions for one paper.
//   GET  — manager (admin / paper EDITOR): full history incl. drafts,
//          confidential notes, decision makers.
//          owner (author): RELEASED decisions only — outcome, date, editor's
//          message, anonymous released reviewer comments, next action,
//          revision deadline. Never confidential notes or identities.
//          anyone else (incl. reviewers): 404.
//   POST — manager saves (creates/updates) the current round's UNRELEASED
//          decision via saveEditorialDecision (lib/services/workflow.mjs, one
//          transaction). Communicating it is a separate step:
//          POST .../decisions/[decisionId]/release.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { usersByIds } from "@/lib/repos/users.mjs";
import { loadPaperContext } from "@/lib/paperAccess";
import { validateDecision, decisionForAuthor, decisionForManager } from "@/lib/decisionLogic";
import { saveDecision } from "@/lib/decisionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const ctx = await loadPaperContext(db, id, me);
    if (!ctx || (!ctx.canManage && !ctx.isOwner)) return NextResponse.json({ error: "Not found." }, { status: 404 });

    if (ctx.canManage) {
      const people = [...new Set(ctx.decisions.flatMap((d) => [d.decided_by, d.released_by]).filter(Boolean))];
      const nameById = new Map();
      (await usersByIds(db, people)).forEach((p) => nameById.set(p.id, p.name || p.email));
      return NextResponse.json({
        view: "manager",
        paperStatus: ctx.paper.status,
        currentRound: ctx.paper.current_round,
        decisions: ctx.decisions.map((d) => decisionForManager(d, nameById)),
      });
    }

    // Author: released decisions only.
    const released = ctx.decisions.filter((d) => d.released_at);
    const reviewIds = [...new Set(released.flatMap((d) => d.review_ids || []))];
    const reviews = reviewIds.length
      ? await db.query(`SELECT id, status, comments_to_author FROM \`${T.reviews}\` WHERE id IN (?)`, [reviewIds])
      : [];
    const revById = new Map(ctx.revisions.map((r) => [r.id, r]));
    const now = new Date();
    return NextResponse.json({
      view: "author",
      paperStatus: ctx.paper.status,
      decisions: released
        .map((d) => decisionForAuthor(d, reviews, d.revision_id ? revById.get(d.revision_id) : null, now))
        .reverse(), // newest first
    });
  } catch (e) {
    console.error("decisions GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load decisions." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const v = validateDecision(body);
  if (!v.ok) return NextResponse.json({ error: "Please complete the decision.", issues: v.fields }, { status: 422 });

  try {
    const result = await saveDecision(id, me, v.value);
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("decisions POST:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not save the decision." }, { status: 500 });
  }
}
