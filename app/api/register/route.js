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
//   201 { ok: true, message, emailSent }      account invited; emailSent=false →
//                                              account exists, user should use
//                                              "Resend setup email" (no duplicate account)
//   409 { error }                              email or application number already used
//   422 { error, issues? }                     validation / application number not found
//   429 { error }                              too many attempts (per IP / per email)
//   503 { error }                              verification temporarily unavailable
//   500 { error }                              unexpected fault
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateRegister } from "@/lib/validation";
import { verifyApplicationNo } from "@/lib/studentCheck";
import { registerAndInvite, findUserByEmail, registerRateLimit, clientIp } from "@/lib/authServer";
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

  // Each attempt can create an account and send an email — rate-limit it.
  if (!registerRateLimit([`ip:${clientIp(request)}`, `email:${email}`])) {
    return NextResponse.json({ error: "Too many registration attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

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

    // ---- Existing account? → no duplicate, point to resend ---------------
    const conflict = () => NextResponse.json(
      { error: "An account with this email already exists. If you have not set your password yet, use \"Resend setup email\" on the sign-in page.", code: "exists" },
      { status: 409 },
    );
    if (await findUserByEmail(email)) return conflict();

    // ---- Create the invited (unconfirmed) auth user + email it ------------
    // Application-managed delivery: Supabase creates the account and generates
    // the one-time token (auth.admin.generateLink — sends no email); we email
    // OUR /auth/confirm link via Resend; /auth/confirm verifies it server-side.
    // Metadata is consumed by handle_new_user() to populate public.profiles.
    const result = await registerAndInvite(email, {
      name,
      base_type: baseType, // STUDENT | FACULTY
      school_code: school,
      application_no: applicationNo, // null for faculty
    });

    if (!result.ok) {
      const error = result.error || {};
      if (error.status === 422 || error.status === 409 || CONFLICT_RE.test(error.message || "")) return conflict();
      throw error;
    }

    if (!result.emailSent) {
      // The account exists but delivery failed (provider down / not configured).
      // The user can recover with "Resend setup email" — no second registration.
      return NextResponse.json(
        {
          ok: true,
          emailSent: false,
          message:
            "Your account was created, but we couldn't send the setup email right now. Please use \"Resend setup email\" on the sign-in page in a few minutes.",
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        emailSent: true,
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
