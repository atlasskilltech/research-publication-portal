/**
 * MySQL access core — the ONE connection implementation, shared by the Next
 * app (via lib/db/index.js) and the Node scripts (migrations, provisioning,
 * tests). No framework imports.
 *
 *  - mysql2 connection pool; every query is parameterized (`?` placeholders,
 *    client-side escaping — arrays expand safely for `IN (?)`).
 *  - Every pooled connection is pinned to UTC (`time_zone='+00:00'`) and a
 *    strict sql_mode, regardless of the server's global settings.
 *  - Row values are normalised to what the application expects:
 *      TINYINT(1)      → boolean
 *      DATETIME/TIMESTAMP → ISO-8601 UTC string ("2026-11-04T05:48:07.123Z")
 *      DATE            → "YYYY-MM-DD"
 *      BIGINT          → number (values here are far below 2^53)
 *    JSON columns are parsed explicitly by the repositories (`parseJson`)
 *    because MariaDB returns JSON as text while MySQL returns objects.
 *  - Errors are re-thrown as DbError carrying only the driver code — never the
 *    SQL parameters (which can contain personal data or token hashes).
 */
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

export const SESSION_SQL_MODE =
  "STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"; // same as Atlas Forge

export class DbError extends Error {
  constructor(cause) {
    super(`Database error${cause?.code ? ` (${cause.code})` : ""}`);
    this.name = "DbError";
    this.code = cause?.code || "DB_ERROR";
    this.errno = cause?.errno;
    this.sqlState = cause?.sqlState;
    // For duplicate-key errors keep ONLY the index name (e.g. "research_volumes_year_number_uq")
    // so callers can give a precise message — never the duplicated value itself.
    const m = cause?.errno === 1062 ? /for key '(?:[^'.]*\.)?([^']+)'/.exec(String(cause?.sqlMessage || cause?.message || "")) : null;
    this.key = m ? m[1] : undefined;
  }
}

export const isDuplicate = (e) => e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
export const isDeadlock = (e) => e?.code === "ER_LOCK_DEADLOCK" || e?.errno === 1213 || e?.errno === 1205;

const int = (v, d) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) && n >= 0 ? n : d;
};
const bool = (v) => ["1", "true", "yes", "on"].includes(String(v || "").toLowerCase());

/**
 * Pool config from the environment — same variable names as Atlas Forge:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME (required, password may be blank locally)
 *   DB_CONNECTION_LIMIT (10), DB_QUEUE_LIMIT (0 = unbounded), DB_CONNECT_TIMEOUT_MS (10000)
 *   DB_SSL (false), DB_SSL_CA (PEM text or a path to a PEM file)
 * Back-compat aliases: DB_PASS → DB_PASSWORD, DB_POOL_SIZE → DB_CONNECTION_LIMIT.
 */
export function dbConfigFromEnv(env = process.env) {
  const need = (k) => {
    const v = env[k];
    if (v === undefined || v === "") throw new Error(`Missing required environment variable ${k}.`);
    return v;
  };
  let ssl;
  if (bool(env.DB_SSL)) {
    ssl = { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== "false" };
    const ca = env.DB_SSL_CA;
    if (ca) ssl.ca = ca.includes("-----BEGIN") ? ca : readFileSync(ca, "utf8");
  }
  return {
    host: need("DB_HOST"),
    port: int(env.DB_PORT, 3306),
    user: need("DB_USER"),
    password: env.DB_PASSWORD ?? env.DB_PASS ?? "",
    database: need("DB_NAME"),
    connectionLimit: int(env.DB_CONNECTION_LIMIT ?? env.DB_POOL_SIZE, 10) || 10,
    queueLimit: int(env.DB_QUEUE_LIMIT, 0),
    connectTimeout: int(env.DB_CONNECT_TIMEOUT_MS, 10_000) || 10_000,
    ssl,
  };
}

function typeCast(field, next) {
  if (field.type === "TINY" && field.length === 1) {
    const v = field.string();
    return v === null ? null : v === "1";
  }
  if (field.type === "DATETIME" || field.type === "TIMESTAMP") {
    const v = field.string();
    if (v === null) return null;
    const [d, tm = "00:00:00"] = v.split(" ");
    const [hms, frac = ""] = tm.split(".");
    return `${d}T${hms}.${(frac + "000").slice(0, 3)}Z`;
  }
  if (field.type === "DATE") return field.string();
  if (field.type === "LONGLONG") {
    const v = field.string();
    return v === null ? null : Number(v);
  }
  if (field.type === "NEWDECIMAL") {
    const v = field.string();
    return v === null ? null : Number(v);
  }
  return next();
}

export function createPool(config) {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    connectionLimit: config.connectionLimit || 10,
    waitForConnections: true,
    queueLimit: config.queueLimit ?? 0,
    enableKeepAlive: true,
    charset: "utf8mb4_unicode_ci",
    timezone: "Z", // JS Date parameters are written as UTC
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
    namedPlaceholders: false,
    connectTimeout: config.connectTimeout || 10_000,
    typeCast,
  });
  // Pin every physical connection to UTC + strict mode.
  pool.pool.on("connection", (conn) => {
    conn.query(`SET time_zone = '+00:00', sql_mode = '${SESSION_SQL_MODE}'`);
  });
  return pool;
}

/** Normalise a parameter: ISO strings for DATETIME are passed as Date objects by callers. */
function wrap(runner) {
  const query = async (sql, params = []) => {
    try {
      const [rows] = await runner.query(sql, params);
      return rows;
    } catch (e) {
      throw new DbError(e);
    }
  };
  return {
    query,
    /** First row or null. */
    one: async (sql, params) => (await query(sql, params))[0] || null,
    /** Result header for INSERT/UPDATE/DELETE: { affectedRows, insertId }. */
    exec: async (sql, params) => {
      const r = await query(sql, params);
      return { affectedRows: r.affectedRows, insertId: r.insertId, changedRows: r.changedRows };
    },
  };
}

/**
 * Database handle over a pool: query/one/exec + transaction(fn).
 * transaction() runs fn(tx) on one connection inside BEGIN/COMMIT, rolls back
 * on any throw, and retries the whole unit up to 2 times on deadlock.
 */
export function createDb(pool) {
  const base = wrap(pool);
  async function transaction(fn, { retries = 2 } = {}) {
    for (let attempt = 0; ; attempt++) {
      let conn;
      try {
        conn = await pool.getConnection();
      } catch (e) {
        throw new DbError(e);
      }
      const tx = wrap(conn);
      try {
        await conn.beginTransaction();
        const result = await fn(tx);
        await conn.commit();
        return result;
      } catch (e) {
        try { await conn.rollback(); } catch { /* connection may be gone */ }
        const raw = e instanceof DbError ? e : null;
        if (raw && isDeadlock(raw) && attempt < retries) continue;
        throw e;
      } finally {
        conn.release();
      }
    }
  }
  return { ...base, transaction, pool, end: () => pool.end() };
}

// ---- Value helpers --------------------------------------------------------------

/** ISO string / Date / null → Date (for DATETIME parameters) or null. */
export function toDate(v) {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("toDate: invalid date");
  return d;
}

/** JSON column value (string from MariaDB, object from MySQL) → JS value. */
export function parseJson(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** JS value → JSON text for a JSON column parameter. */
export const json = (v) => JSON.stringify(v ?? null);
