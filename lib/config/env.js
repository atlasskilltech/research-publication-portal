import "server-only";

import path from "node:path";
import os from "node:os";

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

/**
 * Exact-email exceptions allowed to self-register IN ADDITION to the approved
 * domain(s) — e.g. an external tester. This does NOT open up a whole domain.
 *
 * Configurable and easy to remove after testing:
 *   - unset             → defaults to the single testing address below
 *   - ALLOWED_EMAILS=    → empty string disables ALL exceptions (domain-only)
 *   - ALLOWED_EMAILS=a@b.com,c@d.com → exactly those addresses
 */
export function allowedEmails() {
  const raw = process.env.ALLOWED_EMAILS;
  if (raw === undefined) return ["sf48116@gmail.com"]; // TEMP testing exception
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The original administrator accounts that must never be demoted or deleted
 * through the admin UI/API. Configurable via PROTECTED_ADMIN_EMAILS; defaults to
 * the two founding admins.
 */
export function protectedAdminEmails() {
  const raw = process.env.PROTECTED_ADMIN_EMAILS;
  if (raw === undefined) {
    return ["faizan.shaikh@atlasuniversity.edu.in", "elizabeth.jerome@atlasuniversity.edu.in"];
  }
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Public base URL of the deployed site, used for every email/auth redirect
 * (Supabase `emailRedirectTo`, the invite/confirmation links). In production it
 * MUST be the real domain so links never point at localhost; locally it falls
 * back to the dev origin. Trailing slash is trimmed so callers can append paths.
 */
export function siteUrl() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:5630";
  return raw.replace(/\/+$/, "");
}

/**
 * Secret API key for the university student-check endpoint. Server-only — it is
 * read here and used only from the server-side verification helper, and is NEVER
 * prefixed with NEXT_PUBLIC_, returned in a response, or logged.
 */
export function loadStudentCheckKey() {
  return required("STUDENT_CHECK_API_KEY");
}

/**
 * Endpoint for the student Application Number check. Overridable for testing via
 * STUDENT_CHECK_API_URL; defaults to the university UAT dashboard.
 */
export function studentCheckUrl() {
  return (
    process.env.STUDENT_CHECK_API_URL ||
    "https://uat-dashboard.atlasskilltech.app/api/app/student-check/exists"
  );
}

/**
 * Root directory for PRIVATE manuscript files on the server filesystem.
 *
 * Server-only (never NEXT_PUBLIC_). In production this MUST be set to a private,
 * persistent directory OUTSIDE the application/deploy folder — the EC2 instance
 * filesystem is not guaranteed persistent across redeploys/replacement, so this
 * should point at a mounted persistent volume the operator provisions. There is
 * no default in production (we refuse to invent a path and pretend it exists).
 *
 * In non-production a dev fallback under the OS temp dir is used so local work
 * runs without extra setup — still OUTSIDE the repo, never in public/.
 */
export function manuscriptStorageRoot() {
  const dir = process.env.MANUSCRIPT_STORAGE_DIR;
  if (dir && dir.trim()) return dir.trim();
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MANUSCRIPT_STORAGE_DIR is required in production: set it to a private, " +
        "persistent directory outside the application (never public/ or the deploy dir).",
    );
  }
  return path.join(os.tmpdir(), "rpp-manuscripts-dev");
}
