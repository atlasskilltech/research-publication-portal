// Admin-only: list every registered account with roles and email-verification
// status (MySQL). Authorization is server-side — identity comes from the session
// cookie, never the client.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { listUsersWithRoles } from "@/lib/repos/users.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const rows = await listUsersWithRoles(db);
    const users = rows.map((p) => ({
      id: p.id,
      name: p.name || p.email,
      email: p.email,
      baseType: p.base_type,
      isAdmin: !!p.is_admin,
      roles: [...p.roles].sort(),
      school: p.school_code || null,
      applicationNo: p.application_no || null,
      createdAt: p.created_at,
      verified: !!p.email_confirmed_at,
      status: p.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    }));
    return NextResponse.json({ users });
  } catch (e) {
    console.error("admin/users GET: error:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load users." }, { status: 500 });
  }
}
