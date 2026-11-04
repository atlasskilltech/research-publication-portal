// Admin-only user management for a single account:
//   PATCH  — change the set of additional roles (base type is immutable)
//   DELETE — permanently delete the account (sessions, tokens, identities,
//            roles, assignments and reviews cascade; papers keep their rows)
//
// Authorization is enforced from the SESSION (never a client-provided flag): the
// caller must be a signed-in admin. Role changes go through
// lib/repos/users.setUserRoles in ONE transaction that locks every admin row
// first, so isAdmin and the ADMINISTRATOR role never drift and the self /
// protected-admin / last-admin guards hold under concurrency. Deletion re-checks
// last-admin under the same lock.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { uuid } from "@/lib/auth/crypto.mjs";
import { findUserById, countAdmins, rolesFor, setUserRoles, deleteUser, ROLES } from "@/lib/repos/users.mjs";
import { protectedAdminEmails } from "@/lib/config/env";
import { canDeleteUser } from "@/lib/adminGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map the guard tokens raised by setUserRoles/deleteUser to HTTP responses.
function mapRoleError(message) {
  const m = String(message || "");
  if (m.includes("RPP_FORBIDDEN")) return { status: 403, error: "Administrator access is required." };
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
  // Faculty member stays Faculty.
  if (body?.baseType !== undefined) {
    return NextResponse.json({ error: "Base type is set at registration and cannot be changed." }, { status: 422 });
  }
  if (body?.roles === undefined) return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
  if (!Array.isArray(body.roles)) return NextResponse.json({ error: "Roles must be a list." }, { status: 422 });
  const roles = [...new Set(body.roles.map((r) => String(r).toUpperCase()))];
  const bad = roles.filter((r) => !ROLES.includes(r));
  if (bad.length) return NextResponse.json({ error: `Not permitted: ${bad.join(", ")}` }, { status: 422 });

  try {
    const target = await findUserById(db, id);
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

    // Roles + isAdmin sync + (if EDITOR is removed) dropping the per-paper editor
    // assignments commit together or not at all. base_type is never touched.
    await db.transaction(async (tx) => {
      await setUserRoles(tx, { actorId: me.id, targetId: id, roles, protectedEmails: protectedAdminEmails() });
      // Removing the EDITOR role also ends their per-paper editor assignments —
      // otherwise they would keep decision/publication powers on those papers.
      if (!roles.includes("EDITOR")) {
        const dropped = await tx.query(
          `SELECT paper_id FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = 'EDITOR' FOR UPDATE`, [id]);
        if (dropped.length) {
          await tx.exec(`DELETE FROM \`${T.paperAssignments}\` WHERE assignee = ? AND role = 'EDITOR'`, [id]);
          await tx.exec(
            `INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail, created_at) VALUES ?`,
            [dropped.map((d) => [uuid(), d.paper_id, me.id, "UNASSIGNED", JSON.stringify({ assignee: id, role: "EDITOR", reason: "role_removed" }), new Date()])],
          );
        }
      }
    });

    const fresh = await findUserById(db, id);
    return NextResponse.json({ ok: true, baseType: fresh?.base_type, isAdmin: !!fresh?.is_admin, roles: await rolesFor(db, id) });
  } catch (e) {
    const mapped = mapRoleError(e?.message);
    if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    console.error("admin/users PATCH: error:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not update the user." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const { me, error } = await requireAdmin();
  if (error) return error;
  const { id } = await params;

  try {
    const target = await findUserById(db, id);
    if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });

    // Friendly pre-check (self / protected / last-admin); deleteUser re-checks
    // last-admin under the admin-row lock as the race-safe backstop.
    const verdict = canDeleteUser({ actorId: me.id, target, adminCount: await countAdmins(db), protectedEmails: protectedAdminEmails() });
    if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: verdict.status });

    const deleted = await db.transaction((tx) => deleteUser(tx, id));
    if (!deleted) return NextResponse.json({ error: "User not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (/RPP_LAST_ADMIN/.test(e?.message || "")) return NextResponse.json({ error: "Can't delete the last administrator." }, { status: 409 });
    console.error("admin/users DELETE: error:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not delete the user." }, { status: 500 });
  }
}
