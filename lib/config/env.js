import "server-only";

/**
 * Validated, typed access to environment configuration.
 *
 * Every value the application needs is read here and nowhere else, and lazily
 * (through functions) rather than at module load — so importing a route that
 * reaches this module during `next build` never requires the variables to be
 * present and never fails the build.
 */

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        "Copy .env.example to .env.local and fill it in.",
    );
  }
  return value;
}

/**
 * Public Supabase configuration — the project URL and the publishable
 * (anon-equivalent) key. Both are safe to expose to the browser: they carry no
 * privileged access on their own, and every table's Row Level Security is what
 * actually guards the data.
 */
export function loadSupabaseConfig() {
  return Object.freeze({
    url: required("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  });
}

/**
 * The Supabase SECRET (service-role) key. This bypasses Row Level Security, so
 * it is read ONLY here and used ONLY from server-only modules
 * (lib/supabase/admin.js and the admin scripts). It is never a NEXT_PUBLIC_
 * variable, so it is never bundled into client code.
 */
export function loadSupabaseSecret() {
  return required("SUPABASE_SECRET_KEY");
}

/**
 * Approved institutional email domain(s) for public registration.
 * Overridable via ALLOWED_EMAIL_DOMAINS (comma-separated) without code changes;
 * defaults to the university domain when unset.
 */
export function allowedEmailDomains() {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS;
  if (!raw) return ["atlasuniversity.edu.in"];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
