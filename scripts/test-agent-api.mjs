/**
 * IntelligenceOS Agent API — MySQL/MariaDB integration suite
 * (lib/agentApi/*, migration 010). Exercises the SAME handler the
 * /agent-api route uses, against a real database.
 *
 * Safety: creates its OWN throwaway database `rpp_it_agent_<random>`, runs the
 * real migrations, seeds data and drops ONLY that database at the end.
 * Refuses non-local servers unless RPP_IT_ALLOW_REMOTE=yes.
 *
 *   npm run test:agent-api   (DB_HOST/DB_PORT/DB_USER/DB_PASSWORD of a LOCAL server)
 */
import mysql from "mysql2/promise";
import { createDb, createPool } from "../lib/db/core.mjs";
import { T } from "../lib/db/tables.mjs";
import { migrate } from "./db-migrate.mjs";
import { uuid } from "../lib/auth/crypto.mjs";
import { createRegisteredUser } from "../lib/repos/users.mjs";
import { createApiKey, listApiKeys, revokeApiKey, validateNewKey, accessLabel, hashKey } from "../lib/agentApi/keys.mjs";
import { createAgentApi, createKeyRateLimiter, SPEC } from "../lib/agentApi/handler.mjs";

let failures = 0, total = 0;
const READ_IDS = ["list_submissions", "get_submission", "submission_stats", "whoami", "list_review_assignments", "list_revisions", "list_decisions",
  "list_approvals", "list_publications", "list_volumes", "list_achievements", "achievement_stats", "list_activity", "list_users", "registration_stats"];
const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);

