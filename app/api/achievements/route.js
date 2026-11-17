// Faculty achievements (replaces the five Google Forms — see lib/achievementTypes.js).
//
//   GET  /api/achievements                → the signed-in user's own records
//   GET  /api/achievements?scope=all&…    → every record (Administrator only),
//        filters: type, school, status, year ("2026-27", 1 July – 30 June)
//   POST /api/achievements                → create a record. Multipart form:
//        type, school, affiliation, values (JSON object of the type's fields),
//        and files under `file_<slot>` (one or more per slot).
//
// Security: identity from the session, never the client. External AUTHOR
// accounts (AIDC 2026) have no access. Fields are validated against the type
// definition; every file is checked by its leading bytes (shared upload
// validator), stored under a random key in the private store, and the rows are
// written in one transaction — if it fails, the stored files are deleted.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { uuid } from "@/lib/auth/crypto.mjs";
import { listAchievements, insertAchievement } from "@/lib/repos/achievements.mjs";
import {
  ACHIEVEMENT_TYPES, ACHIEVEMENT_SCHOOLS, ACHIEVEMENT_STATUSES, ACH_MAX_FILE_BYTES,
  validateAchievement, validateFileCounts, academicYearRange,
} from "@/lib/achievementTypes";
import { validateUpload, newStorageKey, sha256, ALLOWED } from "@/lib/manuscriptFiles";
import { saveManuscript, deleteManuscript, storageErrorReason } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TOTAL_FILES = 5 * 2;
const MAX_REQUEST_BYTES = 5 * ACH_MAX_FILE_BYTES + 1024 * 1024;

function canUse(me) {
  return me && me.baseType !== "AUTHOR";
}

export async function GET(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canUse(me)) return NextResponse.json({ error: "Achievements are for ATLAS faculty and students." }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const all = sp.get("scope") === "all";
  if (all && !me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  const filters = {};
  if (all) {
    const type = sp.get("type");
    const school = sp.get("school");
    const status = sp.get("status");
    const year = sp.get("year");
    if (type && ACHIEVEMENT_TYPES[type]) filters.type = type;
    if (school && ACHIEVEMENT_SCHOOLS.includes(school)) filters.school = school;
    if (status && ACHIEVEMENT_STATUSES.includes(status)) filters.status = status;
    const range = academicYearRange(year);
    if (range) Object.assign(filters, range);
  } else {
    filters.ownerId = me.id;
  }

  try {
    const items = await listAchievements(db, filters);
    const profile = await db.one(`SELECT schoolCode AS school FROM \`${T.users}\` WHERE id = ?`, [me.id]);
    return NextResponse.json({
      achievements: items.map((a) => ({ ...a, mine: a.ownerId === me.id })),
      me: { name: me.name, email: me.email, school: ACHIEVEMENT_SCHOOLS.includes(profile?.school) ? profile.school : null, isAdmin: !!me.isAdmin },
    });
  } catch (e) {
    console.error("achievements GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load achievements." }, { status: 500 });
  }
}

export async function POST(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canUse(me)) return NextResponse.json({ error: "Achievements are for ATLAS faculty and students." }, { status: 403 });

  const len = Number(request.headers.get("content-length"));
  if (!Number.isFinite(len) || len <= 0 || len > MAX_REQUEST_BYTES) {
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
  const counts = {};
  const incoming = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("file_") || typeof value?.arrayBuffer !== "function" || !value.size) continue;
    const slot = name.slice(5);
    counts[slot] = (counts[slot] || 0) + 1;
    incoming.push({ slot, file: value });
  }
  const fileIssues = validateFileCounts(type, counts);
  if (Object.keys(fileIssues).length || incoming.length > MAX_TOTAL_FILES) {
    return NextResponse.json({ error: "Please check the attached documents.", issues: fileIssues }, { status: 422 });
  }

  const prepared = [];
  for (const { slot, file } of incoming) {
    const rule = def.files.find((s) => s.slot === slot);
    if (file.size > ACH_MAX_FILE_BYTES) {
      return NextResponse.json({ error: `“${file.name}” is larger than 10 MB.`, issues: { [`file_${slot}`]: "Each file can be at most 10 MB." } }, { status: 422 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const verdict = validateUpload({ originalName: file.name, declaredMime: file.type, size: buffer.length, buffer });
    if (!verdict.ok || !rule.types.includes(verdict.ext)) {
      const kinds = rule.types.map((t) => t.toUpperCase()).join(" / ");
      return NextResponse.json({ error: `“${file.name}” isn't an accepted file. Use ${kinds}.`, issues: { [`file_${slot}`]: `Only ${kinds} files are accepted here.` } }, { status: 422 });
    }
    prepared.push({
      id: uuid(), slot, buffer, ext: verdict.ext, mime: ALLOWED[verdict.ext].mime,
      name: String(file.name || `document.${verdict.ext}`).slice(0, 255), size: buffer.length, sha: sha256(buffer),
    });
  }

  // ---- Store files, then write rows in one transaction ----------------------
  const stored = [];
  try {
    for (const p of prepared) {
      p.key = newStorageKey(p.ext);
      await saveManuscript(p.key, p.buffer, p.mime);
      stored.push(p.key);
    }
  } catch (e) {
    for (const k of stored) await deleteManuscript(k);
    const reason = storageErrorReason(e);
    console.error("achievements POST: storage:", reason, e?.message);
    return NextResponse.json({ error: `Could not store the documents — ${reason}.` }, { status: 500 });
  }

  const id = uuid();
  try {
    await db.transaction((tx) => insertAchievement(tx, { id, userId: me.id, data: checked.data, files: prepared }));
  } catch (e) {
    console.error("achievements POST: db:", e?.code || e?.message);
    for (const k of stored) await deleteManuscript(k);
    return NextResponse.json({ error: "Could not save the achievement. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
