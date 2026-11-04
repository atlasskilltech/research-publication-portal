import "server-only";

import { db } from "@/lib/db";
import { currentSession } from "@/lib/auth/session";
import { findUserById, rolesFor } from "@/lib/repos/users.mjs";

/**
 * Identity for the current request, resolved from the MySQL session store.
 *
 * The only input is the opaque session cookie; the session must be live (not
 * revoked, not expired, not idle) and the account ACTIVE (lib/auth/store.mjs).
 * Display name, base type, admin flag and roles come from MySQL — never from
 * the browser.
 *
 * The return shape (`{ id, name, email, isAdmin, baseType, roles }`) is what
 * every consumer — app/(app)/layout.js, the RoleContext, lib/rbac.js and the
 * API routes — expects, so those callers work unchanged.
 */
export async function getSessionUser() {
  const session = await currentSession(["APP"]);
  if (!session) return null;
  const user = await findUserById(db, session.user_id);
  if (!user || user.status !== "ACTIVE") return null;
  const roles = await rolesFor(db, user.id);
  return {
    id: user.id,
    name: user.name || user.email,
    email: user.email,
    isAdmin: !!user.is_admin,
    baseType: user.base_type || null,
    roles,
  };
}

/**
 * The short-lived session created by an email link (SETUP = first password,
 * RESET = forgot password). Only /create-password, /reset-password and
 * /api/set-password accept it; it never grants access to the app.
 * → { user: { id, email, name }, flow: "setup" | "reset" } or null.
 */
export async function getSetupSession() {
  const session = await currentSession(["SETUP", "RESET"]);
  if (!session) return null;
  const user = await findUserById(db, session.user_id);
  if (!user || user.status !== "ACTIVE") return null;
  return { user: { id: user.id, email: user.email, name: user.name }, flow: session.purpose === "RESET" ? "reset" : "setup" };
}
