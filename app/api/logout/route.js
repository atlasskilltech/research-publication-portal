// Sign-out: end the Supabase session. `signOut` clears the auth cookies via the
// SSR cookie adapter. Response contract is unchanged: always 200 `{ ok: true }`.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (e) {
    // Even if the server call fails, the client is told it is signed out; the
    // session expires on its own.
    console.error("logout: error:", e?.status || e?.message);
  }

  return NextResponse.json({ ok: true });
}
