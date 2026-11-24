/**
 * IntelligenceOS Agent API — HTTP checks against a RUNNING app (MySQL).
 *   - admin page + /api/admin/agent-keys are admin-only (401/403/redirect)
 *   - an admin creates keys through the API: key shown once, list never shows it
 *   - /agent-api: 401 without / with a bad key, 403 read-only → write,
 *     manifest lists only allowed actions, every action works over HTTP,
 *     revoke → 401
 * Self-cleaning (throwaway users, papers, keys and their log rows).
 *
 *   node scripts/test-agent-api-http.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import { makeHarness } from "./lib/test-db.mjs";
import { uuid } from "../lib/auth/crypto.mjs";

const h = makeHarness(process.argv[2]);
const { check, db, T } = h;
const keyIds = [];

async function agent(path, { key, method = "GET", body } = {}) {
  const headers = { "X-IntelligenceOS-Agent": "HTTP test agent", "X-IntelligenceOS-Run": `run-${h.tag()}` };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${h.BASE}/agent-api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  return { status: res.status, data, res };
}

async function main() {
  console.log(`\n=== IntelligenceOS Agent API HTTP (app ${h.BASE}) ===\n`);
  const admin = await h.mkAdmin();
  const faculty = await h.mkUser({ kind: "fac" });
  const pid = uuid();
  h.manifest.papers.push(pid);
  const ref = `GEN-2099-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  await db.exec(`INSERT INTO \`${T.papers}\` (id, ref_id, title, abstract, keywords, school_code, status, submitted_by, current_round) VALUES (?, ?, 'IT agent paper', 'abs', '[]', 'ISDI', 'SUBMITTED', ?, 0)`, [pid, ref, faculty.id]);

  console.log("Key admin is admin-only:");
  check("anonymous GET /api/admin/agent-keys → 401", (await h.browser().api("/api/admin/agent-keys")).status === 401);
  const fb = h.browser();
  await fb.login(faculty.email, faculty.password);
  check("faculty GET /api/admin/agent-keys → 403", (await fb.api("/api/admin/agent-keys")).status === 403);
  check("faculty POST /api/admin/agent-keys → 403", (await fb.api("/api/admin/agent-keys", { method: "POST", json: { name: "x" } })).status === 403);
  const anonPage = await h.browser().req("/intelligence-keys");
  check("anonymous /intelligence-keys → /login", [302, 303, 307, 308].includes(anonPage.status) && /\/login/.test(anonPage.headers.get("location") || ""));

  console.log("\nAdmin creates keys:");
  const ab = h.browser();
  await ab.login(admin.email, admin.password);
  const page = await ab.req("/intelligence-keys");
  check("admin /intelligence-keys → 200", page.status === 200, `${page.status}`);
  const c1 = await ab.api("/api/admin/agent-keys", { method: "POST", json: { name: "IT read" } });
  const c2 = await ab.api("/api/admin/agent-keys", { method: "POST", json: { name: "IT rw", scopes: ["research.read", "research.write"] } });
  if (c1.data?.record) keyIds.push(c1.data.record.id);
  if (c2.data?.record) keyIds.push(c2.data.record.id);
  check("create → 201 with the plain key once (default = Read only)", c1.status === 201 && /^atl_[A-Za-z0-9_-]{32}$/.test(c1.data.key) && c1.data.record.access === "Read only");
  check("create Read + write", c2.status === 201 && c2.data.record.access === "Read and write");
  const bad = await ab.api("/api/admin/agent-keys", { method: "POST", json: { name: "x", scopes: ["research.delete"] } });
  check("unknown permission → 422", bad.status === 422);
  const list = await ab.api("/api/admin/agent-keys");
  check("list never contains the key or its hash", list.status === 200 && !JSON.stringify(list.data).includes(c1.data.key) && !JSON.stringify(list.data).includes("key_hash"));
  const ro = c1.data.key, rw = c2.data.key;

  console.log("\n/agent-api:");
  let r = await agent("/manifest");
  check("no key → 401 {error}", r.status === 401 && typeof r.data?.error === "string");
  r = await agent("/manifest", { key: "atl_wrongwrongwrongwrongwrongwrongwron" });
  check("bad key → 401", r.status === 401);
  r = await agent("/manifest", { key: ro });
  check("manifest (read only) → only read actions", r.status === 200 && r.data.spec === "atlas-agent-api/1" && r.data.key.access === "Read only" && r.data.actions.map((a) => a.id).join() === "list_submissions,get_submission,submission_stats");
  check("JSON + no-store", /application\/json/.test(r.res.headers.get("content-type")) && r.res.headers.get("cache-control") === "no-store");
  r = await agent("/manifest", { key: rw });
  check("manifest (read + write) → 5 actions", r.data.actions.length === 5);
  r = await agent(`/submissions/${pid}/notes`, { key: ro, method: "POST", body: { note: "x" } });
  check("read-only key → write action → 403", r.status === 403);
  r = await agent("/submissions?department=ISDI&limit=200", { key: ro });
  check("list_submissions → 200", r.status === 200 && r.data.submissions.some((s) => s.id === pid));
  r = await agent(`/submissions/${ref}`, { key: ro });
  check("get_submission by ref → 200", r.status === 200 && r.data.submission.id === pid);
  r = await agent("/stats/submissions", { key: ro });
  check("submission_stats → 200", r.status === 200 && r.data.total >= 1);
  r = await agent(`/submissions/${pid}/notes`, { key: rw, method: "POST", body: { note: "From HTTP test" } });
  check("add_review_note → 201", r.status === 201 && r.data.saved === true);
  r = await agent(`/submissions/${pid}/status`, { key: rw, method: "POST", body: { status: "UNDER_REVIEW" } });
  check("update_submission_status → 200", r.status === 200 && r.data.submission.status === "UNDER_REVIEW");
  check("POST through the CSRF middleware is not blocked (no /api prefix)", r.status !== 403);
  const logged = await db.one(`SELECT COUNT(*) AS n FROM \`${T.agentApiLog}\` WHERE key_id = ? AND agent = 'HTTP test agent'`, [keyIds[1]]);
  check("requests logged with the agent header", Number(logged.n) >= 3);

  console.log("\nRevoke:");
  const rv = await ab.api(`/api/admin/agent-keys/${keyIds[0]}`, { method: "POST", json: { action: "revoke" } });
  check("admin revoke → 200", rv.status === 200);
  r = await agent("/manifest", { key: ro });
  check("revoked key → 401", r.status === 401);
  const after = (await ab.api("/api/admin/agent-keys")).data.keys.find((k) => k.id === keyIds[0]);
  check("list shows revoked + last used", after?.state === "revoked" && !!after.lastUsedAt);
}

try {
  await main();
} catch (e) {
  h.fail(e);
} finally {
  if (keyIds.length) {
    await db.exec(`DELETE FROM \`${T.agentApiLog}\` WHERE key_id IN (?)`, [keyIds]);
    await db.exec(`DELETE FROM \`${T.agentApiKeys}\` WHERE id IN (?)`, [keyIds]);
  }
  await db.exec(`DELETE FROM \`${T.agentApiLog}\` WHERE key_id IS NULL AND agent = 'HTTP test agent'`);
  await h.finish("IntelligenceOS Agent API HTTP");
}
