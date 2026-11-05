// External AUTHOR registration (AIDC – ATLAS International Design Conference 2026)
// — email + password, one step. Rules: lib/authorRegistration.js (pure, unit-tested).
//
// Validates the form (7 profile fields + password + confirm), refuses an email
// that already has an account, then in ONE transaction creates the AUTHOR
// account (Argon2id hash — never plaintext; non-admin, no roles) and its
// profile, starts an APP session (existing session system) and sends one
// confirmation email via the existing SendGrid integration. No Google step.
//
// Responses:
//   201 { ok, email, emailSent, redirect: "/dashboard", message }   (+ session cookie)
//   409 { error, code: "exists", issues }   email already registered
//   422 { error, issues }                   validation
//   429 { error }                           rate limited (per IP / per email)
//   500 { error }
import { NextResponse } from "next/server";
import { db, isDuplicate } from "@/lib/db";
import { registerRateLimit, clientIp, sendAuthorRegistrationConfirmation } from "@/lib/authServer";
import { findUserByEmail, createAuthorUser } from "@/lib/repos/users.mjs";
import { hashPassword } from "@/lib/auth/password.mjs";
import { startSession } from "@/lib/auth/session";
import { registerAuthor, validateAuthorRegistration } from "@/lib/authorRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const v = validateAuthorRegistration(body);
  if (!v.ok) return NextResponse.json({ error: "Please check the form.", issues: v.fields }, { status: 422 });

  if (!registerRateLimit([`ip:${clientIp(request)}`, `email:${v.data.email}`])) {
    return NextResponse.json({ error: "Too many registration attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  try {
    const result = await registerAuthor(v.data, v.password, {
      findUserByEmail: (email) => findUserByEmail(db, email),
      createAuthor: async ({ data, password }) => {
        const passwordHash = await hashPassword(password); // Argon2id
        try {
          return await db.transaction((tx) => createAuthorUser(tx, {
            name: data.name, email: data.email, phone: data.phone, organization: data.organization,
            current_status: data.currentStatus, designation: data.designation, location: data.location, passwordHash,
          }));
        } catch (e) {
          if (isDuplicate(e)) throw Object.assign(new Error("duplicate"), { duplicate: true });
          throw e;
        }
      },
      startSession: (userId) => startSession(userId, { purpose: "APP", method: "password" }),
      sendConfirmation: sendAuthorRegistrationConfirmation,
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("register/author: error:", e?.code || e?.status || e?.message);
    return NextResponse.json({ error: "Registration is temporarily unavailable. Please try again later." }, { status: 500 });
  }
}
