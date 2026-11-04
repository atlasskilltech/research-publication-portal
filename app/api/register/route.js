// Public self-registration — Google-first, passwordless.
//
// Students and faculty register as before (same validation; students must pass
// the unique + verified Application Number check). The account is created
// ACTIVE, non-admin, with NO roles and NO password, and the user receives ONE
// "registration complete — sign in with your ATLAS University Google account"
// email. No verification link, no password-creation email, no setup page.
// Rules live in lib/registration.js (pure, unit-tested).
//
// Responses:
//   201 { ok: true, message, emailSent, googleSignIn }
//   409 { error, code? }      email or application number already registered
//   422 { error, issues? }    validation / application number not found
//   429 { error }             too many attempts (per IP / per email)
//   503 { error }             application-number verification unavailable
//   500 { error }             unexpected fault
import { NextResponse } from "next/server";
import { validateRegister } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { registerAccount } from "@/lib/registration";
import { registrationDeps, registerRateLimit, clientIp } from "@/lib/authServer";

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

  // Each attempt can create an account and send an email — rate-limit it.
  if (!registerRateLimit([`ip:${clientIp(request)}`, `email:${data.email}`])) {
    return NextResponse.json({ error: "Too many registration attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  try {
    const result = await registerAccount(data, registrationDeps());
    if (result.status === 201 && !result.body.emailSent) {
      console.warn("register: confirmation email not delivered (account created)");
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("register: error:", e?.code || e?.status || e?.message);
    return NextResponse.json(
      { error: "Registration is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
}
