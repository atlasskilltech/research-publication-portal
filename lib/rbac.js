import "server-only";

import { getSessionUser } from "@/lib/session";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

/**
 * Server-side authorization helpers.
 *
 * Every protected server operation resolves identity from the session cookie
 * here — never from the client, a header, or localStorage. The client-side
 * "viewed as" role in the UI is cosmetic and can never grant access.
 *
 * The confirmed access model (see requirements-and-role-matrix.md): the
 * Administrator is the one global role (`isAdmin`). Every other functional role
 * — SPOC, Desk/Peer Reviewer, Editor — is assigned per paper, not stored on the
 * account, so there is no account-level role to check here beyond Admin.
 */

/** Returns the session user, or null if not authenticated. */
export async function requireUser() {
  return getSessionUser();
}

/** Returns the session user only if they are an Administrator, else null. */
export async function requireAdmin() {
  const user = await getSessionUser();
  return user && user.isAdmin ? user : null;
}

/** Throws UnauthorizedError when signed out; returns the user otherwise. */
export async function requireUserOrThrow() {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Throws (401/403) unless the caller is a signed-in Administrator. */
export async function requireAdminOrThrow() {
  const user = await requireUserOrThrow();
  if (!user.isAdmin) throw new ForbiddenError("Administrator access is required.");
  return user;
}
