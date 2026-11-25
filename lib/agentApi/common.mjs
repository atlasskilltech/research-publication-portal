/**
 * IntelligenceOS Agent API — helpers shared by every action file.
 * No framework imports (used by the Next route and the Node test scripts).
 */
import { T } from "../db/tables.mjs";
import { REF_PATTERN } from "../paperRef.mjs";
import { SCHOOLS } from "../constants.js";

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;
export const DEPARTMENTS = Object.freeze(Object.keys(SCHOOLS)); // ISDI, ISME, uGDX, LAW

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const iso = (v) => (v ? new Date(v).toISOString() : null);
/** DATE columns → "YYYY-MM-DD" (no timezone shift). */
export const day = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  const d = new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const departmentName = (code) => {
  if (!code) return null;
  const k = DEPARTMENTS.find((d) => d.toLowerCase() === String(code).toLowerCase());
  return k ? SCHOOLS[k].name : null;
};

/** Paper row → the summary every action returns (never author identity). */
export const submissionSummary = (p) => ({
  id: p.id,
  refId: p.ref_id || null,
  title: p.title,
  status: p.status,
  department: p.school_code || null,
  departmentName: departmentName(p.school_code),
  currentRound: p.current_round,
  submittedAt: iso(p.created_at),
  updatedAt: iso(p.updated_at),
});

/** Short paper reference used inside other records. */
export const paperRef = (p) => ({ id: p.id, refId: p.ref_id || null, title: p.title, status: p.status });

/** Date range from YYYY-MM-DD strings (to = inclusive). → { parts, params } */
export function dateRange(query, col = "created_at") {
  const parts = [];
  const params = [];
  if (query.from && query.to && query.from > query.to) throw new ActionError(400, "from must be on or before to");
  if (query.from) { parts.push(`${col} >= ?`); params.push(new Date(`${query.from}T00:00:00.000Z`)); }
  if (query.to) {
    const end = new Date(`${query.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    parts.push(`${col} < ?`);
    params.push(end);
  }
  return { parts, params };
}

/** Find a paper by UUID or reference ID (ISDI-2026-0001). 404 when missing. */
export async function findPaper(q, id, { forUpdate = false } = {}) {
  const lock = forUpdate ? " FOR UPDATE" : "";
  const cols = "id, ref_id, title, abstract, keywords, school_code, status, submitted_by, current_round, created_at, updated_at";
  let row = null;
  if (UUID_RE.test(id)) row = await q.one(`SELECT ${cols} FROM \`${T.papers}\` WHERE id = ?${lock}`, [id.toLowerCase()]);
  else if (REF_PATTERN.test(id.toUpperCase())) row = await q.one(`SELECT ${cols} FROM \`${T.papers}\` WHERE ref_id = ?${lock}`, [id.toUpperCase()]);
  if (!row) throw new ActionError(404, "Submission not found");
  return row;
}

export const dateParam = (name, description) => ({ name, in: "query", type: "string", required: false, pattern: DATE_RE, description });
export const limitParam = (what = "records") => ({
  name: "limit", in: "query", type: "integer", required: false, min: 1, max: MAX_LIMIT, default: DEFAULT_LIMIT,
  description: `How many ${what} to return (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
});
export const idParam = { name: "id", in: "path", type: "string", required: true, maxLength: 64, description: "Submission id (UUID) or reference ID such as ISDI-2026-0001." };
export const submissionFilterParam = { name: "submission", in: "query", type: "string", required: false, maxLength: 64, description: "Only this submission (id or reference ID such as ISDI-2026-0001)." };

/** `IN (?)` with an empty list matches nothing in MySQL only if we guard it. */
export const nonEmpty = (list) => (list && list.length ? list : ["00000000-0000-0000-0000-000000000000"]);
