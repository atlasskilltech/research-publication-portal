// Create an issue inside a volume (administrators only). Duplicate issue
// number within the volume → 409. The volume must exist.
//   POST { volumeId, issueNumber, title, description?, publicationDate? }
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageVolumes, validateIssue, dbErrorToHttp } from "@/lib/publicationLogic";

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
    const admin = createAdminClient();
    const { data: vol } = await admin.from("volumes").select("id").eq("id", v.value.volume_id).maybeSingle();
    if (!vol) return NextResponse.json({ error: "Volume not found." }, { status: 404 });
    const { data, error } = await admin.from("issues").insert({ ...v.value, created_by: me.id }).select("id").single();
    if (error) {
      const http = dbErrorToHttp(error);
      if (http) return NextResponse.json({ error: http.error }, { status: http.status });
      throw error;
    }
    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (e) {
    console.error("issues POST:", e?.message);
    return NextResponse.json({ error: "Could not create the issue." }, { status: 500 });
  }
}
