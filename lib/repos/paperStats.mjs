/**
 * Admin paper statistics (MySQL / MariaDB) — read-only aggregation over the
 * EXISTING research_* tables; nothing new is stored.
 *
 * A user's relationship to a paper comes from three existing places:
 *   SUBMITTER      research_papers.submitted_by = user
 *   CO_AUTHOR      research_paper_authors.email = user's email (authors carry
 *                  no user id; emails are stored lower-case, and the unicode_ci
 *                  collation compares case-insensitively)
 *   SPOC (= POC), DESK_REVIEWER, PEER_REVIEWER, EDITOR
 *                  research_paper_assignments (assignee, role) — per-paper
 *
 * All counts are COUNT(DISTINCT paper id) over the UNION of those links, so a
 * paper is counted once per user however many author rows / assignments tie
 * it to them. Everything is aggregated in SQL (one query per screen; roles for
 * a page of users in one more), with LIMIT/OFFSET pagination.
 *
 * Status buckets: Under review = UNDER_REVIEW; Accepted = ACCEPTED or
 * PUBLISHED (a published paper was accepted); Rejected = REJECTED.
 */
import { T } from "../db/tables.mjs";

export const AUTHOR_RELS = Object.freeze(["SUBMITTER", "CO_AUTHOR"]);
export const ASSIGN_RELS = Object.freeze(["SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"]);
export const PAPER_STATUSES = Object.freeze(["SUBMITTED", "UNDER_REVIEW", "REVISION", "ACCEPTED", "REJECTED", "PUBLISHED", "ARCHIVED"]);
export const ROLE_FILTERS = Object.freeze(["STUDENT", "FACULTY", "AUTHOR", "POC", "REVIEWER", "EDITOR", "ADMIN"]);
// ORDER BY clauses over the aggregated columns (id last → stable pagination).
export const SORTS = Object.freeze({
  total_desc: "g.total DESC, g.name ASC, g.id ASC",
  total_asc: "g.total ASC, g.name ASC, g.id ASC",
  submitted_desc: "g.submitted DESC, g.total DESC, g.name ASC, g.id ASC",
  assigned_desc: "g.assigned DESC, g.total DESC, g.name ASC, g.id ASC",
  name_asc: "g.name ASC, g.email ASC, g.id ASC",
});
export const MAX_PAGE_SIZE = 100;

const list = (a) => a.map((v) => `'${v}'`).join(", "); // constants only — never user input

/**
 * Every (user, paper, relationship) link. `forUser` restricts each branch to
 * one user (detail view) so the indexes on submitted_by / assignee are used.
 */
function linksSql(forUser) {
  const w = (col) => (forUser ? ` AND ${col} = ?` : "");
  const sql = `
    SELECT p0.submitted_by AS user_id, p0.id AS paper_id, 'SUBMITTER' AS rel
      FROM \`${T.papers}\` p0 WHERE p0.submitted_by IS NOT NULL${w("p0.submitted_by")}
    UNION ALL
    SELECT u0.id, pa.paper_id, 'CO_AUTHOR'
      FROM \`${T.paperAuthors}\` pa JOIN \`${T.users}\` u0 ON u0.email = pa.email
     WHERE pa.email IS NOT NULL${w("u0.id")}
    UNION ALL
    SELECT a0.assignee, a0.paper_id, a0.role
      FROM \`${T.paperAssignments}\` a0 WHERE 1 = 1${w("a0.assignee")}`;
  return { sql, params: forUser ? [forUser, forUser, forUser] : [] };
}

const toInt = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

/** Whitelist + clamp the query-string options (pure). */
export function normalizeStatsQuery(q = {}) {
  const get = (k) => (typeof q.get === "function" ? q.get(k) : q[k]);
  const search = String(get("search") || "").trim().slice(0, 100);
  const role = String(get("role") || "").toUpperCase();
  const status = String(get("status") || "").toUpperCase();
  const sort = String(get("sort") || "total_desc");
  const zero = get("includeZero");
  return {
    search,
    role: ROLE_FILTERS.includes(role) ? role : "",
    status: PAPER_STATUSES.includes(status) ? status : "",
    sort: Object.hasOwn(SORTS, sort) ? sort : "total_desc",
    includeZero: !(zero === "0" || zero === "false" || zero === false),
    page: Math.max(1, toInt(get("page"), 1)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(get("pageSize"), 25))),
  };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function roleWhere(role) {
  const hasRole = (roles) => `(EXISTS (SELECT 1 FROM \`${T.userRoles}\` r WHERE r.user_id = u.id AND r.role IN (${list(roles)}))
      OR EXISTS (SELECT 1 FROM \`${T.paperAssignments}\` ra WHERE ra.assignee = u.id AND ra.role IN (${list(roles)})))`;
  switch (role) {
    case "STUDENT": case "FACULTY": case "AUTHOR": return `u.baseType = '${role}'`;
    case "POC": return hasRole(["SPOC"]);
    case "REVIEWER": return hasRole(["DESK_REVIEWER", "PEER_REVIEWER"]);
    case "EDITOR": return hasRole(["EDITOR"]);
    case "ADMIN": return "u.isAdmin = 1";
    default: return null;
  }
}

