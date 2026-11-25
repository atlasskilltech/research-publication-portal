/**
 * IntelligenceOS Agent API — request handler (spec atlas-agent-api/1).
 *
 * Framework-free so the exact same code runs in the Next route
 * (app/agent-api/[[...path]]/route.js) and in the test scripts.
 *
 * Order for every request:
 *   1. Authorization: Bearer <key> → sha256 → active key (else 401)
 *   2. per-key rate limit (else 429 + Retry-After)
 *   3. last_used_at is updated
 *   4. X-IntelligenceOS-User (spec v1.1 §2a, optional) → the ACTIVE portal
 *      account with that email = `viewer` (else 403 with a plain reason).
 *      Without the header the key acts on its own (viewer = null).
 *   5. GET /manifest → the actions the key's scopes allow, narrowed to what
 *      the viewer's account may use
 *   6. otherwise: match action (404) → scope (403) → viewer may use it (403) →
 *      JSON body (400) → parameter validation (400) → run (200/201, 404 for
 *      unknown records — also for records the viewer may not see)
 *   7. one row in research_agent_api_log with X-IntelligenceOS-Agent,
 *      X-IntelligenceOS-Run, X-IntelligenceOS-User and the final status
 *      (also for 401/403/429)
 * Errors are always { "error": "message" }.
 */
import { findActiveKey, touchApiKey, logApiRequest, accessLabel } from "./keys.mjs";
import { ACTIONS, matchAction, validateParams, publicAction, actionAllowed, ActionError } from "./actions.mjs";
import { USER_HEADER, resolveViewer } from "./access.mjs";

export const SPEC = "atlas-agent-api/1";
export const PROJECT = Object.freeze({ name: "ATLAS Research", version: "1.1" });
export const MAX_BODY_CHARS = 100_000;
export const DEFAULT_RATE_LIMIT = 120; // requests per key per minute

/** Fixed-window per-key limiter (in-process). → { ok, retryAfter } */
export function createKeyRateLimiter({ limit = DEFAULT_RATE_LIMIT, windowMs = 60_000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  return function hit(keyId) {
    const t = now();
    let b = buckets.get(keyId);
    if (!b || t - b.start >= windowMs) {
      b = { start: t, count: 0 };
      buckets.set(keyId, b);
      if (buckets.size > 10_000) for (const [k, v] of buckets) if (t - v.start >= windowMs) buckets.delete(k);
    }
    b.count += 1;
    if (b.count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((b.start + windowMs - t) / 1000)) };
    return { ok: true, remaining: limit - b.count };
  };
}

export function rateLimitFromEnv(env = process.env) {
  const n = Number(env.AGENT_API_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_RATE_LIMIT;
}

export function buildManifest(key, viewer = null) {
  const scopes = new Set(key.scopes);
  return {
    spec: SPEC,
    project: { ...PROJECT },
    key: { name: key.name, access: accessLabel(key.scopes), expiresAt: key.expiresAt || null },
    ...(viewer ? { user: { name: viewer.name, email: viewer.email } } : {}),
    actions: ACTIONS.filter((a) => scopes.has(a.scope) && actionAllowed(a, viewer)).map(publicAction),
  };
}

const bearer = (h) => {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(String(h || ""));
  return m ? m[1] : null;
};

/**
 * createAgentApi({ db, limiter?, log? }) → handle(req)
 *   req = { method, path ("/manifest", relative to /agent-api), query: URLSearchParams,
 *           headers: { get(name) }, body: string, ip }
 *   → { status, body, headers }
 */
export function createAgentApi({ db, limiter = createKeyRateLimiter({ limit: rateLimitFromEnv() }), chairEmails = () => [], onError = () => {} }) {
  return async function handle(req) {
    const method = String(req.method || "GET").toUpperCase();
    const path = ("/" + String(req.path || "").replace(/^\/+|\/+$/g, "")).replace(/\/{2,}/g, "/");
    const agent = req.headers.get("x-intelligenceos-agent");
    const runId = req.headers.get("x-intelligenceos-run");
    const actingEmail = req.headers.get(USER_HEADER);
    let key = null;
    let actionId = null;

    const respond = async (status, body, headers = {}) => {
      try {
        await logApiRequest(db, { keyId: key?.id || null, method, path, action: actionId, agent, runId, actingEmail, status, ip: req.ip || null });
      } catch (e) {
        onError("log", e);
      }
      return { status, body, headers };
    };

    // 1. Authentication
    const token = bearer(req.headers.get("authorization"));
    if (!token) return respond(401, { error: "Missing API key. Send Authorization: Bearer <key>." });
    try {
      key = await findActiveKey(db, token);
    } catch (e) {
      onError("auth", e);
      return respond(500, { error: "Internal error" });
    }
    if (!key) return respond(401, { error: "Invalid, expired or revoked key" });

    // 2. Rate limit (per key)
    const rl = limiter(key.id);
    if (!rl.ok) return respond(429, { error: "Too many requests. Slow down and retry later." }, { "Retry-After": String(rl.retryAfter) });

    // 3. Last used
    try { await touchApiKey(db, key.id); } catch (e) { onError("touch", e); }

    // 4. Acting user (optional)
    let viewer = null;
    if (actingEmail !== null && actingEmail !== undefined) {
      try {
        const list = typeof chairEmails === "function" ? chairEmails() : chairEmails;
        viewer = await resolveViewer(db, actingEmail, { chairEmails: list || [] });
      } catch (e) {
        if (path === "/manifest") actionId = "manifest";
        if (e instanceof ActionError) return respond(e.status, { error: e.message });
        onError("user", e);
        return respond(500, { error: "Internal error" });
      }
    }

    // 5. Manifest
    if (path === "/manifest") {
      actionId = "manifest";
      if (method !== "GET") return respond(404, { error: "Unknown action" });
      return respond(200, buildManifest(key, viewer));
    }

    // 6. Actions
    const match = matchAction(method, path);
    if (!match?.action) return respond(404, { error: "Unknown action" });
    const action = match.action;
    actionId = action.id;
    if (!key.scopes.includes(action.scope)) return respond(403, { error: `This key does not allow ${action.id}` });
    if (!actionAllowed(action, viewer)) return respond(403, { error: `Your ATLAS Research account can't use ${action.name.toLowerCase()} (${action.id}).` });

    let body = {};
    if (method === "POST") {
      const text = typeof req.body === "string" ? req.body : "";
      if (text.length > MAX_BODY_CHARS) return respond(400, { error: "Body too large" });
      if (text.trim()) {
        try { body = JSON.parse(text); } catch { return respond(400, { error: "Body must be JSON" }); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return respond(400, { error: "Body must be a JSON object" });
      }
    }
    const v = validateParams(action, { pathParams: match.pathParams, query: req.query || new URLSearchParams(), body });
    if (!v.ok) return respond(400, { error: v.error });

    try {
      const result = await action.run({ db, path: v.path, query: v.query, body: v.body, key, agent, runId, viewer });
      return respond(result.status || 200, result.body);
    } catch (e) {
      if (e instanceof ActionError) return respond(e.status, { error: e.message });
      onError(action.id, e);
      return respond(500, { error: "Internal error" });
    }
  };
}
