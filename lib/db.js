import "server-only";

import mysql from "mysql2/promise";
import { loadDbConfig, describeDbTarget } from "@/lib/config/env";

/**
 * The single MySQL access point for the entire application.
 *
 * Nothing above this file imports `mysql2`. Server code calls the helpers
 * exported here; React client components never call either. The `server-only`
 * import turns an accidental client import into a build error rather than a
 * runtime credential leak.
 *
 * Every helper parameterises its SQL — values are passed to the driver as a
 * separate array and are never interpolated into the statement string.
 *
 * The pool is created LAZILY, on the first query. Creating it never opens a
 * socket (mysql2 connects on first use), and deferring construction means
 * importing this module during `next build` never needs the DB_* variables and
 * never touches the database.
 */

/**
 * Next.js reloads modules on every edit in development, which would otherwise
 * leak a new pool (and its sockets) per reload. Caching on `globalThis` keeps
 * exactly one pool per process.
 */
const globalForDb = globalThis;

/**
 * The SQL mode every connection runs under.
 *
 * `STRICT_TRANS_TABLES` is the reason this exists: without it MySQL silently
 * truncates an over-long value and reports success, so the application stores
 * data the user never wrote. Setting it here means the same request behaves
 * identically on every server rather than depending on each server's default.
 */
const SQL_MODE = [
  "STRICT_TRANS_TABLES",
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
  "NO_ENGINE_SUBSTITUTION",
].join(",");

function buildPool() {
  const config = loadDbConfig();
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,

    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    queueLimit: config.queueLimit,
    connectTimeout: config.connectTimeout,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,

    // Treat DATETIME/TIMESTAMP as UTC in both directions so values never shift
    // with the server's local timezone.
    timezone: "Z",
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    charset: "utf8mb4_unicode_ci",
    multipleStatements: false, // defence in depth against statement injection

    ...(config.ssl
      ? { ssl: config.sslCa ? { ca: config.sslCa } : { rejectUnauthorized: true } }
      : {}),
  });

  // Applied per connection (mysql2 offers no pool option for sql_mode). A
  // failure is logged rather than thrown: the connection is still usable, and
  // refusing the request is a worse outcome than the server's own mode.
  pool.on("connection", (connection) => {
    connection.query(`SET SESSION sql_mode = '${SQL_MODE}'`, (error) => {
      if (error) console.error("db: could not set session sql_mode:", error.message);
    });
  });

  return pool;
}

/** Returns the one shared pool, creating it on first use. */
export function getPool() {
  if (!globalForDb.__rppPool) {
    globalForDb.__rppPool = buildPool();
  }
  return globalForDb.__rppPool;
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Wraps driver errors so callers get a stable shape, and so raw MySQL messages
 * (which can echo query fragments) never reach a response body.
 */
export class DatabaseError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = "DatabaseError";
    this.code = code ?? cause?.code ?? "DB_ERROR";
    if (cause) this.cause = cause;
  }

  /** True when the failure was a duplicate value on a UNIQUE key. */
  get isDuplicate() {
    return this.code === "ER_DUP_ENTRY";
  }

  /** True when a foreign key constraint rejected the write. */
  get isForeignKeyViolation() {
    return (
      this.code === "ER_NO_REFERENCED_ROW_2" ||
      this.code === "ER_ROW_IS_REFERENCED_2" ||
      this.code === "ER_NO_REFERENCED_ROW"
    );
  }
}

function fail(error) {
  throw new DatabaseError(`Database query failed (${error.code ?? "unknown"})`, {
    cause: error,
    code: error.code,
  });
}

/* -------------------------------------------------------------------------- */
/* Core helpers                                                               */
/* -------------------------------------------------------------------------- */

async function run(executor, sql, params) {
  try {
    const [result] = await executor.execute(sql, params);
    return result;
  } catch (error) {
    fail(error);
  }
}

/**
 * Run a SELECT and return every row.
 * @param {string} sql       Statement with `?` placeholders.
 * @param {Array}  [params]  Values bound by the driver, never interpolated.
 * @param {object} [conn]    Optional connection, for use inside a transaction.
 */
export async function query(sql, params = [], conn) {
  return run(conn ?? getPool(), sql, params);
}

/** Run a SELECT expected to match at most one row. Returns the row or null. */
export async function queryOne(sql, params = [], conn) {
  const rows = await run(conn ?? getPool(), sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Run an INSERT/UPDATE/DELETE. */
export async function execute(sql, params = [], conn) {
  const result = await run(conn ?? getPool(), sql, params);
  return {
    affectedRows: result.affectedRows ?? 0,
    insertId: result.insertId ?? 0,
    changedRows: result.changedRows ?? 0,
  };
}

/** Convenience for INSERTs — returns the new primary key. */
export async function insert(sql, params = [], conn) {
  const { insertId } = await execute(sql, params, conn);
  return insertId;
}

/** Scalar SELECT, e.g. `SELECT COUNT(*) AS total ...`. */
export async function queryValue(sql, params = [], conn) {
  const row = await queryOne(sql, params, conn);
  if (!row) return null;
  const values = Object.values(row);
  return values.length > 0 ? values[0] : null;
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Run `callback` inside a transaction on a dedicated connection. Commits on
 * success, rolls back on any throw, and always releases the connection.
 */
export async function transaction(callback) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* the original error below is the one worth surfacing */
    }
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(`Transaction failed: ${error.message}`, { cause: error });
  } finally {
    connection.release();
  }
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

/** Liveness probe for a health route. Never returns credentials. */
export async function healthCheck() {
  const startedAt = performance.now();
  try {
    await getPool().query("SELECT 1");
    return {
      ok: true,
      target: describeDbTarget(),
      latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    };
  } catch (error) {
    return {
      ok: false,
      target: describeDbTarget(),
      code: error.code ?? "UNKNOWN",
      message: "Unable to reach the database.",
    };
  }
}

/** Closes the pool. For scripts and tests — the server keeps it open. */
export async function closePool() {
  if (globalForDb.__rppPool) {
    await globalForDb.__rppPool.end();
    delete globalForDb.__rppPool;
  }
}
