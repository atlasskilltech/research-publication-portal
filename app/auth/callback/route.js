// Finish "Sign in with Google" — GET /auth/callback?code&state from Google.
// All checks are in lib/oauthPolicy.completeGoogleCallback (state cookie +
// single-use DB state, PKCE code exchange, ID token signature/iss/aud/exp,
// nonce, email_verified, exact domain + hd, existing-account match). Rejected
// → /login with a clear notice; no session, no account, no role is created.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { safeNextPath } from "@/lib/authFlow";
import { siteUrl } from "@/lib/config/env";
import { OAUTH_STATE_COOKIE, completeGoogleCallback } from "@/lib/oauthPolicy";
import {
  googleConfig, consumeState, exchangeCode, verifyIdToken, findIdentity, findUser, linkedSubFor, completeSignIn,
} from "@/lib/googleAuth";
import { AUTHOR_COOKIE } from "@/lib/authorRegistration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const jar = await cookies();
  const cookieState = jar.get(OAUTH_STATE_COOKIE)?.value || "";
  // Single use: the state cookie is cleared whatever the outcome.
  jar.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/auth", maxAge: 0 });

  const cfg = googleConfig();
  let result;
  if (!cfg) {
    result = { redirect: "/login?notice=google_unavailable", outcome: "not_configured" };
  } else {
    try {
      result = await completeGoogleCallback(
        { params, cookieState },
        {
          clientId: cfg.clientId,
          consumeState,
          exchangeCode: (code, verifier) => exchangeCode(code, verifier, cfg),
          verifyIdToken: (t) => verifyIdToken(t, cfg),
          findIdentity,
          findUserByEmail: findUser,
          linkedSubFor,
          completeSignIn,
          safeNext: (raw) => safeNextPath(raw),
        },
      );
    } catch (e) {
      console.error("google-auth: callback error:", e?.code || e?.message);
      result = { redirect: "/login?notice=google_failed", outcome: "error" };
    }
  }
  if (result.outcome !== "ok") console.warn("google-auth: sign-in refused:", result.outcome);

  // Resolve against the configured public origin (NEXT_PUBLIC_SITE_URL), NOT
  // request.url: behind the reverse proxy the request reports the internal
  // origin (e.g. https://localhost:5630), which would send the browser to
  // https://localhost:5630/dashboard after sign-in. result.redirect is always a
  // safe same-site app path (see completeGoogleCallback / safeNextPath).
  const res = NextResponse.redirect(new URL(result.redirect, siteUrl()), 303);
  // Clear any stale cookie from the earlier Google-based Author flow.
  res.cookies.set(AUTHOR_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/auth", maxAge: 0 });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
