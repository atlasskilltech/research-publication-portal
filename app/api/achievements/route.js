// Faculty achievements (replaces the Google Forms — see lib/achievementTypes.js).
//
//   GET  /api/achievements                → the signed-in user's records: their
//        own, plus records that list them as a contributor (by email)
//   GET  /api/achievements?scope=all&…    → every record (Administrator only),
//        filters: type, school, status, year ("2026-27", 1 July – 30 June),
//        proof=link (proof is still only a Google Drive link), source=import
//   POST /api/achievements                → create a record. Multipart form:
//        type, school, affiliation, values (JSON object of the type's fields),
//        and files under `file_<slot>` (one or more per slot).
//
// Security: identity from the session, never the client. External AUTHOR
// accounts (AIDC 2026) have no access. Fields are validated against the type
// definition; every file is checked by its leading bytes, stored under a random
// key in the private store, and the rows are written in one transaction — if it
// fails, the stored files are deleted.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { uuid } from "@/lib/auth/crypto.mjs";
import { listAchievements, insertAchievement, getOrcid } from "@/lib/repos/achievements.mjs";
import { ACHIEVEMENT_TYPES, ACHIEVEMENT_SCHOOLS, validateAchievement, validateFileCounts } from "@/lib/achievementTypes";
import { uploadTooLarge, collectFiles, prepareFiles, storeFiles, removeStored } from "@/lib/achievementUploads";
import { canUseAchievements, adminFilters } from "@/lib/achievementAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOTAL_FILES = 10;

export async function GET(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canUseAchievements(me)) return NextResponse.json({ error: "Achievements are for ATLAS faculty and students." }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const all = sp.get("scope") === "all";
  if (all && !me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const filters = all ? adminFilters(sp).filters : { viewer: { id: me.id, email: me.email } };

  try {
    const items = await listAchievements(db, filters);
    const [profile, orcid] = await Promise.all([
      db.one(`SELECT schoolCode AS school FROM \`${T.users}\` WHERE id = ?`, [me.id]),
      getOrcid(db, me.id),
    ]);
    const email = String(me.email || "").toLowerCase();
    return NextResponse.json({
      achievements: items.map((a) => {
        const mine = a.ownerId === me.id;
        const shared = !mine && a.contributors.some((c) => c.email === email);
        return { ...a, mine, shared, canUpload: mine || shared || !!me.isAdmin, canDelete: (mine && a.status !== "VERIFIED") || !!me.isAdmin };
      }),
      me: {
        name: me.name, email: me.email, isAdmin: !!me.isAdmin, orcid,
        school: ACHIEVEMENT_SCHOOLS.includes(profile?.school) ? profile.school : null,
      },
    });
  } catch (e) {
    console.error("achievements GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load achievements." }, { status: 500 });
  }
}

export async function POST(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canUseAchievements(me)) return NextResponse.json({ error: "Achievements are for ATLAS faculty and students." }, { status: 403 });

  if (uploadTooLarge(request.headers)) {
    return NextResponse.json({ error: "The upload is too large. Each file can be at most 10 MB." }, { status: 413 });
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form submission." }, { status: 400 });
  }

  // ---- Fields ---------------------------------------------------------------
  const type = String(form.get("type") || "");
  let values = {};
  try {
    const raw = form.get("values");
    values = typeof raw === "string" && raw ? JSON.parse(raw) : {};
    if (!values || typeof values !== "object" || Array.isArray(values)) values = {};
  } catch {
    return NextResponse.json({ error: "The form data is malformed." }, { status: 400 });
  }
  const checked = validateAchievement(type, { school: form.get("school"), affiliation: form.get("affiliation"), values });
  if (!checked.ok) {
    return NextResponse.json({ error: "Please check the highlighted fields.", issues: checked.issues }, { status: 422 });
  }
  const def = ACHIEVEMENT_TYPES[type];

  // ---- Files ----------------------------------------------------------------
  const { counts, incoming } = collectFiles(form);
  const fileIssues = validateFileCounts(type, counts);
  if (Object.keys(fileIssues).length || incoming.length > MAX_TOTAL_FILES) {
    return NextResponse.json({ error: "Please check the attached documents.", issues: fileIssues }, { status: 422 });
  }
  const prep = await prepareFiles(def, incoming);
  if (!prep.ok) return NextResponse.json({ error: prep.error, issues: prep.issues }, { status: 422 });

  // ---- Store files, then write rows in one transaction ----------------------
  const stored = await storeFiles(prep.prepared, "achievements POST");
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 500 });

  const id = uuid();
  try {
    await db.transaction((tx) => insertAchievement(tx, { id, userId: me.id, data: checked.data, files: prep.prepared }));
  } catch (e) {
    console.error("achievements POST: db:", e?.code || e?.message);
    await removeStored(stored.keys);
    return NextResponse.json({ error: "Could not save the achievement. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
