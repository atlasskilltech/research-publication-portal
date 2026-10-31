// Forgot password. Same neutral answer whether or not the account exists;
// shares the resend rate limiter (per IP + per address).
//   verified account   → Supabase recovery link (generateLink) → Resend "Reset your password" → /reset-password
//   unverified account → a fresh setup invite instead (they never had a password)
//   unknown / not allowed → nothing sent
//   POST { email } → 200 { ok, message } | 422 | 429
import { NextResponse } from "next/server";
import { resendSetupEmail } from "@/lib/authFlow";
import { isApprovedEmail } from "@/lib/validation";
import { resendRateLimit, clientIp, findUserByEmail, sendInvite, sendRecovery } from "@/lib/authServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const result = await resendSetupEmail(
    { email: body?.email, ip: clientIp(request), purpose: "reset" },
    { isApprovedEmail, rateLimit: resendRateLimit, findUserByEmail, sendInvite, sendRecovery },
  );
  return NextResponse.json(result.body, { status: result.status });
}
