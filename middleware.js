// Edge gate for the authenticated (app) routes. It refreshes the Supabase
// session cookies on every matched request (so a short-lived access token is
// renewed transparently) and redirects to /login when there is no valid user.
// The authoritative check still runs server-side in app/(app)/layout.js, so a
// forged or stale cookie that somehow passes here is still rejected there.
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/papers/:path*",
    "/submissions/:path*",
    "/submit/:path*",
    "/reviews/:path*",
    "/activity/:path*",
    "/users/:path*",
    "/volumes/:path*",
    "/archive/:path*",
    "/import/:path*",
  ],
};
