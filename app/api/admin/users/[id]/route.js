// Admin-only: change a user's base account type (Student ↔ Faculty).
//
// Scope is deliberately narrow. This endpoint NEVER changes is_admin — admin
// rights are granted only by the server-side provisioning script — so it cannot
// be used to promote anyone (including the caller) to administrator, and the two
// existing admins keep their permissions untouched. Authorization is enforced
// from the session cookie; the write uses the service role, which is not the
// `authenticated` role the escalation trigger guards, so a legitimate base_type
// change by an admin is allowed while self-escalation through the app stays
// blocked.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  const { id } = await params;

  let baseType;
  try {
    const body = await request.json();
    baseType = String(body?.baseType || "").toUpperCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (baseType !== "STUDENT" && baseType !== "FACULTY") {
    return NextResponse.json({ error: "Choose Student or Faculty." }, { status: 422 });
  }

  try {
    const admin = createAdminClient();
    // Explicitly update only base_type — is_admin is never in the payload.
    const { data, error } = await admin
      .from("profiles")
      .update({ base_type: baseType })
      .eq("id", id)
      .select("id, base_type")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "User not found." }, { status: 404 });

    return NextResponse.json({ ok: true, baseType: data.base_type });
  } catch (e) {
    console.error("admin/users PATCH: error:", e?.status || e?.message);
    return NextResponse.json({ error: "Could not update the user." }, { status: 500 });
  }
}
