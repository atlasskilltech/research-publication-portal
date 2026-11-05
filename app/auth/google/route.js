// Start "Sign in with Google" (direct OpenID Connect, Authorization Code + PKCE)
// — the ONE Google button for every role (Student, Faculty, Admin, Editor,
// Reviewer, Author).
//
// The login page (and the Author form's second step) POST here (CSRF-checked
// by middleware). We create a single-use state row in MySQL (state hash,
// nonce, PKCE verifier, safe next path; 10-minute expiry), bind the raw state
// to this browser with an httpOnly cookie, and redirect to Google. No `hd`
// hint: any Google account can be chosen; every rule is enforced on the
// verified ID token in /auth/callback.
//
// If this browser holds a pending Author registration (httpOnly
// rpp_author_reg cookie, set by /api/register/author — never read from the
// form), it is linked to the state row and its email sent as login_hint, so
// the callback can activate it when the verified Google email matches.
// Nothing here decides an account or a role.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { safeNextPath } from "@/lib/authFlow";
import { siteUrl } from "@/lib/config/env";
import { OAUTH_STATE_COOKIE, OAUTH_FLOW_TTL_SECONDS } from "@/lib/oauthPolicy";
import { beginGoogleSignIn, googleConfig } from "@/lib/googleAuth";
import { db } from "@/lib/db";
import { findPendingAuthorRegistrationByToken } from "@/lib/repos/authors.mjs";
import { AUTHOR_COOKIE } from "@/lib/authorRegistration";

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
    const jar = await cookies();
    let opts = {};
    const pendingToken = jar.get(AUTHOR_COOKIE)?.value;
    if (pendingToken) {
      // A lookup failure must never block ordinary sign-in.
      const reg = await findPendingAuthorRegistrationByToken(db, pendingToken).catch(() => null);
      if (reg) opts = { authorRegistrationId: reg.id, loginHint: reg.email };
    }
    const { url, state } = await beginGoogleSignIn(next, cfg, opts);
    jar.set(OAUTH_STATE_COOKIE, state, {
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
