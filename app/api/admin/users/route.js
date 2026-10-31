// Admin-only: list every registered account (real profiles), merged with the
// email-verification status from Supabase Auth. Authorization is server-side —
// identity comes from the session cookie, never the client — and the data is
// read with the service role so an admin sees all rows.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const admin = createAdminClient();
    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id, name, email, base_type, is_admin, school_code, application_no, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;

    // Additional roles (ADMINISTRATOR/SPOC/…) live in user_roles, grouped per user.
    const { data: roleRows, error: rErr } = await admin.from("user_roles").select("user_id, role");
    if (rErr) throw rErr;
    const rolesByUser = new Map();
    (roleRows || []).forEach((r) => {
      const list = rolesByUser.get(r.user_id) || [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    });

    // Email-confirmation status lives in auth.users, not profiles.
    const confirmed = new Map();
    for (let page = 1; page <= 50; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      data.users.forEach((u) => confirmed.set(u.id, !!u.email_confirmed_at));
      if (data.users.length < 200) break;
    }

    const users = (profiles || []).map((p) => ({
      id: p.id,
      name: p.name || p.email,
      email: p.email,
      baseType: p.base_type,
      isAdmin: !!p.is_admin,
      roles: (rolesByUser.get(p.id) || []).sort(),
      school: p.school_code || null,
      applicationNo: p.application_no || null,
      createdAt: p.created_at,
      verified: confirmed.get(p.id) ?? false,
    }));

    return NextResponse.json({ users });
  } catch (e) {
    console.error("admin/users GET: error:", e?.status || e?.message);
    return NextResponse.json({ error: "Could not load users." }, { status: 500 });
  }
}
