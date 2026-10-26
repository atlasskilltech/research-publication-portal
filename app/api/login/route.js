// Custom login: verify credentials with bcrypt, then issue a server session.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation";
import { createSession, cookieOptions, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  // Generic error — never reveal whether the email or the password was wrong.
  const invalid = () => NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  if (!parsed.success) return invalid();

  const email = parsed.data.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) return invalid();

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return invalid();

  const { token } = await createSession(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  return res;
}
