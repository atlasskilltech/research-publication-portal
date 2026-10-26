// Server-side route protection for the authenticated (app) group.
// Uses the edge-safe config; the `authorized` callback decides access.
import NextAuth from "next-auth";
import authConfig from "./auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on the protected app routes only (skips static assets, api/auth, public pages).
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
