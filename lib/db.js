// Direct MySQL access via a shared mysql2/promise connection pool.
// Connection details come from DATABASE_URL (mysql://user:pass@host:port/db) so
// no environment change is needed when switching away from Prisma.
import mysql from "mysql2/promise";

function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const u = new URL(url);
  const config = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: "utf8mb4",
  };

  // Optional TLS when the URL requests it (e.g. ?ssl=true or ?sslaccept=...).
  const ssl = u.searchParams.get("ssl") || u.searchParams.get("sslaccept");
  if (ssl) config.ssl = { rejectUnauthorized: ssl !== "accept_invalid_certs" };

  return config;
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
