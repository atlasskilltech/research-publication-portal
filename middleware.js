// Lightweight edge gate for the authenticated (app) routes: redirects to
// /login when the session cookie is absent. This only avoids rendering for
// requests that clearly have no session — the authoritative check (a DB lookup
// of the session token) runs server-side in app/(app)/layout.js, so a forged
// or stale cookie that passes this gate is still rejected there.
import { NextResponse } from "next/server";

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME || "rpp_session";

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
