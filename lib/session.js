import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Identity for the current request, resolved from Supabase Auth.
 *
 * `getUser()` validates the session's access token with Supabase (not just the
 * cookie), so the result cannot be forged client-side. The app-specific fields
 * — display name, base type, and the admin flag — live in `public.profiles`,
 * read here under the signed-in user's own Row Level Security.
 *
 * The return shape (`{ id, name, email, isAdmin, baseType }`) is what every
 * consumer — app/(app)/layout.js, the RoleContext, lib/rbac.js — expects, so
 * those callers work unchanged.
 */
export async function getSessionUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("name, base_type, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  // Additional roles (ADMINISTRATOR/SPOC/DESK_REVIEWER/PEER_REVIEWER/EDITOR).
  // Read under the user's own RLS (own rows only). Safe if the table doesn't
  // exist yet (pre-0004) — treated as no roles.
  let roles = [];
  try {
    const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
    roles = (roleRows || []).map((r) => r.role);
  } catch {
    roles = [];
  }

  return {
    id: user.id,
    name: profile?.name || user.email,
    email: user.email,
    isAdmin: !!profile?.is_admin,
    baseType: profile?.base_type || null,
    roles,
  };
}
