import "server-only";

/**
 * Validated, typed access to environment configuration.
 *
 * Every value the data layer needs is read here and nowhere else, so pointing
 * the application at a different MySQL server is purely an `.env.local` change —
 * no application code changes. Reading a missing required variable throws with
 * a message naming the variable, rather than surfacing later as an opaque
 * connection error.
 *
 * Config is read LAZILY (through functions), never at module load. That keeps
 * `next build` safe: importing a route handler that reaches this module never
 * needs the database variables to be present, and — combined with the lazy pool
 * in lib/db.js — the build never opens a database connection.
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

/** Optional string — `''` is a legitimate value (e.g. a blank MySQL password). */
function optional(name, fallback = "") {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function integer(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, received "${raw}".`);
  }
  return parsed;
}

function boolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export const isProduction = process.env.NODE_ENV === "production";

/**
 * MySQL connection configuration, read and validated on each call.
 *
 * `DB_PASSWORD` is read with `optional` on purpose: a blank root password is
 * valid on a local XAMPP install, and `required` would reject it. Production
 * must set a real password in its own (gitignored) `.env.local`.
 */
export function loadDbConfig() {
  return Object.freeze({
    host: required("DB_HOST"),
    port: integer("DB_PORT", 3306),
    user: required("DB_USER"),
    password: optional("DB_PASSWORD"),
    database: required("DB_NAME"),
    connectionLimit: integer("DB_CONNECTION_LIMIT", 10),
    queueLimit: integer("DB_QUEUE_LIMIT", 0),
    connectTimeout: integer("DB_CONNECT_TIMEOUT_MS", 10_000),
    ssl: boolean("DB_SSL", false),
    sslCa: optional("DB_SSL_CA"),
    debug: boolean("DB_DEBUG", false),
  });
}

/**
 * Session settings. DB-backed sessions use a cryptographically random token
 * (only its SHA-256 hash is stored), so there is no signing secret to manage.
 */
export function loadSessionConfig() {
  return Object.freeze({
    cookieName: optional("SESSION_COOKIE_NAME", "rpp_session"),
    ttlSeconds: integer("SESSION_TTL_DAYS", 30) * 24 * 60 * 60,
  });
}

/**
 * Approved institutional email domain(s) for public registration.
 * Overridable via ALLOWED_EMAIL_DOMAINS (comma-separated) without code changes.
 */
export function allowedEmailDomains() {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS;
  if (!raw) return ["atlasuniversity.edu.in"];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Credentials-safe summary for health checks and error reporting. */
export function describeDbTarget(config) {
  const c = config ?? loadDbConfig();
  return `${c.host}:${c.port}/${c.database}`;
}
