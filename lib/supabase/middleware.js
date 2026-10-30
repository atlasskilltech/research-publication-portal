import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session on every matched request and gates the
 * authenticated app routes.
 *
 * Why it must run in middleware: Supabase access tokens are short-lived. Server
 * Components cannot write cookies, so without this step a user's session could
 * not be silently refreshed and they would be logged out when the token expired.
 * Here, `getUser()` (which revalidates the token against Supabase, unlike simply
 * reading the cookie) triggers a refresh, and the new cookies are written onto
 * the response.
 *
 * The gate only decides whether to RENDER a protected route; the authoritative
 * identity check still runs server-side in app/(app)/layout.js.
 */
export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser(), and do
  // not remove getUser() — it is what refreshes the session cookies above.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return response;
}
