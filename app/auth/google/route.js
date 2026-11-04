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
import { siteUrl } from "@/lib/config/env";
import { OAUTH_STATE_COOKIE, OAUTH_FLOW_TTL_SECONDS } from "@/lib/oauthPolicy";
import { beginGoogleSignIn, googleConfig } from "@/lib/googleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve against the configured public origin, not request.url, which behind
// the reverse proxy reports the internal origin (e.g. https://localhost:5630).
const toLogin = (notice) => NextResponse.redirect(new URL(`/login?notice=${notice}`, siteUrl()), 303);

export async function POST(request) {
  let next = "/dashboard";
  try {
    next = safeNextPath((await request.formData()).get("next"));
  } catch {
    // no/invalid body → default destination
  }

  const cfg = googleConfig();
  if (!cfg) return toLogin("google_unavailable");
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
    return toLogin("google_unavailable");
  }
}

// A GET (typed URL, prefetch, crawler) never starts an OAuth flow.
export function GET() {
  return NextResponse.redirect(new URL("/login", siteUrl()), 303);
}
