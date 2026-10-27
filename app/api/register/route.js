// Public self-registration. Always creates a Submitter (STUDENT or FACULTY).
// Role/privilege values are NEVER read from the client; isAdmin is forced false.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query, queryOne } from "@/lib/db";
import { registerSchema } from "@/lib/validation";
import { createSession, cookieOptions, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please check the form.", issues: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const { name, email, password, baseType, school, rollNo } = parsed.data;
  const conflict = () =>
    NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });

  let userId;
  try {
    const existing = await queryOne("SELECT `id` FROM `users` WHERE `email` = ? LIMIT 1", [email]);
    if (existing) return conflict();

    const passwordHash = await bcrypt.hash(password, 12);
    userId = crypto.randomUUID();
    await query(
      `INSERT INTO \`users\`
         (\`id\`, \`name\`, \`email\`, \`passwordHash\`, \`baseType\`, \`isAdmin\`, \`schoolCode\`, \`rollNo\`, \`createdAt\`, \`updatedAt\`)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, NOW(3), NOW(3))`,
      [
        userId,
        name,
        email,
        passwordHash,
        baseType, // STUDENT | FACULTY only
        school || null,
        baseType === "STUDENT" ? rollNo || null : null,
      ],
    );
  } catch (e) {
    if (e?.code === "ER_DUP_ENTRY") return conflict();
    console.error("register: error:", e?.code || e?.message);
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
