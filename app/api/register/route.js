// Public self-registration. Always creates a Submitter (STUDENT or FACULTY).
// Role/privilege values are NEVER read from the client; isAdmin is forced false.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        baseType, // STUDENT | FACULTY only
        isAdmin: false, // privilege can never be self-assigned
        schoolCode: school || null,
        rollNo: baseType === "STUDENT" ? rollNo || null : null,
      },
    });
  } catch (e) {
    if (e?.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      );
    }
    throw e;
  }

  // Auto sign-in the new account by issuing a server session. The account is
  // already created; if session creation fails (e.g. missing sessions table),
  // report success-without-sign-in rather than a misleading error.
  let token;
  try {
    ({ token } = await createSession(user.id));
  } catch (e) {
    console.error("register: session creation failed:", e?.code || e?.message);
    return NextResponse.json({ ok: true, signedIn: false }, { status: 201 });
  }

  const res = NextResponse.json({ ok: true, signedIn: true }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  return res;
}
