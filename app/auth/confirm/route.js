// Email-verification callback. The link in the invitation/confirmation email
// lands here. We establish the session server-side (the server client's cookie
// adapter writes the auth cookies, which Next flushes onto the redirect) and
// then forward the user to the Create Password page. The session proves the
// email was verified — the Create Password page and /api/set-password both
// require it.
//
// Two link styles are supported so this works whether or not the Supabase email
// templates are customised:
//   * PKCE redirect   → `?code=...`           → exchangeCodeForSession
//   * token-hash link → `?token_hash=&type=`  → verifyOtp
//
// A missing/expired/already-used link never establishes a session; the user is
// sent to /login with a notice instead.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only allow forwarding to an in-app absolute path, never an external URL. */
function safeNext(next) {
  if (typeof next === "string" && next.startsWith("/") && !next.startsWith("//")) {
    return next;
  }
  return "/create-password";
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));

  const supabase = await createClient();

  let error;
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && type) {
    ({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }));
  } else {
    error = new Error("missing verification parameters");
  }

  // redirect() throws NEXT_REDIRECT; it must be called OUTSIDE the try/await
  // above so it is never swallowed, and Next attaches the queued Set-Cookie
  // headers to the redirect response.
  if (error) redirect("/login?notice=link_invalid");
  redirect(next);
}
