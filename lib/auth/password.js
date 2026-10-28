import "server-only";

import bcrypt from "bcryptjs";

/**
 * Password hashing with bcrypt (via the pure-JavaScript `bcryptjs`).
 *
 * bcryptjs is deliberately kept — rather than switching to scrypt — because
 * existing Administrator and submitter accounts in production were created with
 * bcrypt. Verifying against a different algorithm would silently lock every one
 * of them out. bcryptjs has no native build step, so it deploys unchanged on
 * any platform.
 *
 * The cost factor is carried inside every hash, so it can be raised later
 * without invalidating existing passwords; `needsRehash` reports when a stored
 * hash predates the current cost so it can be upgraded transparently on login.
 */

const COST = 12;

export async function hashPassword(plain) {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("Password must be a non-empty string.");
  }
  return bcrypt.hash(plain, COST);
}

/**
 * Constant-time verification (bcrypt compares the full hash). Returns false for
 * a malformed or empty stored hash rather than throwing, so a corrupt row
 * cannot be distinguished from a wrong password.
 */
export async function verifyPassword(plain, stored) {
  if (typeof plain !== "string" || typeof stored !== "string" || stored === "") return false;
  try {
    return await bcrypt.compare(plain, stored);
  } catch {
    return false;
  }
}

/** True when a stored hash used a weaker cost and should be re-hashed on login. */
export function needsRehash(stored) {
  try {
    return bcrypt.getRounds(String(stored ?? "")) < COST;
  } catch {
    return true;
  }
}
