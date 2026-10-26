// Server-side authorization helpers. Every protected server operation should
// resolve identity from the session (never from the client or localStorage).
import { getSessionUser } from "@/lib/session";

/** Returns the session user, or null if not authenticated. */
export async function requireUser() {
  return await getSessionUser();
}

/** Returns the session user only if they are an Administrator, else null. */
export async function requireAdmin() {
  const user = await getSessionUser();
  return user && user.isAdmin ? user : null;
}
