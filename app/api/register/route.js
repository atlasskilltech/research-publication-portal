// Public self-registration. Always creates a non-admin Submitter (STUDENT or
// FACULTY). Role/privilege values are NEVER read from the client; isAdmin is
// forced to 0 and the functional roles (SPOC, reviewer, editor) are assigned
// per paper by an Administrator, never at registration.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { TABLES } from "@/lib/tables.mjs";
import { hashPassword } from "@/lib/auth/password";
import { validateRegister } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { createSession, cookieOptions, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let data;
  try {
    const body = await request.json();
    data = validateRegister(body);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { error: error.message, issues: error.fields },
        { status: 422 },
      );
    }
    throw error;
  }

  const { name, email, password, baseType, school, rollNo } = data;
  const conflict = () =>
    NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });

  let userId;
  try {
    const existing = await queryOne(`SELECT \`id\` FROM \`${TABLES.users}\` WHERE \`email\` = ? LIMIT 1`, [email]);
    if (existing) return conflict();

    const passwordHash = await hashPassword(password);
    userId = crypto.randomUUID();
    await query(
      `INSERT INTO \`${TABLES.users}\` ` +
        "(`id`, `name`, `email`, `passwordHash`, `baseType`, `isAdmin`, `schoolCode`, `rollNo`, `createdAt`, `updatedAt`) " +
        "VALUES (?, ?, ?, ?, ?, 0, ?, ?, NOW(3), NOW(3))",
      [userId, name, email, passwordHash, baseType, school, rollNo],
    );
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY" || e?.cause?.code === "ER_DUP_ENTRY") return conflict();
    console.error("register: error:", e?.code || e?.cause?.code || e?.message);
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }

  // Account created. Auto sign-in by issuing a session; if that fails, report
  // success-without-sign-in rather than a misleading error.
  let token;
  try {
    ({ token } = await createSession(userId));
  } catch (e) {
    console.error("register: session creation failed:", e?.code || e?.message);
    return NextResponse.json({ ok: true, signedIn: false }, { status: 201 });
  }

  const res = NextResponse.json({ ok: true, signedIn: true }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  return res;
}
