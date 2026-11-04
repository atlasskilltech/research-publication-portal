/**
 * Row helpers shared by every MySQL query in the workflow layer.
 *
 * JSON columns come back as text from MariaDB and as objects from MySQL;
 * `jrow`/`jrows` normalise the known JSON columns to JS values so callers see
 * exactly the shapes they had with Postgres (arrays / objects).
 */
import { T } from "../db/tables.mjs";
import { uuid } from "../auth/crypto.mjs";

/** Every JSON column in the schema (papers.keywords, paper_activity.detail, …). */
const JSON_COLUMNS = new Set(["keywords", "detail", "review_ids", "responses", "authors"]);
const JSON_FALLBACK = { detail: {} };

export function jrow(row) {
  if (!row) return row;
  let out = row;
  for (const k of Object.keys(row)) {
    if (JSON_COLUMNS.has(k) && typeof row[k] === "string") {
      if (out === row) out = { ...row };
      try {
        out[k] = JSON.parse(row[k]);
      } catch {
        out[k] = JSON_FALLBACK[k] ?? [];
      }
    }
  }
  return out;
}
export const jrows = (rows) => (rows || []).map(jrow);

/** Insert one audit row into paper_activity. */
export async function logActivity(q, paperId, actorId, action, detail = {}) {
  await q.exec(
    `INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [uuid(), paperId, actorId || null, action, JSON.stringify(detail ?? {})],
  );
}

/** "IN (?)" needs a non-empty list; this returns a value that matches nothing. */
export const nonEmpty = (list) => (list && list.length ? list : ["\u0000none"]);
