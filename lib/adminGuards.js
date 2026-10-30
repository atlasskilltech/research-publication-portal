/**
 * Pure authorization guards for admin user-management actions.
 *
 * These are intentionally dependency-free (no server-only, no env, no DB) so the
 * exact same logic that the API routes enforce can be unit-tested without a
 * network or database. The routes remain the ones that read the authoritative
 * server-side state (who is calling, the target's row, the admin count); these
 * functions only decide whether a change is allowed given that state.
 *
 * Every function returns { ok: true } or { ok: false, status, error }.
 */

function isProtected(email, protectedEmails) {
  const e = String(email || "").toLowerCase();
  return (protectedEmails || []).map((x) => String(x).toLowerCase()).includes(e);
}

/**
 * May `actorId` set `target`'s admin flag to `next`?
 * @param {{ actorId:string, target:{id:string,email:string,is_admin:boolean}, next:boolean, adminCount:number, protectedEmails:string[] }} p
 */
export function canSetAdmin({ actorId, target, next, adminCount, protectedEmails }) {
  if (!target) return { ok: false, status: 404, error: "User not found." };
  // No one may change their OWN admin status — blocks self-promotion and self-demotion.
  if (target.id === actorId) {
    return { ok: false, status: 403, error: "You can't change your own admin status." };
  }
  if (next === false) {
    // Demotion-specific protections.
    if (isProtected(target.email, protectedEmails)) {
      return { ok: false, status: 403, error: "This is a protected original admin and can't be demoted." };
    }
    if (target.is_admin && adminCount <= 1) {
      return { ok: false, status: 409, error: "Can't demote the last administrator." };
    }
  }
  return { ok: true };
}

/**
 * May `actorId` permanently delete `target`?
 * @param {{ actorId:string, target:{id:string,email:string,is_admin:boolean}, adminCount:number, protectedEmails:string[] }} p
 */
export function canDeleteUser({ actorId, target, adminCount, protectedEmails }) {
  if (!target) return { ok: false, status: 404, error: "User not found." };
  if (target.id === actorId) {
    return { ok: false, status: 403, error: "You can't delete your own account." };
  }
  if (isProtected(target.email, protectedEmails)) {
    return { ok: false, status: 403, error: "This is a protected original admin and can't be deleted." };
  }
  if (target.is_admin && adminCount <= 1) {
    return { ok: false, status: 409, error: "Can't delete the last administrator." };
  }
  return { ok: true };
}
