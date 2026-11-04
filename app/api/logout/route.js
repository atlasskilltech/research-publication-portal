// Sign-out: revoke this browser's session in MySQL and clear the cookie.
// Response contract is unchanged: always 200 `{ ok: true }`.
import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await endSession();
  } catch (e) {
    // The cookie is still cleared by the client being told it is signed out on
    // the next request the revoked/absent session fails validation anyway.
    console.error("logout: error:", e?.code || e?.message);
  }
  return NextResponse.json({ ok: true });
}
