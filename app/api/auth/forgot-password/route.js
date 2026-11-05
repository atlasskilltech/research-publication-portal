// Forgot password. Same neutral answer whether or not the account exists;
// shares the resend rate limiter (per IP + per address).
//   any existing account → single-use recovery link → SMTP "Reset your password" → /reset-password
//     (also the way a user without a password — e.g. a non-Google address — creates one by email)
//   unknown / not allowed → nothing sent
//   POST { email } → 200 { ok, message } | 422 | 429
import { NextResponse } from "next/server";
import { resendSetupEmail } from "@/lib/authFlow";
import { resendRateLimit, clientIp, findUserByEmail, sendRecovery, sendSignInInstructions } from "@/lib/authServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  // A reset link is only ever sent to an EXISTING account (resendSetupEmail
  // looks it up and answers neutrally either way), so any address may ask.
  // Previously this was gated on the Student/Faculty registration allow-list,
  // which silently blocked external Authors (e.g. Gmail) from resetting or
  // setting a password.
  const anyAddress = (e) => typeof e === "string" && e.length > 0;
  const result = await resendSetupEmail(
    { email: body?.email, ip: clientIp(request), purpose: "reset" },
    { isApprovedEmail: anyAddress, rateLimit: resendRateLimit, findUserByEmail, sendRecovery, sendSignInInstructions },
  );
  return NextResponse.json(result.body, { status: result.status });
}
