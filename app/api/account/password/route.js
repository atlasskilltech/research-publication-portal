// Optional password for a signed-in user who has none (e.g. a user who
// registered and signs in with Google).
//   POST { password, confirm }
// Requires a normal APP session (the user id comes ONLY from the session
// cookie, never the request). The password is hashed with Argon2id and stored
// only if the account has no password yet — an existing password is never
// overwritten here (changing one stays on "Forgot password"). Other devices are
// signed out; this browser stays signed in. Roles and the admin flag are never
// touched. Same-origin is enforced for every POST by middleware.js.
//
//   200 { ok } | 401 { code: "signin_required" } | 409 { code: "password_exists" } | 422 { error, issues } | 500
import { NextResponse } from "next/server";
import { addPassword } from "@/lib/authFlow";
import { addPasswordDeps } from "@/lib/authServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  try {
    const result = await addPassword({ password: body?.password, confirm: body?.confirm }, addPasswordDeps);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("account password: error:", e?.code || "unexpected");
    return NextResponse.json({ error: "This is temporarily unavailable. Please try again later." }, { status: 500 });
  }
}
