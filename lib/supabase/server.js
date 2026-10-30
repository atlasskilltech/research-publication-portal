import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { loadSupabaseConfig } from "@/lib/config/env";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * It authenticates with the PUBLISHABLE (anon) key and carries the signed-in
 * user's session through httpOnly cookies, so every query it runs is subject to
 * Row Level Security as that user. Privileged work that must bypass RLS uses the
 * separate service-role client in lib/supabase/admin.js instead.
 *
 * A fresh client is created per request (cookies are request-scoped). The
 * `setAll` write is wrapped in try/catch because cookies cannot be written from
 * a Server Component render — there it is a harmless no-op, and the session is
 * refreshed in middleware where writes are allowed.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = loadSupabaseConfig();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component render — ignore; middleware refreshes.
        }
      },
    },
  });
}
