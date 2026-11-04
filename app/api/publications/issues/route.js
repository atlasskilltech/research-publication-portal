// Create an issue inside a volume (administrators only). Duplicate issue
// number within the volume → 409. The volume must exist.
//   POST { volumeId, issueNumber, title, description?, publicationDate? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T, isDuplicate } from "@/lib/db";
import { uuid } from "@/lib/auth/crypto.mjs";
import { canManageVolumes, validateIssue } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canManageVolumes(me)) return NextResponse.json({ error: "Only administrators can manage issues." }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const v = validateIssue(body);
  if (!v.ok) return NextResponse.json({ error: "Please fix the highlighted fields.", issues: v.fields }, { status: 422 });

  try {
    const val = v.value;
    const vol = await db.one(`SELECT id FROM \`${T.volumes}\` WHERE id = ?`, [val.volume_id]);
    if (!vol) return NextResponse.json({ error: "Volume not found." }, { status: 404 });
    const id = uuid();
    try {
      await db.exec(
        `INSERT INTO \`${T.issues}\` (id, volume_id, issue_number, title, description, publication_date, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [id, val.volume_id, val.issue_number, val.title, val.description ?? "", val.publication_date || null, me.id],
      );
    } catch (error) {
      if (isDuplicate(error)) return NextResponse.json({ error: "This volume already has an issue with that number." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    console.error("issues POST:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not create the issue." }, { status: 500 });
  }
}
