// Lightweight edge gate for the authenticated (app) routes: redirects to /login
// when the session cookie is absent. Full session validation (DB lookup) runs
// server-side in app/(app)/layout.js — this only avoids rendering for requests
// that clearly have no session.
import { NextResponse } from "next/server";

const SESSION_COOKIE = "rpp_session";

export function middleware(request) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/papers/:path*",
    "/submissions/:path*",
    "/submit/:path*",
    "/activity/:path*",
    "/users/:path*",
    "/volumes/:path*",
    "/archive/:path*",
    "/import/:path*",
  ],
};
