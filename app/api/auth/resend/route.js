// Resend the setup email. Always the same neutral answer (no account
// enumeration). Rate-limited per IP and per address. Never creates accounts:
//   unverified account → fresh invite link
//   verified account   → password-setup (recovery) link
//   unknown / not allowed → nothing sent, same response
//   POST { email }  → 200 { ok, message } | 422 | 429
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
    { email: body?.email, ip: clientIp(request) },
    { isApprovedEmail, rateLimit: resendRateLimit, findUserByEmail, sendInvite, sendRecovery },
  );
  return NextResponse.json(result.body, { status: result.status });
}
