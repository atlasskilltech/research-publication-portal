// Create a volume (administrators only). Duplicate (year, volume number) → 409
// via the unique constraint. New volumes start as DRAFT.
//   POST { volumeNumber, year, title, description? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageVolumes, validateVolume, dbErrorToHttp } from "@/lib/publicationLogic";

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
    const admin = createAdminClient();
    const { data, error } = await admin.from("volumes").insert({ ...v.value, created_by: me.id }).select("id").single();
    if (error) {
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (e) {
    console.error("volumes POST:", e?.message);
    return NextResponse.json({ error: "Could not create the volume." }, { status: 500 });
  }
}
