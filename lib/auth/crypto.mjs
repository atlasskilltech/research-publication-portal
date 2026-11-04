/**
 * Small, pure crypto helpers for auth (no framework imports; used by the app,
 * scripts and tests).
 */
import crypto from "node:crypto";

/** URL-safe random token (default 32 bytes = 256 bits). */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
/** Hex random token — used for emailed links (matches the /auth/confirm format). */
export const randomHex = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
export const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const sha256B64u = (s) => crypto.createHash("sha256").update(String(s)).digest("base64url");
export const uuid = () => crypto.randomUUID();

/** Constant-time string comparison (false for different lengths / non-strings). */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
