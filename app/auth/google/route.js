// Start "Sign in with Google" (direct OpenID Connect, Authorization Code + PKCE).
//
// The login page POSTs here (CSRF-checked by middleware). We create a
// single-use state row in MySQL (state hash, nonce, PKCE verifier, safe next
// path; 10-minute expiry), bind the raw state to this browser with an httpOnly
// cookie, and redirect to Google. `hd` is only an account-chooser hint — the
// domain is enforced on the verified ID token in /auth/callback.
//
// External authors (AIDC 2026), via the hidden `intent` field:
//   intent=author         activate a pending Author registration: the pending
//                         row is found from this browser's httpOnly
//                         rpp_author_reg cookie (never from the form), linked to
//                         the state row, and its email is sent as login_hint.
//                         No/expired registration → back to the Author form.
//   intent=author_signin  returning Author: same flow without the `hd` hint so
//                         a non-university Google account can be chosen.
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
const toAuthorForm = (notice) => NextResponse.redirect(new URL(`/register?type=author&notice=${notice}`, siteUrl()), 303);

export async function POST(request) {
  let next = "/dashboard";
  let intent = "";
  try {
    const fd = await request.formData();
    next = safeNextPath(fd.get("next"));
    intent = String(fd.get("intent") || "");
  } catch {
    // no/invalid body → default destination
  }

  const cfg = googleConfig();
  if (!cfg) return intent === "author" ? toAuthorForm("google_unavailable") : toLogin("google_unavailable");
  try {
    const jar = await cookies();
    let opts = {};
    if (intent === "author") {
      const reg = await findPendingAuthorRegistrationByToken(db, jar.get(AUTHOR_COOKIE)?.value || "");
      if (!reg) return toAuthorForm("author_registration_expired");
      opts = { external: true, authorRegistrationId: reg.id, loginHint: reg.email };
      next = "/dashboard";
    } else if (intent === "author_signin") {
      opts = { external: true };
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
    return intent === "author" ? toAuthorForm("google_unavailable") : toLogin("google_unavailable");
  }
}

// A GET (typed URL, prefetch, crawler) never starts an OAuth flow.
export function GET() {
  return NextResponse.redirect(new URL("/login", siteUrl()), 303);
}
