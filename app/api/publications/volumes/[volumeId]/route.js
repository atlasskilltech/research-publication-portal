// Edit a volume (administrators only).
//   PATCH { volumeNumber, year, title, description }  → metadata (not once PUBLISHED)
//   PATCH { status: DRAFT|SCHEDULED|PUBLISHED }       → status via setVolumeStatus (lib/services/workflow.mjs)
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T, isDuplicate } from "@/lib/db";
import { setVolumeStatus } from "@/lib/services/workflow.mjs";
import { canManageVolumes, validateVolume, canTransitionContainer, isUuid, dbErrorToHttp } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canManageVolumes(me)) return NextResponse.json({ error: "Only administrators can manage volumes." }, { status: 403 });
  const { volumeId } = await params;
  if (!isUuid(volumeId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  try {
    const vol = await db.one(`SELECT id, status FROM \`${T.volumes}\` WHERE id = ?`, [volumeId]);
    if (!vol) return NextResponse.json({ error: "Volume not found." }, { status: 404 });

    if (body?.status !== undefined) {
      const to = String(body.status).toUpperCase();
      if (!canTransitionContainer(vol.status, to)) {
        return NextResponse.json({ error: vol.status === "PUBLISHED" ? "A published volume cannot change status." : "Invalid status change." }, { status: 409 });
      }
      try {
        await setVolumeStatus(db, { volumeId, actorId: me.id, status: to });
      } catch (error) {
        const http = dbErrorToHttp(error);
        if (http) return NextResponse.json({ error: http.error }, { status: http.status });
        throw error;
      }
      return NextResponse.json({ ok: true });
    }

    if (vol.status === "PUBLISHED") return NextResponse.json({ error: "A published volume can no longer be edited." }, { status: 409 });
    const v = validateVolume(body);
    if (!v.ok) return NextResponse.json({ error: "Please fix the highlighted fields.", issues: v.fields }, { status: 422 });
    const val = v.value;
    let upd;
    try {
      // Conditional on still not published (guards a concurrent publish).
      upd = await db.exec(
        `UPDATE \`${T.volumes}\` SET volume_number = ?, year = ?, title = ?, description = ? WHERE id = ? AND status <> 'PUBLISHED'`,
        [val.volume_number, val.year, val.title, val.description ?? "", volumeId],
      );
    } catch (error) {
      if (isDuplicate(error)) return NextResponse.json({ error: "A volume with this number already exists for that year." }, { status: 409 });
      throw error;
    }
    if (upd.affectedRows !== 1) return NextResponse.json({ error: "A published volume can no longer be edited." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("volume PATCH:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not update the volume." }, { status: 500 });
  }
}
