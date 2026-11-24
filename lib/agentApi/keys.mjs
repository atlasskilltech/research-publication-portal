/**
 * IntelligenceOS Agent API — key scopes, key material and the key repository.
 *
 * Keys follow docs/AGENT_API_SPEC.md (atlas-agent-api/1):
 *   - format "atl_" + 24 random bytes base64url (36 chars), shown ONCE;
 *   - only sha256(key) (hex) is stored, plus the last 4 chars for display;
 *   - each key has a name, scopes, optional expiry, revoke, "last used".
 * Keys never carry delete, password, payment or bulk-export rights — the only
 * scopes that exist are listed in SCOPES.
 *
 * No framework imports: used by the Next routes and the Node test scripts.
 */
import crypto from "node:crypto";
import { T } from "../db/tables.mjs";
import { uuid, sha256Hex } from "../auth/crypto.mjs";

export const SCOPES = Object.freeze([
  { id: "research.read", label: "Read submissions", description: "List and view submissions, reviewers, status history and statistics." },
  { id: "research.write", label: "Add notes and change status", description: "Add review notes and move a submission to an allowed status." },
]);
export const SCOPE_IDS = Object.freeze(SCOPES.map((s) => s.id));

export const PRESETS = Object.freeze({
  read_only: { label: "Read only", scopes: ["research.read"] },
  read_write: { label: "Read + write", scopes: ["research.read", "research.write"] },
});

export const KEY_NAME_MAX = 100;
export const KEY_PREFIX = "atl_";
const KEY_PATTERN = /^atl_[A-Za-z0-9_-]{32}$/;

/** New plain key: "atl_" + 24 random bytes base64url. */
export const generateKey = () => KEY_PREFIX + crypto.randomBytes(24).toString("base64url");
export const hashKey = (key) => sha256Hex(key);
export const looksLikeKey = (key) => typeof key === "string" && KEY_PATTERN.test(key);

/** "Read only" | "Read and write" | "Custom" — the manifest's key.access label. */
export function accessLabel(scopes) {
  const set = new Set(scopes || []);
  if (set.size && [...set].every((s) => s.endsWith(".read"))) return "Read only";
  if (set.size === SCOPE_IDS.length && SCOPE_IDS.every((s) => set.has(s))) return "Read and write";
  return "Custom";
}

/**
 * Validate the admin "create key" form. → { ok, value:{name, scopes, expiresAt:Date|null} } | { ok:false, error }
 */
export function validateNewKey(body, now = new Date()) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "Give the key a name." };
  if (name.length > KEY_NAME_MAX) return { ok: false, error: `Name must be at most ${KEY_NAME_MAX} characters.` };
  const raw = Array.isArray(body?.scopes) ? body.scopes : PRESETS.read_only.scopes;
  const scopes = [...new Set(raw.map(String))];
  if (!scopes.length) return { ok: false, error: "Choose at least one permission." };
  const unknown = scopes.filter((s) => !SCOPE_IDS.includes(s));
  if (unknown.length) return { ok: false, error: `Unknown permission: ${unknown.join(", ")}.` };
  let expiresAt = null;
  if (body?.expiresAt) {
    const s = String(body.expiresAt);
    // A bare date means "valid through the end of that day (UTC)".
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999Z` : s);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "Expiry date is not valid." };
    if (d.getTime() <= now.getTime()) return { ok: false, error: "Expiry date must be in the future." };
    expiresAt = d;
  }
  return { ok: true, value: { name, scopes: SCOPE_IDS.filter((s) => scopes.includes(s)), expiresAt } };
}

const parseScopes = (v) => {
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
};

/** Key row → admin-facing object (never the hash). */
export function keyView(r, now = new Date()) {
  const scopes = parseScopes(r.scopes);
  const expired = !!r.expires_at && new Date(r.expires_at).getTime() <= now.getTime();
  return {
    id: r.id,
    name: r.name,
    last4: r.key_last4,
    scopes,
    access: accessLabel(scopes),
    expiresAt: r.expires_at || null,
    createdAt: r.created_at,
    createdBy: r.created_by_name || null,
    lastUsedAt: r.last_used_at || null,
    revokedAt: r.revoked_at || null,
    state: r.revoked_at ? "revoked" : expired ? "expired" : "active",
  };
}

/** Create a key. Returns { key (plain, show once), record }. */
export async function createApiKey(q, { name, scopes, expiresAt = null, createdBy = null }) {
  const key = generateKey();
  const id = uuid();
  await q.exec(
    `INSERT INTO \`${T.agentApiKeys}\` (id, name, key_hash, key_last4, scopes, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [id, name, hashKey(key), key.slice(-4), JSON.stringify(scopes), expiresAt, createdBy],
  );
  const row = await q.one(`SELECT * FROM \`${T.agentApiKeys}\` WHERE id = ?`, [id]);
  return { key, record: keyView(row) };
}

export async function listApiKeys(q) {
  const rows = await q.query(
    `SELECT k.id, k.name, k.key_last4, k.scopes, k.expires_at, k.revoked_at, k.last_used_at, k.created_at, u.name AS created_by_name
       FROM \`${T.agentApiKeys}\` k LEFT JOIN \`${T.users}\` u ON u.id = k.created_by
      ORDER BY k.revoked_at IS NULL DESC, k.created_at DESC`,
  );
  return rows.map((r) => keyView(r));
}

/** Revoke (idempotent). → true when the key exists. */
export async function revokeApiKey(q, { id, actorId }) {
  const row = await q.one(`SELECT id FROM \`${T.agentApiKeys}\` WHERE id = ?`, [id]);
  if (!row) return false;
  await q.exec(
    `UPDATE \`${T.agentApiKeys}\` SET revoked_at = UTC_TIMESTAMP(3), revoked_by = ? WHERE id = ? AND revoked_at IS NULL`,
    [actorId || null, id],
  );
  return true;
}

/**
 * Resolve a bearer token to an ACTIVE key: { id, name, scopes, expiresAt } or null.
 * The token is hashed and looked up by its unique hash index; the hash is then
 * compared in constant time (defence in depth). Revoked / expired → null.
 */
export async function findActiveKey(q, token, now = new Date()) {
  if (!looksLikeKey(token)) return null;
  const hash = hashKey(token);
  const row = await q.one(
    `SELECT id, name, key_hash, scopes, expires_at, revoked_at FROM \`${T.agentApiKeys}\` WHERE key_hash = ?`,
    [hash],
  );
  if (!row) return null;
  const a = Buffer.from(row.key_hash, "utf8");
  const b = Buffer.from(hash, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return null;
  return { id: row.id, name: row.name, scopes: parseScopes(row.scopes), expiresAt: row.expires_at || null };
}

export async function touchApiKey(q, id) {
  await q.exec(`UPDATE \`${T.agentApiKeys}\` SET last_used_at = UTC_TIMESTAMP(3) WHERE id = ?`, [id]);
}

const cut = (v, n) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, n));

export async function logApiRequest(q, { keyId = null, method, path, action = null, agent = null, runId = null, status, ip = null }) {
  await q.exec(
    `INSERT INTO \`${T.agentApiLog}\` (at, key_id, method, path, action, agent, run_id, status, ip)
     VALUES (UTC_TIMESTAMP(3), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [keyId, cut(method, 8) || "GET", cut(path, 255) || "/", cut(action, 64), cut(agent, 128), cut(runId, 128), status, cut(ip, 64)],
  );
}
