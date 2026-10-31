// Admin-only user management for a single account:
//   PATCH  — change base type and/or the set of additional roles (partial: a
//            field omitted is left untouched)
//   DELETE — permanently delete the Auth user (profile + roles cascade)
//
// Authorization is enforced from the SESSION (never a client-provided flag): the
// caller must be a signed-in admin. Role changes go through the atomic,
// race-safe admin_set_user_roles() RPC, which reconciles public.user_roles and
// keeps profiles.is_admin in lockstep with the ADMINISTRATOR role inside one
// transaction under an advisory lock (so is_admin and the ADMINISTRATOR row can
// never drift, and the self / protected-admin / last-admin guards hold under
// concurrency). The DB also has a BEFORE-DELETE trigger as the race-safe
// backstop for last-admin on deletion.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { protectedAdminEmails } from "@/lib/config/env";
import { canDeleteUser } from "@/lib/adminGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMINISTRATOR", "SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"];

// Map the RPC/trigger's raised tokens to HTTP responses.
function mapRpcError(message) {
  const m = String(message || "");
  if (m.includes("RPP_SELF")) return { status: 403, error: "You can't change your own roles." };
  if (m.includes("RPP_PROTECTED")) return { status: 403, error: "This is a protected original admin and can't be demoted." };
  if (m.includes("RPP_LAST_ADMIN")) return { status: 409, error: "Can't remove the last administrator." };
  if (m.includes("RPP_NOT_FOUND")) return { status: 404, error: "User not found." };
  if (m.includes("RPP_INVALID_ROLE")) return { status: 422, error: "One or more roles are not permitted." };
  return null;
}

async function requireAdmin() {
  const me = await getSessionUser();
  if (!me) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!me.isAdmin) return { error: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }) };
  return { me };
}

async function countAdmins(admin) {
  const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
  return count ?? 0;
}
async function getTarget(admin, id) {
  const { data } = await admin.from("profiles").select("id, email, is_admin, base_type").eq("id", id).maybeSingle();
  return data;
}
async function rolesOf(admin, id) {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", id);
  return (data || []).map((r) => r.role).sort();
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

  // Base type is IMMUTABLE after registration — a Student stays a Student and a
  // Faculty member stays Faculty. Reject any PATCH that tries to change it
  // (the UI no longer sends it); the original profiles.base_type is preserved.
  if (body?.baseType !== undefined) {
    return NextResponse.json(
      { error: "Base type is set at registration and cannot be changed." },
      { status: 422 },
    );
  }

  const wantsRoles = body?.roles !== undefined;
  if (!wantsRoles) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
  }

  // Validate roles: must be an array of permitted values, de-duplicated.
  let roles = null;
  if (wantsRoles) {
    if (!Array.isArray(body.roles)) {
      return NextResponse.json({ error: "Roles must be a list." }, { status: 422 });
    }
    roles = [...new Set(body.roles.map((r) => String(r).toUpperCase()))];
    const bad = roles.filter((r) => !ALLOWED_ROLES.includes(r));
    if (bad.length) {
      return NextResponse.json({ error: `Not permitted: ${bad.join(", ")}` }, { status: 422 });
    }
  }

  try {
    const admin = createAdminClient();
    const target = await getTarget(admin, id);
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

    // Roles (+ atomic is_admin sync) via the race-safe RPC. base_type is never
    // touched here, so changing roles can never alter Student/Faculty identity.
    const { error: rpcErr } = await admin.rpc("admin_set_user_roles", {
      p_actor: me.id,
      p_target: id,
      p_roles: roles,
      p_protected: protectedAdminEmails(),
    });
    if (rpcErr) {
      const mapped = mapRpcError(rpcErr.message);
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      throw rpcErr;
    }

    const fresh = await getTarget(admin, id);
    return NextResponse.json({
      ok: true,
      baseType: fresh?.base_type,
      isAdmin: !!fresh?.is_admin,
      roles: await rolesOf(admin, id),
    });
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

    // Friendly pre-check (self / protected / last-admin). The DB BEFORE-DELETE
    // trigger is the race-safe backstop for last-admin.
    const verdict = canDeleteUser({
      actorId: me.id,
      target,
      adminCount: await countAdmins(admin),
      protectedEmails: protectedAdminEmails(),
    });
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

    // Deletes the Auth user; profiles + user_roles are removed by ON DELETE
    // CASCADE. If a concurrent change made this the last admin, the trigger
    // aborts the cascade and this call errors → mapped to 409.
    const { error: delErr } = await admin.auth.admin.deleteUser(id);
    if (delErr) {
      if (/RPP_LAST_ADMIN/.test(delErr.message || "")) {
        return NextResponse.json({ error: "Can't delete the last administrator." }, { status: 409 });
      }
      throw delErr;
    }

    const leftover = await getTarget(admin, id);
    if (leftover) await admin.from("profiles").delete().eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("admin/users DELETE: error:", e?.status || e?.message);
    return NextResponse.json({ error: "Could not delete the user." }, { status: 500 });
  }
}
