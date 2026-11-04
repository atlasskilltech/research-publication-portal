// Edge middleware (no database access here — Edge can't reach MySQL):
//
//  1. CSRF: every state-changing request (POST/PUT/PATCH/DELETE) to the API and
//     auth endpoints must be same-origin. A browser always sends `Origin` (and
//     `Sec-Fetch-Site`) on cross-site POSTs, so a mismatch is rejected with 403.
//     Requests with neither header come from non-browser clients, which cannot
//     ride a victim's cookies. Session cookies are also SameSite=Lax.
//  2. Fast gate for the authenticated app pages: no session cookie → /login.
//     The AUTHORITATIVE check (token hash, expiry, idle timeout, revocation,
//     account status) runs server-side in getSessionUser() (app/(app)/layout.js
//     and every API route), so a forged cookie that passes here is still refused.
import { NextResponse } from "next/server";

const SESSION_COOKIE = "rpp_sid"; // keep in sync with lib/auth/store.mjs
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const APP_PREFIXES = [
  "/dashboard", "/papers", "/submissions", "/submit", "/reviews", "/revisions", "/editorial",
  "/publications/manage", "/activity", "/users", "/volumes", "/archive", "/import",
];

function allowedOrigins(request) {
  const set = new Set([request.nextUrl.origin]);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  if (host) set.add(`${proto}://${host}`);
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try { set.add(new URL(site).origin); } catch { /* ignore */ }
  }
  return set;
}

export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (MUTATING.has(request.method) && (pathname.startsWith("/api/") || pathname.startsWith("/auth/"))) {
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if ((origin && origin !== "null" && !allowedOrigins(request).has(origin)) || origin === "null" || site === "cross-site") {
      return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!request.cookies.get(SESSION_COOKIE)?.value) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/auth/:path*",
    "/dashboard/:path*", "/papers/:path*", "/submissions/:path*", "/submit/:path*", "/reviews/:path*",
    "/revisions/:path*", "/editorial/:path*", "/publications/manage/:path*", "/activity/:path*",
    "/users/:path*", "/volumes/:path*", "/archive/:path*", "/import/:path*",
  ],
};
