// Real activity feed for the signed-in user (replaces the mock notifications).
//   admin  → recent activity on every paper, with actor names
//   others → own papers (author-safe allowlist, no actors), papers they edit
//            (actors shown except the author), and their own actions
// Shaping rules live in lib/dashboardLogic.js shapeActivityFeed().
//   GET ?limit=50 (max 100)
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { jrows } from "@/lib/repos/rows.mjs";
import { usersByIds } from "@/lib/repos/users.mjs";
import { shapeActivityFeed } from "@/lib/dashboardLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id, paper_id, actor, action, detail, created_at";

export async function GET(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 50, 1), 100);

  try {
    const [own, edits] = await Promise.all([
      db.query(`SELECT id FROM \`${T.papers}\` WHERE submitted_by = ?`, [me.id]),
      db.query(`SELECT paper_id FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = 'EDITOR'`, [me.id]),
    ]);
    const ownPaperIds = new Set(own.map((p) => p.id));
    const editedPaperIds = new Set(edits.map((a) => a.paper_id));

    let rows = [];
    if (me.isAdmin) {
      rows = jrows(await db.query(`SELECT ${COLS} FROM \`${T.paperActivity}\` ORDER BY created_at DESC LIMIT ?`, [limit]));
    } else {
      const scoped = [...new Set([...ownPaperIds, ...editedPaperIds])];
      const [a, b] = await Promise.all([
        scoped.length
          ? db.query(`SELECT ${COLS} FROM \`${T.paperActivity}\` WHERE paper_id IN (?) ORDER BY created_at DESC LIMIT ?`, [scoped, limit])
          : Promise.resolve([]),
        db.query(`SELECT ${COLS} FROM \`${T.paperActivity}\` WHERE actor = ? ORDER BY created_at DESC LIMIT ?`, [me.id, limit]),
      ]);
      rows = jrows([...a, ...b]);
    }

    const paperIds = [...new Set(rows.map((r) => r.paper_id))];
    const actorIds = [...new Set(rows.map((r) => r.actor).filter(Boolean))];
    const [papers, profs] = await Promise.all([
      paperIds.length ? db.query(`SELECT id, title, submitted_by FROM \`${T.papers}\` WHERE id IN (?)`, [paperIds]) : Promise.resolve([]),
      actorIds.length && (me.isAdmin || editedPaperIds.size) ? usersByIds(db, actorIds) : Promise.resolve(new Map()),
    ]);

    const feed = shapeActivityFeed(rows, {
      viewerId: me.id,
      isAdmin: !!me.isAdmin,
      ownPaperIds,
      editedPaperIds,
      submitterByPaper: new Map(papers.map((p) => [p.id, p.submitted_by])),
      titleByPaper: new Map(papers.map((p) => [p.id, p.title])),
      nameById: new Map([...profs.values()].map((p) => [p.id, p.name || p.email])),
    }).slice(0, limit);

    return NextResponse.json({ activity: feed });
  } catch (e) {
    console.error("activity GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load activity." }, { status: 500 });
  }
}
