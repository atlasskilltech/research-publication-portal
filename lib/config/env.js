import "server-only";

import path from "node:path";
import os from "node:os";
import { resolveEmailConfig } from "@/lib/email/config";

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

// MySQL connection settings (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, and
// optional DB_CONNECTION_LIMIT / DB_QUEUE_LIMIT / DB_CONNECT_TIMEOUT_MS / DB_SSL /
// DB_SSL_CA) are read by lib/db/core.mjs dbConfigFromEnv(),
// shared with the scripts. Google Sign-In (GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI) is read by lib/googleAuth.js
// googleConfig(). All of them are server-only — never NEXT_PUBLIC_.

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
 * (the invite/confirmation/reset links). In production it
 * MUST be the real domain so links never point at localhost; locally it falls
 * back to the dev origin. Trailing slash is trimmed so callers can append paths.
 */
/**
 * Transactional email. SERVER-ONLY: none of these are NEXT_PUBLIC_.
 * Provider selection and every variable are documented in lib/email/config.js
 * (EMAIL_PROVIDER=sendgrid|smtp|resend, SENDGRID_API_KEY, EMAIL_FROM,
 * EMAIL_FROM_NAME, EMAIL_REPLY_TO, SMTP's EMAIL_ID/EMAIL_APP_PASSWORD, Resend's
 * RESEND_API_KEY). Returns raw values (possibly empty); lib/email/core.js
 * validates them and reports a "config" error instead of throwing, so a missing
 * credential never crashes a request. Credentials are never logged or returned.
 */
export function emailConfig() {
  return resolveEmailConfig(process.env);
}

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
 * Amazon S3 storage for manuscripts (server-only). Enabled when a bucket is set:
 *   S3_BUCKET (aliases: AWS_S3_BUCKET, AWS_BUCKET_NAME, AWS_BUCKET)
 *   AWS_REGION (or AWS_DEFAULT_REGION / S3_REGION; default ap-south-1)
 *   S3_PREFIX  (optional, default "manuscripts/")
 *   S3_ENDPOINT (optional, for S3-compatible stores)
 * Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or the EC2
 * instance role. The bucket must be PRIVATE (Block Public Access on).
 * Returns null when S3 is not configured → filesystem storage is used.
 */
export function s3StorageConfig() {
  const pick = (...names) => {
    for (const n of names) { const v = (process.env[n] || "").trim(); if (v) return v; }
    return "";
  };
  const bucket = pick("S3_BUCKET", "S3_BUCKET_NAME", "AWS_S3_BUCKET", "AWS_S3_BUCKET_NAME", "AWS_BUCKET_NAME", "AWS_BUCKET", "BUCKET_NAME");
  if (!bucket) return null;
  const region = pick("AWS_REGION", "AWS_DEFAULT_REGION", "S3_REGION", "AWS_S3_REGION", "AWS_BUCKET_REGION") || "ap-south-1";
  let prefix = process.env.S3_PREFIX === undefined ? "manuscripts/" : process.env.S3_PREFIX.trim();
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  const endpoint = pick("S3_ENDPOINT", "AWS_S3_ENDPOINT") || null;
  // Explicit keys under common alternative names; when absent the SDK's default
  // chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or the EC2 role) is used.
  const accessKeyId = pick("AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY", "S3_ACCESS_KEY_ID", "S3_ACCESS_KEY", "AWS_S3_ACCESS_KEY_ID", "AWS_S3_ACCESS_KEY");
  const secretAccessKey = pick("AWS_SECRET_ACCESS_KEY", "AWS_SECRET_KEY", "S3_SECRET_ACCESS_KEY", "S3_SECRET_KEY", "AWS_S3_SECRET_ACCESS_KEY", "AWS_S3_SECRET_KEY");
  const credentials = accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
  return { bucket, region, prefix, endpoint, credentials };
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
