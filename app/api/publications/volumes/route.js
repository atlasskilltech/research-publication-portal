// Create a volume (administrators only). Duplicate (year, volume number) → 409
// via the unique key. New volumes start as DRAFT.
//   POST { volumeNumber, year, title, description? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T, isDuplicate } from "@/lib/db";
import { uuid } from "@/lib/auth/crypto.mjs";
import { canManageVolumes, validateVolume } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canManageVolumes(me)) return NextResponse.json({ error: "Only administrators can manage volumes." }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const v = validateVolume(body);
  if (!v.ok) return NextResponse.json({ error: "Please fix the highlighted fields.", issues: v.fields }, { status: 422 });

  try {
    const id = uuid();
    const val = v.value;
    try {
      await db.exec(
        `INSERT INTO \`${T.volumes}\` (id, volume_number, year, title, description, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [id, val.volume_number, val.year, val.title, val.description ?? "", me.id],
      );
    } catch (error) {
      if (isDuplicate(error)) return NextResponse.json({ error: "A volume with this number already exists for that year." }, { status: 409 });
      throw error;
    }
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    console.error("volumes POST:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not create the volume." }, { status: 500 });
  }
}