/** Dashboard summary cards — one query. */
export async function statsSummary(q) {
  const r = await q.one(`SELECT
      (SELECT COUNT(*) FROM \`${T.papers}\`) AS total_papers,
      (SELECT COUNT(*) FROM \`${T.papers}\` WHERE status = 'UNDER_REVIEW') AS under_review,
      (SELECT COUNT(*) FROM \`${T.papers}\` WHERE status IN ('ACCEPTED', 'PUBLISHED')) AS accepted,
      (SELECT COUNT(*) FROM \`${T.users}\` WHERE baseType = 'AUTHOR') AS author_accounts,
      (SELECT COUNT(*) FROM (
         SELECT p.submitted_by AS uid FROM \`${T.papers}\` p WHERE p.submitted_by IS NOT NULL
         UNION
         SELECT u.id FROM \`${T.paperAuthors}\` pa JOIN \`${T.users}\` u ON u.email = pa.email
       ) x) AS users_with_papers,
      (SELECT COUNT(DISTINCT user_id) FROM \`${T.userRoles}\` WHERE role IN ('DESK_REVIEWER', 'PEER_REVIEWER')) AS reviewers,
      (SELECT COUNT(DISTINCT user_id) FROM \`${T.userRoles}\` WHERE role = 'SPOC') AS pocs`);
  const n = (k) => Number(r?.[k]) || 0;
  return {
    totalPapers: n("total_papers"), underReview: n("under_review"), accepted: n("accepted"),
    authorAccounts: n("author_accounts"), usersWithPapers: n("users_with_papers"), reviewers: n("reviewers"), pocs: n("pocs"),
  };
}

/**
 * One page of users with their paper counts — a single statement: the inner
 * query aggregates per user, the outer one sorts, counts (COUNT(*) OVER ()
 * gives the total for pagination) and pages. Sorting outside the GROUP BY
 * keeps the order exact on both MySQL 8 and MariaDB.
 * opts: output of normalizeStatsQuery.
 */
export async function userPaperStats(q, opts) {
  const links = linksSql(null);
  const where = [];
  const params = [...links.params];
  const statusJoin = opts.status ? " AND p.status = ?" : "";
  if (opts.status) params.push(opts.status);
  if (opts.search) {
    where.push("(u.name LIKE ? OR u.email LIKE ?)");
    const like = `%${escapeLike(opts.search)}%`;
    params.push(like, like);
  }
  const rw = roleWhere(opts.role);
  if (rw) where.push(rw);
  const offset = (opts.page - 1) * opts.pageSize;
  params.push(opts.pageSize, offset);

  const rows = await q.query(
    `SELECT g.*, COUNT(*) OVER () AS total_rows FROM (
       SELECT u.id, u.name, u.email, u.baseType AS base_type, u.isAdmin AS is_admin, u.status,
              COUNT(DISTINCT p.id) AS total,
              COUNT(DISTINCT CASE WHEN l.rel IN (${list(AUTHOR_RELS)}) THEN p.id END) AS submitted,
              COUNT(DISTINCT CASE WHEN l.rel = 'SUBMITTER' THEN p.id END) AS submitted_own,
              COUNT(DISTINCT CASE WHEN l.rel IN (${list(ASSIGN_RELS)}) THEN p.id END) AS assigned,
              COUNT(DISTINCT CASE WHEN p.status = 'UNDER_REVIEW' THEN p.id END) AS under_review,
              COUNT(DISTINCT CASE WHEN p.status IN ('ACCEPTED', 'PUBLISHED') THEN p.id END) AS accepted,
              COUNT(DISTINCT CASE WHEN p.status = 'REJECTED' THEN p.id END) AS rejected
         FROM \`${T.users}\` u
         LEFT JOIN (${links.sql}) l ON l.user_id = u.id
         LEFT JOIN \`${T.papers}\` p ON p.id = l.paper_id${statusJoin}
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY u.id, u.name, u.email, u.baseType, u.isAdmin, u.status
     ) g
     ${opts.includeZero ? "" : "WHERE g.total > 0"}
     ORDER BY ${SORTS[opts.sort]}
     LIMIT ? OFFSET ?`,
    params,
  );

  // Account roles for this page only — one query, not one per user.
  const ids = rows.map((r) => r.id);
  const roleRows = ids.length
    ? await q.query(`SELECT user_id, role FROM \`${T.userRoles}\` WHERE user_id IN (?)`, [ids])
    : [];
  const rolesBy = new Map(ids.map((id) => [id, []]));
  for (const r of roleRows) rolesBy.get(r.user_id)?.push(r.role);

  return {
    total: rows.length ? Number(rows[0].total_rows) : 0,
    page: opts.page,
    pageSize: opts.pageSize,
    users: rows.map((r) => ({
      id: r.id, name: r.name || r.email, email: r.email, baseType: r.base_type, isAdmin: !!r.is_admin, status: r.status,
      roles: displayRoles(r.base_type, !!r.is_admin, rolesBy.get(r.id) || []),
      total: Number(r.total), submitted: Number(r.submitted), assigned: Number(r.assigned),
      // Of `submitted`: papers where the user is only LISTED as a co-author by
      // email (not the submitter) — self-declared by the submitter, not verified.
      listedCoAuthor: Number(r.submitted) - Number(r.submitted_own),
      underReview: Number(r.under_review), accepted: Number(r.accepted), rejected: Number(r.rejected),
    })),
  };
}

