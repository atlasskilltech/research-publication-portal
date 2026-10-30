"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (the browser).
 *
 * Uses only the public NEXT_PUBLIC_* values — URL and publishable key — which
 * are safe to ship to the browser; Row Level Security guards the data. The
 * secret key is never referenced here.
 *
 * The current UI never needs this (sign-in/out/register go through the server
 * route handlers), but it is provided for any future client-side Supabase use,
 * such as a password-reset page that calls `auth.updateUser`.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
