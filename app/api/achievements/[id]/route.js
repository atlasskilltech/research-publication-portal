// One faculty achievement.
//   PATCH  → Administrator review: { status: "VERIFIED" | "REJECTED" | "SUBMITTED", note? }
//            A rejection needs a note so the faculty member knows what to fix.
//   DELETE → the owner may delete a record that isn't verified yet; an
//            Administrator may delete any record. Stored files are removed
//            after the database commit.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getAchievement, setAchievementStatus, deleteAchievement } from "@/lib/repos/achievements.mjs";
import { ACHIEVEMENT_STATUSES } from "@/lib/achievementTypes";
import { deleteManuscript } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[0-9a-f-]{36}$/i;

export async function PATCH(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const status = String(body?.status || "");
  const note = String(body?.note || "").replace(/\s+/g, " ").trim();
  if (!ACHIEVEMENT_STATUSES.includes(status)) return NextResponse.json({ error: "Choose a valid status." }, { status: 422 });
  if (status === "REJECTED" && !note) return NextResponse.json({ error: "Add a short reason so the faculty member knows what to fix." }, { status: 422 });
  if (note.length > 1000) return NextResponse.json({ error: "Keep the note under 1000 characters." }, { status: 422 });

  try {
    const n = await setAchievementStatus(db, { id, status, note: note || null, reviewerId: me.id });
    if (!n) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, achievement: await getAchievement(db, id) });
  } catch (e) {
    console.error("achievement PATCH:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not update the achievement." }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const a = await getAchievement(db, id);
    if (!a || (a.ownerId !== me.id && !me.isAdmin)) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!me.isAdmin && a.status === "VERIFIED") {
      return NextResponse.json({ error: "A verified achievement can't be deleted. Ask the administrator if it needs a change." }, { status: 409 });
    }
    const keys = await db.transaction((tx) => deleteAchievement(tx, id));
    if (!keys) return NextResponse.json({ error: "Not found." }, { status: 404 });
    for (const k of keys) await deleteManuscript(k);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("achievement DELETE:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not delete the achievement." }, { status: 500 });
  }
}
