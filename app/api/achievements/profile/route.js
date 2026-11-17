// The signed-in user's ORCID iD (shown on My achievements).
//   PUT { orcid } → save (an iD or a profile link; checked with its checksum),
//   PUT { orcid: "" } → remove it.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { setOrcid } from "@/lib/repos/achievements.mjs";
import { normalizeOrcid } from "@/lib/achievementTypes";
import { canUseAchievements } from "@/lib/achievementAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canUseAchievements(me)) return NextResponse.json({ error: "Achievements are for ATLAS faculty and students." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const raw = String(body?.orcid ?? "").trim();
  const orcid = raw ? normalizeOrcid(raw) : null;
  if (raw && !orcid) return NextResponse.json({ error: "That isn't a valid ORCID iD. It looks like 0000-0002-1825-0097." }, { status: 422 });
  try {
    await setOrcid(db, me.id, orcid);
    return NextResponse.json({ ok: true, orcid });
  } catch (e) {
    console.error("achievements profile PUT:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not save your ORCID iD." }, { status: 500 });
  }
}
