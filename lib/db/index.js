import "server-only";

import { createDb, createPool, dbConfigFromEnv } from "./core.mjs";

export { T } from "./tables.mjs";
export { DbError, isDuplicate, toDate, parseJson, json } from "./core.mjs";

/**
 * The application's single database handle (lazy; created on first use so
 * `next build` never needs DB credentials). Cached on globalThis so dev-mode
 * hot reloads don't open a new pool each time.
 *
 *   import { db, T } from "@/lib/db";
 *   const row = await db.one(`SELECT … FROM ${T.papers} WHERE id = ?`, [id]);
 *   await db.transaction(async (tx) => { … });
 */
const KEY = Symbol.for("rpp.mysql.db");

function instance() {
  if (!globalThis[KEY]) globalThis[KEY] = createDb(createPool(dbConfigFromEnv(process.env)));
  return globalThis[KEY];
}

export const db = {
  query: (sql, params) => instance().query(sql, params),
  one: (sql, params) => instance().one(sql, params),
  exec: (sql, params) => instance().exec(sql, params),
  transaction: (fn, opts) => instance().transaction(fn, opts),
};
