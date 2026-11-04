/**
 * Password hashing — Argon2id (OWASP 2024 baseline: m=19 MiB, t=2, p=1).
 *
 * Legacy bcrypt hashes ($2a$/$2b$/$2y$ — from the original MySQL app and from
 * the previous auth provider's export) are still VERIFIED, and the caller is told to re-hash
 * (`needsRehash`) so they are upgraded to Argon2id on the next successful login.
 * Plain/unknown formats never verify.
 */
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";

const ARGON2ID = 2; // @node-rs/argon2 Algorithm.Argon2id
export const ARGON_OPTS = Object.freeze({ algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) throw new Error("hashPassword: empty password");
  return argonHash(password, ARGON_OPTS);
}

const isArgon = (h) => typeof h === "string" && h.startsWith("$argon2id$");
const isBcrypt = (h) => typeof h === "string" && /^\$2[aby]\$\d{2}\$.{53}$/.test(h);

/** True when an Argon2id hash uses weaker parameters than ARGON_OPTS. */
function argonOutdated(h) {
  const m = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(h);
  if (!m) return true;
  return Number(m[1]) < ARGON_OPTS.memoryCost || Number(m[2]) < ARGON_OPTS.timeCost;
}

/** → { ok, needsRehash } — never throws for a bad/unknown hash. */
export async function verifyPassword(storedHash, password) {
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) return { ok: false, needsRehash: false };
  try {
    if (isArgon(storedHash)) {
      const ok = await argonVerify(storedHash, password);
      return { ok, needsRehash: ok && argonOutdated(storedHash) };
    }
    if (isBcrypt(storedHash)) {
      const ok = await bcrypt.compare(password, storedHash.replace(/^\$2y\$/, "$2b$"));
      return { ok, needsRehash: ok };
    }
  } catch {
    /* fall through */
  }
  return { ok: false, needsRehash: false };
}

// A fixed, valid Argon2id hash used to spend the same time when the account
// does not exist (or has no password), so response timing can't reveal it.
let dummy = null;
export async function burnPasswordCheck(password) {
  dummy ||= await hashPassword("rpp-timing-equaliser-not-a-real-password");
  await verifyPassword(dummy, typeof password === "string" && password ? password : "x");
  return { ok: false, needsRehash: false };
}
