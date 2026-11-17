// Upload proof to an EXISTING achievement — mainly for imported entries whose
// proof is still only a Google Drive link. Multipart form: `file_<slot>` parts.
// Allowed for the owner, a contributor named on the entry (matched by email),
// and the Administrator. A slot never goes over its file limit. The status is
// not changed: the reviewer still checks the entry as before.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getAchievement, addFiles } from "@/lib/repos/achievements.mjs";
import { ACHIEVEMENT_TYPES } from "@/lib/achievementTypes";
import { canUseAchievements } from "@/lib/achievementAccess";
import { uploadTooLarge, collectFiles, prepareFiles, storeFiles, removeStored } from "@/lib/achievementUploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canUseAchievements(me)) return NextResponse.json({ error: "Achievements are for ATLAS faculty and students." }, { status: 403 });
  const { id } = await params;
  if (!ID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Authorize BEFORE reading the (possibly large) body.
  let a;
  try {
    a = await getAchievement(db, id);
  } catch (e) {
    console.error("achievement files POST:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not upload the documents." }, { status: 500 });
  }
  const email = String(me.email || "").toLowerCase();
  const allowed = a && (a.ownerId === me.id || me.isAdmin || a.contributors.some((c) => c.email === email));
  if (!allowed) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const def = ACHIEVEMENT_TYPES[a.type];

  if (uploadTooLarge(request.headers)) {
    return NextResponse.json({ error: "The upload is too large. Each file can be at most 10 MB." }, { status: 413 });
  }
  let form;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const { counts, incoming } = collectFiles(form);
  if (!incoming.length) return NextResponse.json({ error: "Choose a file to upload." }, { status: 422 });
  for (const [slot, n] of Object.entries(counts)) {
    const rule = def.files.find((s) => s.slot === slot);
    if (!rule) return NextResponse.json({ error: "Unexpected file.", issues: { [`file_${slot}`]: "Unexpected file." } }, { status: 422 });
    const have = a.files.filter((f) => f.slot === slot).length;
    if (have + n > rule.max) {
      const left = Math.max(0, rule.max - have);
      return NextResponse.json({
        error: left ? `You can add ${left} more file${left === 1 ? "" : "s"} here.` : "This document is already uploaded.",
        issues: { [`file_${slot}`]: left ? `At most ${rule.max} file${rule.max === 1 ? "" : "s"} here.` : "Already uploaded." },
      }, { status: 422 });
    }
  }
  const prep = await prepareFiles(def, incoming);
  if (!prep.ok) return NextResponse.json({ error: prep.error, issues: prep.issues }, { status: 422 });

  const stored = await storeFiles(prep.prepared, "achievement files POST");
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 500 });
  try {
    await db.transaction((tx) => addFiles(tx, id, prep.prepared));
  } catch (e) {
    console.error("achievement files POST: db:", e?.code || e?.message);
    await removeStored(stored.keys);
    return NextResponse.json({ error: "Could not save the documents. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, achievement: await getAchievement(db, id) }, { status: 201 });
}
