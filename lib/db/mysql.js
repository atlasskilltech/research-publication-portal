import "server-only";

import mysql from "mysql2/promise";
import { loadDbConfig } from "@/lib/config/env";

/**
 * MySQL connection layer for the Research Publication Portal.
 *
 * This replaces the Supabase Postgres client. The application talks to MySQL as
 * a SINGLE trusted database user (the one in DB_USER); there is no Row Level
 * Security and no per-request database identity. Therefore ALL authorization is
 * enforced in application code (see lib/paperAccess.js, lib/adminGuards.js and
 * the data-access layer), exactly where the old Postgres RLS policies and
 * SECURITY DEFINER functions used to enforce it.
 *
 * A single pool is shared across the process (and preserved across Next.js dev
 * hot-reloads via globalThis) so we never exhaust the server's connection quota.
 */

const globalForPool = globalThis;

/** The shared connection pool (lazily created on first use). */
export function pool() {
  if (!globalForPool.__rppMysqlPool) {
    const cfg = loadDbConfig();
    globalForPool.__rppMysqlPool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      connectionLimit: cfg.connectionLimit,
      queueLimit: cfg.queueLimit,
      connectTimeout: cfg.connectTimeoutMs,
      waitForConnections: true,
      // Keep decimals/bigints as JS numbers where safe; return DATETIME as JS
      // strings in UTC (we store and compare everything in UTC).
      timezone: "Z",
      dateStrings: true,
      // Named placeholders (:name) in addition to positional (?).
      namedPlaceholders: true,
      // We never use multiple statements in one query() call — defence in depth
      // against SQL injection via stacked queries.
      multipleStatements: false,
      charset: "utf8mb4",
    });
  }
  return globalForPool.__rppMysqlPool;
}

/**
 * Run a parameterized query and return the rows (array). Always use `params`
 * for user-supplied values — never string-concatenate them into `sql`.
 */
export async function query(sql, params) {
  const [rows] = await pool().execute(sql, params ?? []);
  return rows;
}

/** Return the first row of a query, or null. */
export async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * Run an INSERT/UPDATE/DELETE and return the raw ResultSetHeader
 * ({ affectedRows, insertId, ... }).
 */
export async function execute(sql, params) {
  const [result] = await pool().execute(sql, params ?? []);
  return result;
}

/**
 * Run `fn` inside a single transaction on a dedicated connection. `fn` receives
 * a `tx` helper with the same query/queryOne/execute shape bound to that
 * connection. The transaction commits if `fn` resolves and rolls back if it
 * throws (the error is re-thrown). This is how every former PL/pgSQL
 * SECURITY DEFINER function (request_paper_revision, save_editorial_decision,
 * schedule_publication, admin_set_user_roles, …) is reimplemented: lock the
 * rows with `SELECT … FOR UPDATE`, re-check authorization and the allowed
 * transition, then write — all or nothing.
 */
export async function withTransaction(fn) {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const tx = {
      conn,
      async query(sql, params) {
        const [rows] = await conn.execute(sql, params ?? []);
        return rows;
      },
      async queryOne(sql, params) {
        const [rows] = await conn.execute(sql, params ?? []);
        return rows.length ? rows[0] : null;
      },
      async execute(sql, params) {
        const [result] = await conn.execute(sql, params ?? []);
        return result;
      },
    };
    const out = await fn(tx);
    await conn.commit();
    return out;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore rollback failure — original error is what matters */
    }
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Serialize a critical section across connections using a named MySQL advisory
 * lock (GET_LOCK/RELEASE_LOCK), the MySQL equivalent of Postgres
 * pg_advisory_xact_lock. Used for admin-count-affecting changes (promote /
 * revoke / delete the last administrator) so concurrent requests cannot slip
 * past the "never remove the last admin" check.
 *
 * The lock is session-scoped, so it MUST be acquired and released on the SAME
 * connection — pass the `tx.conn` from withTransaction, or a dedicated
 * connection. `timeoutSeconds` bounds the wait (default 10s).
 */
export async function withAdvisoryLock(conn, name, fn, timeoutSeconds = 10) {
  const key = `rpp:${name}`;
  const [[{ got }]] = await conn.query("SELECT GET_LOCK(?, ?) AS got", [key, timeoutSeconds]);
  if (got !== 1) {
    const e = new Error(`could not acquire advisory lock ${name}`);
    e.code = "RPP_LOCK_TIMEOUT";
    throw e;
  }
  try {
    return await fn();
  } finally {
    try {
      await conn.query("SELECT RELEASE_LOCK(?)", [key]);
    } catch {
      /* ignore */
    }
  }
}

/** Close the pool (used by one-shot scripts so the process can exit). */
export async function closePool() {
  if (globalForPool.__rppMysqlPool) {
    await globalForPool.__rppMysqlPool.end();
    globalForPool.__rppMysqlPool = undefined;
  }
}
