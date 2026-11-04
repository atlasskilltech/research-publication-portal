// Start "Sign in with Google" (direct OpenID Connect, Authorization Code + PKCE).
//
// The login page POSTs here (CSRF-checked by middleware). We create a
// single-use state row in MySQL (state hash, nonce, PKCE verifier, safe next
// path; 10-minute expiry), bind the raw state to this browser with an httpOnly
// cookie, and redirect to Google. `hd` is only an account-chooser hint — the
// domain is enforced on the verified ID token in /auth/callback.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { safeNextPath } from "@/lib/authFlow";
import { OAUTH_STATE_COOKIE, OAUTH_FLOW_TTL_SECONDS } from "@/lib/oauthPolicy";
import { beginGoogleSignIn, googleConfig } from "@/lib/googleAuth";
import { publicUrl } from "@/lib/publicUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toLogin = (request, notice) => NextResponse.redirect(publicUrl(`/login?notice=${notice}`, request), 303);

export async function POST(request) {
  let next = "/dashboard";
  try {
    next = safeNextPath((await request.formData()).get("next"));
  } catch {
    // no/invalid body → default destination
  }

  const cfg = googleConfig();
  if (!cfg) {
    console.error("google-auth: not configured — check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI (must be https://<site>/auth/callback)");
    return toLogin(request, "google_unavailable");
  }
  try {
    const { url, state } = await beginGoogleSignIn(next, cfg);
    (await cookies()).set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // must survive the top-level redirect back from Google
      path: "/auth",
      maxAge: OAUTH_FLOW_TTL_SECONDS,
    });
    return NextResponse.redirect(url, 303);
  } catch (e) {
    console.error("google-auth: start failed:", e?.code || e?.message);
    return toLogin(request, "google_unavailable");
  }
}

// A GET (typed URL, prefetch, crawler) never starts an OAuth flow.
export function GET(request) {
  return NextResponse.redirect(publicUrl("/login", request), 303);
}
