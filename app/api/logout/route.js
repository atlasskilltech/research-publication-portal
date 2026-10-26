// Custom logout: delete the server session row and clear the cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySessionByToken, cookieOptions, SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await destroySessionByToken(token);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0)); // expire immediately
  return res;
}
