// Admin-only user management for a single account:
//   PATCH  — change base type (Student↔Faculty) and/or grant/revoke admin
//   DELETE — permanently delete the Auth user (profile cascades via FK)
//
// Authorization is enforced from the SESSION (never a client-provided is_admin):
// the caller must be a signed-in admin. Writes use the service role, which is
// not the `authenticated` role the escalation trigger guards, so a legitimate
// change by an admin is allowed while self-escalation through the app stays
// blocked. All the "who/what is allowed" rules live in lib/adminGuards.js and
// are enforced here against authoritative server-side state (the target row and
// the live admin count).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { protectedAdminEmails } from "@/lib/config/env";
import { canSetAdmin, canDeleteUser } from "@/lib/adminGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const me = await getSessionUser();
  if (!me) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!me.isAdmin) return { error: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }) };
  return { me };
}

async function countAdmins(admin) {
  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_admin", true);
  return count ?? 0;
}

async function getTarget(admin, id) {
  const { data } = await admin
    .from("profiles")
    .select("id, email, is_admin, base_type")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function PATCH(request, { params }) {
  const { me, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const wantsBaseType = body?.baseType !== undefined;
  const wantsAdmin = body?.isAdmin !== undefined;
  if (!wantsBaseType && !wantsAdmin) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
  }

  const baseType = wantsBaseType ? String(body.baseType).toUpperCase() : null;
  if (wantsBaseType && baseType !== "STUDENT" && baseType !== "FACULTY") {
    return NextResponse.json({ error: "Choose Student or Faculty." }, { status: 422 });
  }
  const nextAdmin = wantsAdmin ? body.isAdmin === true : null;

  try {
    const admin = createAdminClient();
    const target = await getTarget(admin, id);
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

    // Admin-flag change: enforce the guards against live state.
    if (wantsAdmin) {
      const verdict = canSetAdmin({
        actorId: me.id,
        target,
        next: nextAdmin,
        adminCount: await countAdmins(admin),
        protectedEmails: protectedAdminEmails(),
      });
      if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    }

    const patch = {};
    if (wantsBaseType) patch.base_type = baseType;
    if (wantsAdmin) patch.is_admin = nextAdmin;

    const { data, error: upErr } = await admin
      .from("profiles")
      .update(patch)
      .eq("id", id)
      .select("id, base_type, is_admin")
      .maybeSingle();
    if (upErr) throw upErr;
    if (!data) return NextResponse.json({ error: "User not found." }, { status: 404 });

    return NextResponse.json({ ok: true, baseType: data.base_type, isAdmin: data.is_admin });
  } catch (e) {
    console.error("admin/users PATCH: error:", e?.status || e?.message);
    return NextResponse.json({ error: "Could not update the user." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const { me, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const target = await getTarget(admin, id);
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

    const verdict = canDeleteUser({
      actorId: me.id,
      target,
      adminCount: await countAdmins(admin),
      protectedEmails: protectedAdminEmails(),
    });
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

    // Delete the Auth user; public.profiles is removed by the ON DELETE CASCADE
    // foreign key (profiles.id → auth.users.id), so no orphan can remain.
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) throw delErr;

    // Belt-and-braces: confirm the profile is gone (cascade). If somehow present,
    // remove it explicitly so we never leave an orphan.
    const leftover = await getTarget(admin, id);
    if (leftover) await admin.from("profiles").delete().eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("admin/users DELETE: error:", e?.status || e?.message);
    return NextResponse.json({ error: "Could not delete the user." }, { status: 500 });
  }
}
