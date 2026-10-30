// Sign-in: verify credentials with Supabase Auth, which sets the session
// cookies on the response through the SSR cookie adapter.
//
// Response contract is unchanged, so
// components/auth/LoginForm.jsx needs no changes: 200 `{ ok: true }` on success,
// a generic 401 `{ error }` on bad credentials, 500 otherwise.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateLogin } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  // Generic failure — never reveal whether the email or the password was wrong.
  const invalid = () =>
    NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

  let email, password;
  try {
    const body = await request.json();
    ({ email, password } = validateLogin(body));
  } catch (error) {
    // Malformed body or failed validation both collapse to the generic 401, so
    // the endpoint cannot be used to probe which accounts exist.
    if (error instanceof ValidationError || error instanceof SyntaxError) return invalid();
    throw error;
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Bad credentials / unconfirmed email → generic 401. Only an unexpected
      // transport/server fault should surface as a 500.
      if (error.status && error.status >= 500) throw error;
      return invalid();
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("login: error:", e?.status || e?.message);
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
}
