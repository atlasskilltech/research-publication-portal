// Completes onboarding: the signed-in (just-verified) user sets their password.
// Requires a valid session — getUser() revalidates the token against Supabase,
// so an unauthenticated or expired request is rejected. On success the session
// is already active, so the client can go straight to the dashboard.
//
//   200 { ok: true }
//   401 { error }        no / invalid session (expired or unused link)
//   422 { error, issues }
//   500 { error }
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validatePassword } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let password;
  try {
    const body = await request.json();
    ({ password } = validatePassword(body));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, issues: error.fields }, { status: 422 });
    }
    throw error;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Your verification link has expired. Please register again or request a new link." },
        { status: 401 },
      );
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      if (error.status && error.status >= 500) throw error;
      return NextResponse.json(
        { error: "Could not set your password. Please try again." },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("set-password: error:", e?.status || e?.message);
    return NextResponse.json(
      { error: "This is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
}
