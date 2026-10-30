import "server-only";

import { createClient } from "@supabase/supabase-js";
import { loadSupabaseConfig, loadSupabaseSecret } from "@/lib/config/env";

/**
 * Service-role Supabase client — bypasses Row Level Security.
 *
 * This authenticates with the SECRET key and can read and write any row, so it
 * must only ever run on the server. The `server-only` import turns an accidental
 * client import into a build error rather than a catastrophic key leak.
 *
 * Use it only for operations that genuinely require elevated access — notably
 * provisioning the administrator accounts through the Auth Admin API
 * (`auth.admin.*`). Ordinary request handling uses the RLS-bound client in
 * lib/supabase/server.js instead.
 *
 * Session persistence is disabled: this client represents no user and must not
 * read or write auth cookies.
 */
export function createAdminClient() {
  const { url } = loadSupabaseConfig();
  const secret = loadSupabaseSecret();

  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
