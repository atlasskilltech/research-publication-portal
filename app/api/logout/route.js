// Sign-out: delete the server session row and clear the cookie.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySessionByToken, cookieOptions, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  try {
    await destroySessionByToken(token);
  } catch (e) {
    // Even if the row delete fails, clear the cookie so the client is signed
    // out; the orphaned row expires on its own.
    console.error("logout: error:", e?.code || e?.message);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(0)); // expire immediately
  return res;
}
