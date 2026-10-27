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

// Reuse one pool across dev hot-reloads to avoid exhausting connections.
const globalForDb = globalThis;
export const pool = globalForDb.__mysqlPool ?? mysql.createPool(buildConfig());
if (process.env.NODE_ENV !== "production") globalForDb.__mysqlPool = pool;

/** Run a parameterized query and return all rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run a parameterized query and return the first row, or null. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}
