// Sign-in: verify credentials with bcrypt, then issue a server session.
import { NextResponse } from "next/server";
import { queryOne, execute } from "@/lib/db";
import { TABLES } from "@/lib/tables.mjs";
import { verifyPassword, needsRehash, hashPassword } from "@/lib/auth/password";
import { validateLogin } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { createSession, cookieOptions, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  // Generic failure — never reveal whether the email or the password was wrong.
  const invalid = () =>
    NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

  let email, password;
  try {
    const body = await request.json();
    ({ email, password } = validateLogin(body));
  } catch (error) {
    // Malformed body or failed validation both collapse to the generic 401, so
    // the endpoint cannot be used to probe which accounts exist.
    if (error instanceof ValidationError || error instanceof SyntaxError) return invalid();
    throw error;
  }

  try {
    const user = await queryOne(
      `SELECT \`id\`, \`passwordHash\` FROM \`${TABLES.users}\` WHERE \`email\` = ? LIMIT 1`,
      [email],
    );
    if (!user || !user.passwordHash) return invalid();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return invalid();

    // Transparently upgrade a hash stored with a weaker cost factor.
    if (needsRehash(user.passwordHash)) {
      const upgraded = await hashPassword(password);
      await execute(`UPDATE \`${TABLES.users}\` SET \`passwordHash\` = ? WHERE \`id\` = ?`, [upgraded, user.id]);
    }

    // Credentials valid. Any failure beyond here is internal — surface a 500.
    const { token } = await createSession(user.id);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
    return res;
  } catch (e) {
    console.error("login: error:", e?.code || e?.message);
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
}
