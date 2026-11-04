// Sign-in with email + password (MySQL). Verifies the Argon2id (or legacy
// bcrypt, then upgraded) hash, then starts a server-side session (opaque
// httpOnly cookie).
//
// Response contract (unchanged; components/auth/LoginForm.jsx relies on it):
//   200 { ok: true } | 401 { error } (generic) | 429 { error } | 500 { error }
// Unknown account, no password yet, unverified email, disabled account and wrong
// password all return the SAME 401, and the unknown/no-password cases still run
// a full hash verification so timing does not reveal which accounts exist.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateLogin } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { verifyPassword, burnPasswordCheck, hashPassword } from "@/lib/auth/password.mjs";
import { findCredentials, upgradePasswordHash, touchLastLogin } from "@/lib/repos/users.mjs";
import { startSession } from "@/lib/auth/session";
import { loginRateLimit, clientIp } from "@/lib/authServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const invalid = () => NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

  let email, password;
  try {
    ({ email, password } = validateLogin(await request.json()));
  } catch (error) {
    if (error instanceof ValidationError || error instanceof SyntaxError) return invalid();
    throw error;
  }

  if (!loginRateLimit([`ip:${clientIp(request)}`, `email:${email}`])) {
    return NextResponse.json({ error: "Too many sign-in attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  try {
    const cred = await findCredentials(db, email);
    const usable = cred && cred.password_hash && cred.status === "ACTIVE" && cred.email_confirmed_at;
    const check = usable ? await verifyPassword(cred.password_hash, password) : await burnPasswordCheck(password);
    if (!usable || !check.ok) return invalid();

    if (check.needsRehash) {
      // Transparent upgrade of a legacy bcrypt hash to Argon2id (best-effort).
      try { await upgradePasswordHash(db, cred.id, await hashPassword(password)); } catch { /* keep the old hash */ }
    }
    await startSession(cred.id, { purpose: "APP", method: "password" });
    await touchLastLogin(db, cred.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("login: error:", e?.code || e?.message);
    return NextResponse.json({ error: "Sign-in is temporarily unavailable. Please try again later." }, { status: 500 });
  }
}
