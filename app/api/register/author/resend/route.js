// "Resend verification email" for external AUTHOR accounts (AIDC 2026).
// Same neutral answer whether or not the address belongs to an unverified
// Author (no account enumeration); shares the resend rate limiter (per IP +
// per address). A new link invalidates the previous one.
//   POST { email } → 200 { ok, message } | 400 | 429
import { NextResponse } from "next/server";
import { resendRateLimit, clientIp, resendAuthorVerification } from "@/lib/authServer";
import { isValidEmail } from "@/lib/authorRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NEUTRAL = "If this email belongs to an Author account that still needs verification, we've sent a new verification link. Please check your inbox (and spam folder).";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  if (!resendRateLimit([`ip:${clientIp(request)}`, `email:${email}`])) {
    return NextResponse.json({ error: "Too many requests. Please wait a few minutes and try again." }, { status: 429 });
  }
  try {
    await resendAuthorVerification(email);
  } catch (e) {
    console.error("register/author/resend:", e?.code || e?.message);
  }
  return NextResponse.json({ ok: true, message: NEUTRAL });
}
