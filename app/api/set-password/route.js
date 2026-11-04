// Completes onboarding / password reset: the just-verified user sets a password.
//   POST { password, confirm }
// Requires the 30-minute SETUP/RESET session that /auth/confirm starts after a
// valid email link (an ordinary signed-in session is NOT enough, and no user id
// is ever taken from the request). On success every session of the user is
// revoked and they sign in with the new password (rules in lib/authFlow.js
// setPassword()). A confirmation email is sent best-effort.
//
//   200 { ok: true } | 401 { error, code: "setup_required" } | 422 { error, issues } | 500
import { NextResponse } from "next/server";
import { setPassword } from "@/lib/authFlow";
import { setPasswordDeps, notifyPasswordChanged } from "@/lib/authServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  try {
    const result = await setPassword(
      { password: body?.password, confirm: body?.confirm },
      { ...setPasswordDeps, notifyPasswordChanged },
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("set-password: error:", e?.code || "unexpected");
    return NextResponse.json({ error: "This is temporarily unavailable. Please try again later." }, { status: 500 });
  }
}
