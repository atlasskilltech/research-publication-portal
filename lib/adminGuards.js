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

/**
 * May `actorId` set `target`'s account status to `next` ("ACTIVE" | "DISABLED")?
 * `activeAdminCount` counts administrators whose status is ACTIVE.
 * @param {{ actorId:string, target:{id:string,email:string,is_admin:boolean,status?:string}, next:string, activeAdminCount:number, protectedEmails:string[] }} p
 */
export function canSetStatus({ actorId, target, next, activeAdminCount, protectedEmails }) {
  if (!target) return { ok: false, status: 404, error: "User not found." };
  if (next !== "ACTIVE" && next !== "DISABLED") return { ok: false, status: 422, error: "Status must be ACTIVE or DISABLED." };
  if (target.id === actorId) return { ok: false, status: 403, error: "You can't disable or reactivate your own account." };
  if (next === "DISABLED") {
    if (isProtected(target.email, protectedEmails)) {
      return { ok: false, status: 403, error: "This is a protected original admin and can't be disabled." };
    }
    if (target.is_admin && (target.status || "ACTIVE") === "ACTIVE" && activeAdminCount <= 1) {
      return { ok: false, status: 409, error: "Can't disable the last active administrator." };
    }
  }
  return { ok: true };
}

/**
 * Deletion is only for accounts with no workflow history; anything else must be
 * disabled so reviews, decisions and the audit trail survive.
 * @param {{ total:number }} history  from lib/repos/users.userHistory
 */
export function deletionHistoryBlock(history) {
  if (!history || !history.total) return null;
  return {
    ok: false,
    status: 409,
    code: "has_history",
    error: "This account has papers, reviews, assignments or other history, so it can't be deleted. Disable it instead: the person can no longer sign in and every record is kept.",
  };
}
