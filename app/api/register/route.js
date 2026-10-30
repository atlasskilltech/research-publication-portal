// Public self-registration — passwordless. The user never chooses a password
// here; we create the Supabase Auth account in an unconfirmed, invited state and
// email them a verification link. Clicking it confirms the email and sends them
// to the Create Password page. Every new account is a non-admin Submitter: the
// profile row is created by the handle_new_user trigger, which hard-codes
// is_admin = false, so privilege can never arrive from the client.
//
// Students must pass Application Number verification (checked server-side here,
// never trusting any client result) and the number must be unique. Faculty skip
// that entirely.
//
// Responses:
//   201 { ok: true, message }                 account invited, email sent
//   409 { error }                              email or application number already used
//   422 { error, issues? }                     validation / application number not found
//   503 { error }                              verification temporarily unavailable
//   500 { error }                              unexpected fault
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateRegister } from "@/lib/validation";
import { verifyApplicationNo } from "@/lib/studentCheck";
import { siteUrl } from "@/lib/config/env";
import { ValidationError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFLICT_RE = /already|registered|exists|duplicate/i;

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

  const { name, email, baseType, school, applicationNo } = data;

  try {
    const admin = createAdminClient();

    // ---- Student-only: duplicate guard + external verification -----------
    if (baseType === "STUDENT") {
      // Prevent two accounts for the same application number. The DB also has a
      // unique index as the hard backstop; this gives a clean 409 first.
      // Both sides are already normalised (upper-cased, whitespace-stripped),
      // so an exact match is correct and avoids ilike wildcard characters.
      const { data: existing, error: dupErr } = await admin
        .from("profiles")
        .select("id")
        .eq("application_no", applicationNo)
        .limit(1);
      if (dupErr) throw dupErr;
      if (existing && existing.length > 0) {
        return NextResponse.json(
          { error: "This application number is already registered." },
          { status: 409 },
        );
      }

      const check = await verifyApplicationNo(applicationNo);
      if (check.status === "not_found") {
        return NextResponse.json(
          {
            error: "We couldn't verify that application number.",
            issues: { applicationNo: "This application number was not found." },
          },
          { status: 422 },
        );
      }
      if (check.status === "unavailable") {
        return NextResponse.json(
          { error: "Verification is temporarily unavailable. Please try again shortly." },
          { status: 503 },
        );
      }
      // status === "exists" → continue.
    }

    // ---- Create the invited (unconfirmed) auth user ----------------------
    // Metadata is consumed by handle_new_user() to populate public.profiles.
    // redirectTo lands the verification click on our /auth/confirm route, which
    // establishes the session and forwards to the Create Password page.
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: {
        name,
        base_type: baseType, // STUDENT | FACULTY
        school_code: school,
        application_no: applicationNo, // null for faculty
      },
      redirectTo: `${siteUrl()}/auth/confirm?next=/create-password`,
    });

    if (error) {
      // Already-registered email → neutral conflict (no account enumeration beyond
      // the fact that the address can't be registered again).
      if (error.status === 422 || error.status === 409 || CONFLICT_RE.test(error.message || "")) {
        return NextResponse.json(
          { error: "An account with this email already exists." },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json(
      {
        ok: true,
        message:
          "Registration successful. Please check your email to verify your account and create your password.",
      },
      { status: 201 },
    );
  } catch (e) {
    console.error("register: error:", e?.status || e?.message);
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
}
