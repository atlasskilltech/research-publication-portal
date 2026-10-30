// Public self-registration via Supabase Auth. Always creates a non-admin
// Submitter (STUDENT or FACULTY).
//
// Role/privilege values are NEVER read from the client. The profile row is
// created by the `handle_new_user` database trigger, which hard-codes
// is_admin = false; the metadata passed here only carries non-privileged fields
// (name, base type, school, roll number). An Administrator assigns the
// functional roles (SPOC, reviewer, editor) per paper, never at registration.
//
// Response contract is unchanged so the
// register page needs no changes: 201 `{ ok, signedIn }`, 409 on a duplicate
// email, 422 `{ error, issues }` on validation failure.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateRegister } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let data;
  try {
    const body = await request.json();
    data = validateRegister(body);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message, issues: error.fields }, { status: 422 });
    }
    throw error;
  }

  const { name, email, password, baseType, school, rollNo } = data;
  const conflict = () =>
    NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });

  try {
    const supabase = await createClient();
    const { data: result, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Consumed by the handle_new_user() trigger to populate public.profiles.
        data: {
          name,
          base_type: baseType, // STUDENT | FACULTY
          school_code: school,
          roll_no: rollNo,
        },
      },
    });

    if (error) {
      if (error.status === 422 || /already/i.test(error.message || "")) return conflict();
      throw error;
    }

    // Supabase returns a user with an empty `identities` array when the email is
    // already registered (its own anti-enumeration behaviour); treat as conflict.
    if (result?.user && Array.isArray(result.user.identities) && result.user.identities.length === 0) {
      return conflict();
    }

    // A session is present only when email confirmation is disabled. With it on,
    // there is no session yet, so report success-without-sign-in and the page
    // sends the user to /login.
    const signedIn = !!result?.session;
    return NextResponse.json({ ok: true, signedIn }, { status: 201 });
  } catch (e) {
    console.error("register: error:", e?.status || e?.message);
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
}
