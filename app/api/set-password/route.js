// Completes onboarding: the just-verified user sets their password.
//   POST { password, confirm }
// Requires BOTH a valid Supabase session (getUser() revalidates it with
// Supabase) AND the signed setup proof issued by /auth/confirm for the SAME
// user — so an ordinary signed-in session can't change the password here, and
// no user id is ever taken from the request. On success the setup proof is
// cleared and the session signed out: the user then signs in with the new
// password (rules in lib/authFlow.js setPassword()). A confirmation email is
// sent best-effort; delivery failure never fails the password change.
//
//   200 { ok: true } | 401/403 { error, code: "setup_required" } | 422 { error, issues } | 500
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setPassword } from "@/lib/authFlow";
import { readSetupProof, clearSetupProof, setupSecret, notifyPasswordChanged } from "@/lib/authServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  try {
    const supabase = await createClient();
    const proof = await readSetupProof();
    const result = await setPassword(
      { password: body?.password, confirm: body?.confirm },
      {
        getUser: async () => (await supabase.auth.getUser()).data?.user || null,
        readSetupProof: () => proof,
        secret: setupSecret(),
        updatePassword: (password) => supabase.auth.updateUser({ password }),
        clearSetupProof,
        signOut: () => supabase.auth.signOut({ scope: "local" }),
        // Best-effort Resend confirmation ("account ready" / "password changed").
        notifyPasswordChanged,
      },
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    // Status only — never the password, token or user details.
    console.error("set-password: error:", e?.status || "unexpected");
    return NextResponse.json({ error: "This is temporarily unavailable. Please try again later." }, { status: 500 });
  }
}
