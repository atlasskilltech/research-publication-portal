// External AUTHOR registration (AIDC – ATLAS International Design Conference 2026)
// — phase 1 of 2. Rules: lib/authorRegistration.js (pure, unit-tested).
//
// Validates the form, refuses an email that already has an account, stores a
// PENDING registration (no account yet) and binds it to this browser with an
// httpOnly cookie. The account is created only after the user continues with
// Google and the verified Google email EXACTLY matches (see /auth/google +
// /auth/callback). No password, no verification link, no role from the client.
//
// Responses:
//   201 { ok, pending: true, email, message }
//   409 { error, code: "exists", issues }   email already registered
//   422 { error, issues }                   validation
//   429 { error }                           rate limited (per IP / per email)
//   500 { error }
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { registerRateLimit, clientIp } from "@/lib/authServer";
import { findUserByEmail } from "@/lib/repos/users.mjs";
import { createPendingAuthorRegistration } from "@/lib/repos/authors.mjs";
import {
  AUTHOR_COOKIE, AUTHOR_REGISTRATION_TTL_SECONDS, registerAuthor, validateAuthorRegistration,
} from "@/lib/authorRegistration";

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
    const result = await registerAuthor(v.data, {
      findUserByEmail: (email) => findUserByEmail(db, email),
      createPending: (data) => createPendingAuthorRegistration(db, data, { ttlSeconds: AUTHOR_REGISTRATION_TTL_SECONDS }),
    });
    if (result.token) {
      (await cookies()).set(AUTHOR_COOKIE, result.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/auth", // only /auth/google reads it
        maxAge: AUTHOR_REGISTRATION_TTL_SECONDS,
      });
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error("register/author: error:", e?.code || e?.status || e?.message);
    return NextResponse.json({ error: "Registration is temporarily unavailable. Please try again later." }, { status: 500 });
  }
}
