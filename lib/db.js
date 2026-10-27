// Direct MySQL access via a shared mysql2/promise connection pool.
// Connection details come from DATABASE_URL (mysql://user:pass@host:port/db) so
// no environment change is needed when switching away from Prisma.
import mysql from "mysql2/promise";

// Pool options shared by both configuration paths.
const POOL_OPTS = {
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
};

// Translate an ssl hint ("true", "accept_invalid_certs", ...) into a mysql2
// ssl option, mirroring the DATABASE_URL query-param behavior for both paths.
function sslFromHint(hint) {
  if (!hint) return undefined;
  return { rejectUnauthorized: hint !== "accept_invalid_certs" };
}

// Path A (local dev / unchanged): a single DATABASE_URL connection string.
function configFromUrl(url) {
  const u = new URL(url);
  const config = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ...POOL_OPTS,
  };
  // Optional TLS when the URL requests it (e.g. ?ssl=true or ?sslaccept=...).
  const ssl = sslFromHint(u.searchParams.get("ssl") || u.searchParams.get("sslaccept"));
  if (ssl) config.ssl = ssl;
  return config;
}

// Path B (production compatibility): discrete DB_* variables. Host defaults to
// 127.0.0.1 and port to 3306 when DB_HOST/DB_PORT are not provided.
function configFromParts() {
  const { DB_USER, DB_PASS, DB_NAME, DB_HOST, DB_PORT, DB_SSL } = process.env;
  const missing = [];
  if (!DB_USER) missing.push("DB_USER");
  if (!DB_PASS) missing.push("DB_PASS");
  if (!DB_NAME) missing.push("DB_NAME");
  if (missing.length) {
    // Names only — never the values.
    throw new Error(
      `Database not configured: set DATABASE_URL, or DB_USER/DB_PASS/DB_NAME (missing: ${missing.join(", ")}).`,
    );
  }
  const config = {
    host: DB_HOST || "127.0.0.1",
    port: DB_PORT ? Number(DB_PORT) : 3306,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    ...POOL_OPTS,
  };
  const ssl = sslFromHint(DB_SSL);
  if (ssl) config.ssl = ssl;
  return config;
}

function buildConfig() {
  // Prefer DATABASE_URL so local development is unchanged; otherwise fall back
  // to discrete DB_* variables for environments configured that way.
  const url = process.env.DATABASE_URL;
  return url ? configFromUrl(url) : configFromParts();
}

// Lazily create one pool (reused across dev hot-reloads). buildConfig() — and
// therefore the DATABASE_URL requirement — is deferred to the first query, so
// importing this module during `next build` never needs a database URL. A
// genuinely missing/invalid URL still throws clearly on the first real query.
const globalForDb = globalThis;

export function getPool() {
  if (!globalForDb.__mysqlPool) {
    globalForDb.__mysqlPool = mysql.createPool(buildConfig());
  }
  return globalForDb.__mysqlPool;
}

/** Run a parameterized query and return all rows. */
export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** Run a parameterized query and return the first row, or null. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}