const BASE_LABEL = { STUDENT: "Student", FACULTY: "Faculty", AUTHOR: "Author" };
/** Base type + account roles → display labels (POC = SPOC; reviewer roles merged). */
export function displayRoles(baseType, isAdmin, roles) {
  const out = [];
  if (BASE_LABEL[baseType]) out.push(BASE_LABEL[baseType]);
  if (isAdmin || roles.includes("ADMINISTRATOR")) out.push("Admin");
  if (roles.includes("SPOC")) out.push("POC");
  if (roles.includes("DESK_REVIEWER") || roles.includes("PEER_REVIEWER")) out.push("Reviewer");
  if (roles.includes("EDITOR")) out.push("Editor");
  return out;
}

// CO_AUTHOR = the user's email appears in the paper's author list, as typed by
// the submitter. It is not verified authorship, so it is labelled as a listing.
export const REL_LABEL = Object.freeze({
  SUBMITTER: "Author (submitter)", CO_AUTHOR: "Listed as Co-author", SPOC: "POC", DESK_REVIEWER: "Desk reviewer",
  PEER_REVIEWER: "Peer reviewer", EDITOR: "Editor",
});
const REL_ORDER = ["SUBMITTER", "CO_AUTHOR", "SPOC", "DESK_REVIEWER", "PEER_REVIEWER", "EDITOR"];

/**
 * Display labels for one paper's relationships, in a fixed order. A submitter
 * listing themselves in the author list is not a co-authorship, so CO_AUTHOR is
 * not shown next to SUBMITTER (the raw `relationships` still contain both).
 */
export function relationshipLabels(rels) {
  const set = new Set(rels);
  if (set.has("SUBMITTER")) set.delete("CO_AUTHOR");
  return REL_ORDER.filter((r) => set.has(r)).map((r) => REL_LABEL[r]);
}

/**
 * One user's papers with their relationship(s) — single aggregate query,
 * paginated. → { user, total, page, pageSize, papers } | null (no such user)
 */
export async function userPapers(q, userId, { status = "", page = 1, pageSize = 25 } = {}) {
  const user = await q.one(`SELECT id, name, email, baseType AS base_type, isAdmin AS is_admin, status FROM \`${T.users}\` WHERE id = ?`, [userId]);
  if (!user) return null;
  const links = linksSql(userId);
  const params = [...links.params];
  if (status) params.push(status);
  params.push(pageSize, (page - 1) * pageSize);
  const rows = await q.query(
    `SELECT g.*, COUNT(*) OVER () AS total_rows FROM (
       SELECT p.id, p.title, p.status, p.created_at, p.updated_at,
              GROUP_CONCAT(DISTINCT l.rel ORDER BY l.rel SEPARATOR ',') AS rels
         FROM (${links.sql}) l
         JOIN \`${T.papers}\` p ON p.id = l.paper_id${status ? " AND p.status = ?" : ""}
        GROUP BY p.id, p.title, p.status, p.created_at, p.updated_at
     ) g
     ORDER BY g.updated_at DESC, g.id
     LIMIT ? OFFSET ?`,
    params,
  );
  const roleRows = await q.query(`SELECT role FROM \`${T.userRoles}\` WHERE user_id = ?`, [userId]);
  return {
    user: {
      id: user.id, name: user.name || user.email, email: user.email, baseType: user.base_type, status: user.status,
      roles: displayRoles(user.base_type, !!user.is_admin, roleRows.map((r) => r.role)),
    },
    total: rows.length ? Number(rows[0].total_rows) : 0,
    page, pageSize,
    papers: rows.map((r) => {
      const rels = String(r.rels || "").split(",").filter(Boolean);
      return {
        id: r.id, title: r.title, status: r.status, submittedAt: r.created_at, updatedAt: r.updated_at,
        relationships: rels, relationshipLabels: relationshipLabels(rels),
        listedCoAuthorOnly: rels.includes("CO_AUTHOR") && !rels.includes("SUBMITTER"),
      };
    }),
  };
}
