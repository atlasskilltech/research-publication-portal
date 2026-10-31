// Real activity feed for the signed-in user (replaces the mock notifications).
//   admin  → recent activity on every paper, with actor names
//   others → own papers (author-safe allowlist, no actors), papers they edit
//            (actors shown except the author), and their own actions
// Shaping rules live in lib/dashboardLogic.js shapeActivityFeed().
//   GET ?limit=50 (max 100)
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { shapeActivityFeed } from "@/lib/dashboardLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id, paper_id, actor, action, detail, created_at";

export async function GET(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit")) || 50, 1), 100);

  try {
    const admin = createAdminClient();
    const [{ data: own }, { data: edits }] = await Promise.all([
      admin.from("papers").select("id").eq("submitted_by", me.id),
      admin.from("paper_assignments").select("paper_id").eq("assignee", me.id).eq("role", "EDITOR"),
    ]);
    const ownPaperIds = new Set((own || []).map((p) => p.id));
    const editedPaperIds = new Set((edits || []).map((a) => a.paper_id));

    let rows = [];
    if (me.isAdmin) {
      const { data } = await admin.from("paper_activity").select(COLS).order("created_at", { ascending: false }).limit(limit);
      rows = data || [];
    } else {
      const scoped = [...new Set([...ownPaperIds, ...editedPaperIds])];
      const [{ data: a }, { data: b }] = await Promise.all([
        scoped.length ? admin.from("paper_activity").select(COLS).in("paper_id", scoped).order("created_at", { ascending: false }).limit(limit) : Promise.resolve({ data: [] }),
        admin.from("paper_activity").select(COLS).eq("actor", me.id).order("created_at", { ascending: false }).limit(limit),
      ]);
      rows = [...(a || []), ...(b || [])];
    }

    const paperIds = [...new Set(rows.map((r) => r.paper_id))];
    const actorIds = [...new Set(rows.map((r) => r.actor).filter(Boolean))];
    const [{ data: papers }, { data: profs }] = await Promise.all([
      paperIds.length ? admin.from("papers").select("id, title, submitted_by").in("id", paperIds) : Promise.resolve({ data: [] }),
      actorIds.length && (me.isAdmin || editedPaperIds.size) ? admin.from("profiles").select("id, name, email").in("id", actorIds) : Promise.resolve({ data: [] }),
    ]);

    const feed = shapeActivityFeed(rows, {
      viewerId: me.id,
      isAdmin: !!me.isAdmin,
      ownPaperIds,
      editedPaperIds,
      submitterByPaper: new Map((papers || []).map((p) => [p.id, p.submitted_by])),
      titleByPaper: new Map((papers || []).map((p) => [p.id, p.title])),
      nameById: new Map((profs || []).map((p) => [p.id, p.name || p.email])),
    }).slice(0, limit);

    return NextResponse.json({ activity: feed });
  } catch (e) {
    console.error("activity GET:", e?.message);
    return NextResponse.json({ error: "Could not load activity." }, { status: 500 });
  }
}