const env = process.env;
const conn = {
  host: env.IT_DB_HOST || env.DB_HOST || "localhost",
  port: Number(env.IT_DB_PORT || env.DB_PORT || 3306),
  user: env.IT_DB_USER || env.DB_USER || "root",
  password: env.IT_DB_PASSWORD ?? env.DB_PASSWORD ?? "",
};
if (!/^(localhost|127\.0\.0\.1|::1)$/.test(conn.host) && env.RPP_IT_ALLOW_REMOTE !== "yes") {
  console.error(`Refusing to create a test database on non-local host ${conn.host}.`);
  process.exit(2);
}
const DB_NAME = `rpp_it_agent_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const server = await mysql.createConnection({ ...conn });
await server.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const db = createDb(createPool({ ...conn, database: DB_NAME, connectionLimit: 4 }));
console.log(`Agent API suite — ${(await db.one("SELECT VERSION() AS v")).v} — throwaway database ${DB_NAME}`);

/** A request to the handler, shaped like the Next route builds it. */
function call(api, method, path, { key, query = {}, body, headers = {} } = {}) {
  const h = new Headers({ "X-IntelligenceOS-Agent": "Test agent", "X-IntelligenceOS-Run": "run-123", ...headers });
  if (key) h.set("Authorization", `Bearer ${key}`);
  return api({ method, path, query: new URLSearchParams(query), headers: h, body: body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body), ip: "127.0.0.1" });
}

try {
  await migrate(db, { log: () => {} });
  section("Migration 010:");
  check("research_agent_api_keys + research_agent_api_log exist", !!(await db.one("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [T.agentApiKeys])) && !!(await db.one("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [T.agentApiLog])));

  // ---- Seed --------------------------------------------------------------------
  const adminId = await createRegisteredUser(db, { name: "IT Admin", email: `it.admin.${uuid().slice(0, 6)}@atlasuniversity.edu.in`, baseType: "FACULTY" });
  const revId = await createRegisteredUser(db, { name: "Dr Reviewer", email: `it.rev.${uuid().slice(0, 6)}@atlasuniversity.edu.in`, baseType: "FACULTY" });
  const stuId = await createRegisteredUser(db, { name: "Student Author", email: `it.stu.${uuid().slice(0, 6)}@atlasuniversity.edu.in`, baseType: "STUDENT" });
  const papers = [
    { id: uuid(), ref: "ISDI-2026-0001", title: "Design paper", school: "ISDI", status: "SUBMITTED", at: "2026-01-10 10:00:00" },
    { id: uuid(), ref: "ISDI-2026-0002", title: "Design paper two", school: "ISDI", status: "UNDER_REVIEW", at: "2026-02-15 10:00:00" },
    { id: uuid(), ref: "LAW-2026-0001", title: "Law paper", school: "LAW", status: "ACCEPTED", at: "2026-03-20 10:00:00" },
    { id: uuid(), ref: "GEN-2026-0001", title: "No school paper", school: null, status: "SUBMITTED", at: "2026-04-01 10:00:00" },
  ];
  for (const p of papers) {
    await db.exec(
      `INSERT INTO \`${T.papers}\` (id, ref_id, title, abstract, keywords, school_code, status, submitted_by, current_round, created_at)
       VALUES (?, ?, ?, 'Abstract', '["ai","design"]', ?, ?, ?, 0, ?)`,
      [p.id, p.ref, p.title, p.school, p.status, stuId, p.at],
    );
    await db.exec(`INSERT INTO \`${T.paperAuthors}\` (id, paper_id, full_name, email, is_corresponding, author_order) VALUES (?, ?, 'Secret Author', 'secret.author@example.org', 1, 0)`, [uuid(), p.id]);
    await db.exec(`INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail, created_at) VALUES (?, ?, ?, 'SUBMITTED', '{"authors":1}', ?)`, [uuid(), p.id, stuId, p.at]);
  }
  const P2 = papers[1];
  await db.exec(`INSERT INTO \`${T.paperAssignments}\` (id, paper_id, assignee, role, assigned_by) VALUES (?, ?, ?, 'PEER_REVIEWER', ?)`, [uuid(), P2.id, revId, adminId]);
  await db.exec(`INSERT INTO \`${T.paperActivity}\` (id, paper_id, actor, action, detail) VALUES (?, ?, ?, 'ASSIGNED', ?)`, [uuid(), P2.id, adminId, JSON.stringify({ assignee: revId, role: "PEER_REVIEWER" })]);
  await db.exec(`INSERT INTO \`${T.reviews}\` (id, paper_id, reviewer, round, status, confidential_to_editor) VALUES (?, ?, ?, 0, 'DRAFT', 'TOP SECRET')`, [uuid(), P2.id, revId]);

  // ---- Keys ----------------------------------------------------------------------
  section("Keys:");
  const ro = await createApiKey(db, { name: "Read key", scopes: ["research.read"], createdBy: adminId });
  const rw = await createApiKey(db, { name: "RW key", scopes: ["research.read", "research.write"], createdBy: adminId });
  const wo = await createApiKey(db, { name: "Write-only key", scopes: ["research.write"], createdBy: adminId });
  const revoked = await createApiKey(db, { name: "Revoked key", scopes: ["research.read"], createdBy: adminId });
  await revokeApiKey(db, { id: revoked.record.id, actorId: adminId });
  const expired = await createApiKey(db, { name: "Expired key", scopes: ["research.read"], createdBy: adminId, expiresAt: new Date(Date.now() + 60_000) });
  await db.exec(`UPDATE \`${T.agentApiKeys}\` SET expires_at = ? WHERE id = ?`, [new Date(Date.now() - 1000), expired.record.id]);

  check('format "atl_" + 24 random bytes base64url', /^atl_[A-Za-z0-9_-]{32}$/.test(ro.key) && ro.key !== rw.key);
  const stored = await db.one(`SELECT * FROM \`${T.agentApiKeys}\` WHERE id = ?`, [ro.record.id]);
  check("only sha256(key) is stored (no plain key anywhere in the row)", stored.key_hash === hashKey(ro.key) && !JSON.stringify(stored).includes(ro.key));
  const listed = await listApiKeys(db);
  check("list shows state, last4, access — never hash or key", listed.length === 5 && listed.every((k) => !("key_hash" in k) && !("key" in k)) && listed.find((k) => k.id === revoked.record.id).state === "revoked" && listed.find((k) => k.id === expired.record.id).state === "expired");
  check("access labels: Read only / Read and write / Custom", accessLabel(["research.read"]) === "Read only" && accessLabel(["research.read", "research.write"]) === "Read and write" && accessLabel(["research.write"]) === "Custom");
  check("validateNewKey: default = read only; unknown scope / past expiry / no name refused",
    validateNewKey({ name: "x" }).value.scopes.join() === "research.read"
      && !validateNewKey({ name: "x", scopes: ["research.delete"] }).ok
      && !validateNewKey({ name: "x", expiresAt: "2000-01-01" }).ok
      && !validateNewKey({ name: " " }).ok);

  const api = createAgentApi({ db, limiter: createKeyRateLimiter({ limit: 1000 }) });

  // ---- 401 ----------------------------------------------------------------------
  section("401 — authentication:");
  let r = await call(api, "GET", "/manifest");
  check("no Authorization header → 401 {error}", r.status === 401 && typeof r.body.error === "string");
  r = await call(api, "GET", "/manifest", { key: "atl_" + "x".repeat(32) });
  check("wrong key → 401", r.status === 401 && typeof r.body.error === "string");
  r = await call(api, "GET", "/manifest", { headers: { Authorization: "Basic abc" } });
  check("non-Bearer scheme → 401", r.status === 401);
  r = await call(api, "GET", "/manifest", { key: revoked.key });
  check("revoked key → 401", r.status === 401);
  r = await call(api, "GET", "/manifest", { key: expired.key });
  check("expired key → 401", r.status === 401);
  r = await call(api, "GET", "/submissions", { key: "nope" });
  check("bad key on an action → 401 (auth before routing)", r.status === 401);

  // ---- Manifest -------------------------------------------------------------------
  section("Manifest:");
  r = await call(api, "GET", "/manifest", { key: ro.key });
  check("read-only key → 200, spec + project", r.status === 200 && r.body.spec === SPEC && r.body.project.name === "ATLAS Research" && r.body.project.version === "1.1");
  check('key block: name, access "Read only", expiresAt null', r.body.key.name === "Read key" && r.body.key.access === "Read only" && r.body.key.expiresAt === null);
  const roIds = r.body.actions.map((a) => a.id);
  check("read-only key lists ONLY the read actions (all 15)", roIds.length === READ_IDS.length && READ_IDS.every((id) => roIds.includes(id)) && r.body.actions.every((a) => a.risk === "read" && a.method === "GET"), roIds.join());
  const allowedTop = ["id", "name", "description", "method", "path", "risk", "params"];
  const allowedParam = ["name", "in", "type", "required", "enum", "description"];
  check("action + param shapes follow the spec exactly (no internal fields)",
    r.body.actions.every((a) => Object.keys(a).every((k) => allowedTop.includes(k)) && /^[a-z0-9_]+$/.test(a.id) && ["GET", "POST"].includes(a.method) && ["read", "write"].includes(a.risk)
      && a.params.every((p) => Object.keys(p).every((k) => allowedParam.includes(k)) && ["path", "query", "body"].includes(p.in) && ["string", "number", "integer", "boolean"].includes(p.type))));
  r = await call(api, "GET", "/manifest", { key: rw.key });
  check('read+write key: access "Read and write", all 17 actions', r.body.key.access === "Read and write" && r.body.actions.length === READ_IDS.length + 2);
  check("write actions are POST / risk write; body params only on POST", r.body.actions.filter((a) => a.risk === "write").every((a) => a.method === "POST") && r.body.actions.filter((a) => a.method === "GET").every((a) => a.params.every((p) => p.in !== "body")));
  check("no delete actions exposed", !r.body.actions.some((a) => /delete|remove|password|export/i.test(a.id)));
  r = await call(api, "GET", "/manifest", { key: wo.key });
  check('write-only key: "Custom", lists only the 2 write actions', r.body.key.access === "Custom" && r.body.actions.map((a) => a.id).join() === "add_review_note,update_submission_status");
  const exp = await createApiKey(db, { name: "Expiring", scopes: ["research.read"], expiresAt: new Date("2099-01-01T00:00:00Z") });
  r = await call(api, "GET", "/manifest", { key: exp.key });
  check("expiresAt reported as ISO", r.body.key.expiresAt === "2099-01-01T00:00:00.000Z");

  // ---- 403 ------------------------------------------------------------------------
  section("403 — permissions:");
  r = await call(api, "POST", `/submissions/${papers[0].id}/notes`, { key: ro.key, body: { note: "hi" } });
  check("read-only key calling add_review_note → 403", r.status === 403 && /add_review_note/.test(r.body.error));
  r = await call(api, "POST", `/submissions/${papers[0].id}/status`, { key: ro.key, body: { status: "UNDER_REVIEW" } });
  check("read-only key calling update_submission_status → 403", r.status === 403);
  check("…and nothing changed", (await db.one(`SELECT status FROM \`${T.papers}\` WHERE id = ?`, [papers[0].id])).status === "SUBMITTED");
  r = await call(api, "GET", "/submissions", { key: wo.key });
  check("write-only key calling a read action → 403", r.status === 403);

  // ---- Read actions ----------------------------------------------------------------
  section("list_submissions:");
  r = await call(api, "GET", "/submissions", { key: ro.key });
  check("all → 200, total 4, newest first", r.status === 200 && r.body.total === 4 && r.body.submissions[0].refId === "GEN-2026-0001");
  check("only needed fields; no author names/emails", !JSON.stringify(r.body).includes("Secret Author") && !JSON.stringify(r.body).includes("secret.author") && !("submitted_by" in r.body.submissions[0]));
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { status: "SUBMITTED" } });
  check("status filter", r.body.total === 2 && r.body.submissions.every((s) => s.status === "SUBMITTED"));
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { department: "ISDI" } });
  check("department filter", r.body.total === 2 && r.body.submissions.every((s) => s.department === "ISDI" && s.departmentName));
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { from: "2026-02-01", to: "2026-03-20" } });
  check("date range (to inclusive)", r.body.total === 2 && r.body.submissions.map((s) => s.refId).sort().join() === "ISDI-2026-0002,LAW-2026-0001");
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { limit: "1" } });
  check("limit → returned 1, total still 4", r.body.returned === 1 && r.body.total === 4);
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { limit: "201" } });
  check("limit > 200 → 400", r.status === 400);
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { status: "DELETED" } });
  check("status outside enum → 400", r.status === 400);
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { from: "yesterday" } });
  check("bad date → 400", r.status === 400);
  r = await call(api, "GET", "/submissions", { key: ro.key, query: { status: "x' OR '1'='1" } });
  check("SQL-ish input rejected by validation → 400", r.status === 400);

  section("get_submission:");
  r = await call(api, "GET", `/submissions/${P2.id}`, { key: ro.key });
  const s = r.body.submission;
  check("by id → 200 with title, abstract, keywords, status", r.status === 200 && s.title === P2.title && s.abstract === "Abstract" && s.keywords.join() === "ai,design" && s.status === "UNDER_REVIEW");
  check("includes the reviewer (name, role, review progress)", s.reviewers.length === 1 && s.reviewers[0].name === "Dr Reviewer" && s.reviewers[0].role === "PEER_REVIEWER" && s.reviewers[0].review.status === "DRAFT");
  check("includes status history", s.statusHistory.length === 2 && s.statusHistory[0].event === "SUBMITTED" && s.statusHistory[0].status === "SUBMITTED" && s.statusHistory[1].detail?.role === "PEER_REVIEWER");
  const blob = JSON.stringify(r.body);
  check("never exposes authors, emails, user ids or confidential comments", !blob.includes("Secret Author") && !blob.includes("@") && !blob.includes(revId) && !blob.includes(stuId) && !blob.includes("TOP SECRET"));
  r = await call(api, "GET", "/submissions/isdi-2026-0002", { key: ro.key });
  check("by reference ID (case-insensitive) → same submission", r.status === 200 && r.body.submission.id === P2.id);
  r = await call(api, "GET", `/submissions/${uuid()}`, { key: ro.key });
  check("unknown id → 404 {error}", r.status === 404 && r.body.error === "Submission not found");
  r = await call(api, "GET", "/submissions/../../etc", { key: ro.key });
  check("garbage path → 404", r.status === 404);

  section("submission_stats:");
  r = await call(api, "GET", "/stats/submissions", { key: ro.key });
  check("counts by status", r.status === 200 && r.body.total === 4 && r.body.byStatus.SUBMITTED === 2 && r.body.byStatus.UNDER_REVIEW === 1 && r.body.byStatus.ACCEPTED === 1 && r.body.byStatus.REJECTED === 0);
  check("counts by department (null → UNSPECIFIED)", r.body.byDepartment.ISDI === 2 && r.body.byDepartment.LAW === 1 && r.body.byDepartment.UNSPECIFIED === 1);
  r = await call(api, "GET", "/stats/submissions", { key: ro.key, query: { from: "2026-03-01" } });
  check("date range", r.body.total === 2);
  r = await call(api, "GET", "/stats/submissions", { key: ro.key, query: { from: "2026-05-01", to: "2026-01-01" } });
  check("from after to → 400", r.status === 400);

  // ---- Write actions ---------------------------------------------------------------
  section("add_review_note:");
  r = await call(api, "POST", `/submissions/${papers[0].id}/notes`, { key: rw.key, body: { note: "  Looks promising.  " } });
  check("→ 201 saved", r.status === 201 && r.body.saved === true && r.body.note.note === "Looks promising.");
  const act = await db.one(`SELECT actor, detail FROM \`${T.paperActivity}\` WHERE paper_id = ? AND action = 'AGENT_NOTE_ADDED'`, [papers[0].id]);
  const d = typeof act.detail === "string" ? JSON.parse(act.detail) : act.detail;
  check("stored in the paper's audit trail with agent + run id", act.actor === null && d.note === "Looks promising." && d.agent === "Test agent" && d.runId === "run-123" && d.key === "RW key");
  r = await call(api, "GET", `/submissions/${papers[0].id}`, { key: ro.key });
  check("note visible via get_submission", r.body.submission.notes.length === 1 && r.body.submission.notes[0].note === "Looks promising.");
  r = await call(api, "POST", `/submissions/${papers[0].id}/notes`, { key: rw.key, body: {} });
  check("missing note → 400", r.status === 400);
  r = await call(api, "POST", `/submissions/${papers[0].id}/notes`, { key: rw.key, body: { note: "x".repeat(2001) } });
  check("note > 2000 chars → 400", r.status === 400);
  r = await call(api, "POST", `/submissions/${papers[0].id}/notes`, { key: rw.key, body: { note: 42 } });
  check("wrong type → 400", r.status === 400);
  r = await call(api, "POST", `/submissions/${papers[0].id}/notes`, { key: rw.key, body: "{not json" });
  check("invalid JSON → 400 Body must be JSON", r.status === 400 && r.body.error === "Body must be JSON");
  r = await call(api, "POST", `/submissions/${uuid()}/notes`, { key: rw.key, body: { note: "x" } });
  check("unknown submission → 404", r.status === 404);

  section("update_submission_status:");
  r = await call(api, "POST", `/submissions/${papers[0].id}/status`, { key: rw.key, body: { status: "UNDER_REVIEW", reason: "Triaged" } });
  check("SUBMITTED → UNDER_REVIEW → 200", r.status === 200 && r.body.updated === true && r.body.submission.previousStatus === "SUBMITTED" && r.body.submission.status === "UNDER_REVIEW");
  check("…persisted", (await db.one(`SELECT status FROM \`${T.papers}\` WHERE id = ?`, [papers[0].id])).status === "UNDER_REVIEW");
  r = await call(api, "GET", `/submissions/${papers[0].id}`, { key: ro.key });
  check("…and shows in status history", r.body.submission.statusHistory.some((h) => h.event === "AGENT_STATUS_CHANGED" && h.status === "UNDER_REVIEW" && h.detail.from === "SUBMITTED"));
  r = await call(api, "POST", `/submissions/${papers[0].id}/status`, { key: rw.key, body: { status: "ACCEPTED" } });
  check("status outside allowed values (ACCEPTED) → 400", r.status === 400);
  r = await call(api, "POST", `/submissions/${papers[2].id}/status`, { key: rw.key, body: { status: "ARCHIVED" } });
  check("disallowed transition (ACCEPTED → ARCHIVED) → 400, unchanged", r.status === 400 && (await db.one(`SELECT status FROM \`${T.papers}\` WHERE id = ?`, [papers[2].id])).status === "ACCEPTED");
  r = await call(api, "POST", `/submissions/${papers[0].id}/status`, { key: rw.key, body: { status: "under_review" } });
  check("same status → 400", r.status === 400);
  r = await call(api, "POST", "/submissions/LAW-2026-9999/status", { key: rw.key, body: { status: "ARCHIVED" } });
  check("unknown submission → 404", r.status === 404);

  // ---- Routing ---------------------------------------------------------------------
  section("Routing:");
  r = await call(api, "GET", "/nope", { key: ro.key });
  check("unknown action → 404", r.status === 404 && r.body.error === "Unknown action");
  r = await call(api, "POST", "/submissions", { key: rw.key, body: {} });
  check("wrong method on a known path → 404", r.status === 404);
  r = await call(api, "GET", "/manifest/", { key: ro.key });
  check("trailing slash tolerated", r.status === 200);

  // ---- Logging + last used -----------------------------------------------------------
  section("Request log + last used:");
  const logs = await db.query(`SELECT key_id, action, agent, run_id, status, method FROM \`${T.agentApiLog}\` ORDER BY id`);
  check("every request logged (incl. 401)", logs.length > 40 && logs.some((l) => l.status === 401 && l.key_id === null));
  check("agent + run headers logged", logs.every((l) => l.agent === "Test agent" && l.run_id === "run-123"));
  check("403 logged with key + action", logs.some((l) => l.status === 403 && l.key_id === ro.record.id && l.action === "add_review_note"));
  check("200/201 logged with action", logs.some((l) => l.status === 201 && l.action === "add_review_note") && logs.some((l) => l.status === 200 && l.action === "manifest"));
  const after = (await listApiKeys(db)).find((k) => k.id === ro.record.id);
  check("last_used_at set on use", !!after.lastUsedAt);
  check("never-used key has no last_used_at", (await listApiKeys(db)).find((k) => k.id === revoked.record.id).lastUsedAt === null);

  // ---- Rate limit ----------------------------------------------------------------------
  section("Rate limit (per key):");
  const limited = createAgentApi({ db, limiter: createKeyRateLimiter({ limit: 3, windowMs: 60_000 }) });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await call(limited, "GET", "/manifest", { key: ro.key })).status);
  check("4th request within the window → 429", codes.join() === "200,200,200,429,429", codes.join());
  const r429 = await call(limited, "GET", "/manifest", { key: ro.key });
  check("429 carries Retry-After and {error}", Number(r429.headers["Retry-After"]) > 0 && typeof r429.body.error === "string");
  check("another key is unaffected", (await call(limited, "GET", "/manifest", { key: rw.key })).status === 200);
  let t = 0;
  const clock = createKeyRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
  check("window resets", clock("k").ok && !clock("k").ok && ((t = 1000), clock("k").ok));
} catch (e) {
  failures++;
  console.error("✗ Suite error:", e);
} finally {
  await db.end();
  await server.query(`DROP DATABASE \`${DB_NAME}\``);
  await server.end();
}

console.log(`\n${total - failures}/${total} checks passed${failures ? ` — ${failures} FAILED` : ""}.`);
process.exit(failures ? 1 : 0);
