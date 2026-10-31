/**
 * LIVE end-to-end workflow test against the EXISTING Supabase project, driven
 * over HTTP against a locally running production build (`next start`).
 *
 * It creates clearly-identified TEST accounts/data, runs submission → review →
 * decision → revision → re-review → accept → publish → public catalogue, checks
 * access control + double-blind/confidentiality at every step, then deletes
 * EVERYTHING it created. Every delete is filtered by recorded test ids AND
 * re-verified (title prefix / plus-address) — never by a pattern on real data.
 *
 *   RPP_E2E_CONFIRM=yes node --env-file=.env.local scripts/test-e2e-live.mjs [baseUrl]
 *   node --env-file=.env.local scripts/test-e2e-live.mjs --cleanup .e2e-manifest-<runid>.json
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (fixtures/teardown/
 * verification reads only), EMAIL_ID (sender mailbox; test accounts are
 * plus-addresses of it so mail never reaches a real person),
 * MANUSCRIPT_STORAGE_DIR (must match the server's, for file cleanup).
 * Never prints passwords, tokens or cookies.
 */
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) { console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY."); process.exit(1); }
// Same construction as scripts/admin-snapshot.mjs.
const sb = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

const STORAGE_DIR = (process.env.MANUSCRIPT_STORAGE_DIR || "").trim() || path.join(os.tmpdir(), "rpp-manuscripts-dev");
const SAFE_KEY = /^[a-f0-9]{32}\.(pdf|docx|doc)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Manifest (re-runnable cleanup) -----------------------------------------
let manifest = null, manifestPath = null;
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const rec = (kind, id) => { if (id && !manifest[kind].includes(id)) { manifest[kind].push(id); saveManifest(); } };

// ---- Cleanup ------------------------------------------------------------------
async function cleanup(m) {
  console.log(`\n== CLEANUP run ${m.runId} ==`);
  const prefix = `[TEST ${m.runId}]`;
  const tag = `+rpp-${m.runId}-`;
  let problems = 0;
  const warn = (msg) => { problems++; console.log(`  ! ${msg}`); };
  const userIds = Object.values(m.users || {}).map((u) => u.id).filter(Boolean);

  // Papers: recorded ids ∪ papers submitted by recorded test users, then keep
  // ONLY rows whose title carries this run's prefix.
  const cand = new Set(m.paperIds || []);
  if (userIds.length) {
    const { data } = await sb.from("papers").select("id").in("submitted_by", userIds);
    (data || []).forEach((p) => cand.add(p.id));
  }
  let paperIds = [];
  if (cand.size) {
    const { data } = await sb.from("papers").select("id, title").in("id", [...cand]);
    for (const p of data || []) (p.title || "").startsWith(prefix) ? paperIds.push(p.id) : warn(`skip paper ${p.id}: title lacks test prefix`);
  }
  // Storage keys BEFORE the rows go (cascade removes paper_manuscripts).
  if (paperIds.length) {
    const { data } = await sb.from("paper_manuscripts").select("storage_key").in("paper_id", paperIds);
    for (const r of data || []) if (!m.storageKeys.includes(r.storage_key)) m.storageKeys.push(r.storage_key);
    if (manifestPath) saveManifest();
  }
  if (paperIds.length) {
    const { data, error } = await sb.from("publications").delete().in("paper_id", paperIds).select("id");
    error ? warn(`publications: ${error.message}`) : console.log(`  publications deleted: ${data.length}`);
    const r = await sb.from("papers").delete().in("id", paperIds).select("id");
    r.error ? warn(`papers: ${r.error.message}`) : console.log(`  papers deleted (children cascade): ${r.data.length}`);
  }
  // Issues, then volumes: recorded ids ∪ created by test users, title-prefix verified.
  for (const [table, kind] of [["issues", "issueIds"], ["volumes", "volumeIds"]]) {
    const ids = new Set(m[kind] || []);
    if (userIds.length) { const { data } = await sb.from(table).select("id").in("created_by", userIds); (data || []).forEach((x) => ids.add(x.id)); }
    if (!ids.size) continue;
    const { data: rows } = await sb.from(table).select("id, title").in("id", [...ids]);
    const ok = (rows || []).filter((x) => (x.title || "").startsWith(prefix)).map((x) => x.id);
    (rows || []).filter((x) => !ok.includes(x.id)).forEach((x) => warn(`skip ${table} ${x.id}: title lacks test prefix`));
    if (!ok.length) continue;
    const { data, error } = await sb.from(table).delete().in("id", ok).select("id");
    error ? warn(`${table}: ${error.message}`) : console.log(`  ${table} deleted: ${data.length}`);
  }
  // Users: verify the plus-address tag first; ADMIN last.
  const order = Object.entries(m.users || {}).sort(([a], [b]) => (a === "ADMIN") - (b === "ADMIN"));
  for (const [persona, u] of order) {
    if (!u?.id) continue;
    const { data, error } = await sb.auth.admin.getUserById(u.id);
    if (error || !data?.user) { console.log(`  user ${persona}: already gone`); continue; }
    if (!(data.user.email || "").toLowerCase().includes(tag)) { warn(`skip user ${persona}: email is not a test address`); continue; }
    const del = await sb.auth.admin.deleteUser(u.id);
    if (del.error) warn(`user ${persona}: ${/RPP_LAST_ADMIN/.test(del.error.message) ? "RPP_LAST_ADMIN (refused: last admin)" : del.error.message}`);
    else console.log(`  user deleted: ${persona}`);
  }
  // Manuscript files: only recorded keys, only under the storage root.
  let files = 0;
  for (const key of m.storageKeys || []) {
    if (!SAFE_KEY.test(key)) { warn(`skip unsafe key ${key}`); continue; }
    const full = path.join(STORAGE_DIR, key);
    try { unlinkSync(full); files++; } catch (e) { if (e.code !== "ENOENT") warn(`file ${key}: ${e.code}`); }
  }
  console.log(`  manuscript files removed from ${STORAGE_DIR}: ${files} (of ${(m.storageKeys || []).length} recorded)`);
  if (!problems && manifestPath && existsSync(manifestPath)) { unlinkSync(manifestPath); console.log("  manifest removed (clean)."); }
  else if (problems) console.log(`  ${problems} cleanup problem(s); manifest kept: ${manifestPath}`);
  return problems;
}

if (process.argv[2] === "--cleanup") {
  manifestPath = path.resolve(process.argv[3] || "");
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  process.exit((await cleanup(manifest)) ? 1 : 0);
}

// ---- Safety preamble --------------------------------------------------------------
if (process.env.RPP_E2E_CONFIRM !== "yes") {
  console.error("Refusing to run: this writes TEST data to the live Supabase project. Set RPP_E2E_CONFIRM=yes.");
  process.exit(1);
}
const [mbLocal, mbDomain] = (process.env.EMAIL_ID || "").trim().toLowerCase().split("@");
if (!mbLocal || !mbDomain) { console.error("Need EMAIL_ID (the portal sender mailbox)."); process.exit(1); }
const BASE = (process.argv[2] || "http://127.0.0.1:5631").replace(/\/$/, "");
const RUN = `e2e${Date.now()}`;
const PREFIX = `[TEST ${RUN}]`;
const MARK = `CONFIDENTIAL-${RUN}`;
const emailFor = (p) => `${mbLocal.split("+")[0]}+rpp-${RUN}-${p.toLowerCase()}@${mbDomain}`;
manifestPath = path.resolve(process.cwd(), `.e2e-manifest-${RUN}.json`);
manifest = { runId: RUN, baseUrl: BASE, createdAt: new Date().toISOString(), users: {}, paperIds: [], publicationIds: [], issueIds: [], volumeIds: [], storageKeys: [] };
saveManifest();
console.log(`Run ${RUN} → ${BASE}\nManifest: ${manifestPath}`);

// ---- Checks ---------------------------------------------------------------------
let failures = 0, passes = 0;
function check(label, ok, detail = "") {
  if (ok) { passes++; console.log(`  ok   ${label}`); }
  else { failures++; console.log(`  FAIL ${label}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`); }
  return ok;
}
const warnOnly = (label, ok, detail = "") => console.log(`  ${ok ? "ok  " : "WARN"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
class Abort extends Error {}
const need = (label, ok, detail) => { if (!check(label, ok, detail)) throw new Abort(label); };

// ---- HTTP with a per-persona cookie jar -------------------------------------------
function newJar() {
  const m = new Map();
  return {
    m,
    header: () => [...m].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(res) {
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair, ...attrs] = c.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim(), val = pair.slice(i + 1).trim();
        const expired = !val || attrs.some((a) => /^\s*max-age=(0|-)/i.test(a) || (/^\s*expires=/i.test(a) && new Date(a.split("=")[1]) < new Date()));
        expired ? m.delete(name) : m.set(name, val);
      }
    },
  };
}
async function http(who, method, p, { json, form } = {}) {
  const headers = { origin: BASE };
  if (who?.jar?.m.size) headers.cookie = who.jar.header();
  let body;
  if (json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(BASE + p, { method, headers, body, redirect: "manual" });
  who?.jar?.absorb(res);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  let data = null;
  if ((res.headers.get("content-type") || "").includes("json")) { try { data = JSON.parse(text); } catch {} }
  return { status: res.status, data, text, buf, headers: res.headers };
}
const brief = (r) => `${r.status} ${r.data?.error || ""}`;
const lacks = (text, needles) => needles.filter(Boolean).every((n) => !text.toLowerCase().includes(String(n).toLowerCase()));

// Minimal but well-formed PDF (header, objects, xref, trailer, %%EOF).
function makePdf(label) {
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>`];
  const stream = `BT /F1 12 Tf 20 100 Td (${label}) Tj ET`;
  objs.push(`<</Length ${stream.length}>>stream\n${stream}\nendstream`);
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const off = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return off; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const pdfForm = (buf, name = "test-manuscript.pdf") => {
  const f = new FormData();
  f.append("manuscript", new Blob([buf], { type: "application/pdf" }), name);
  return f;
};

// ---- Personas ----------------------------------------------------------------------
const P = {};
const PERSONAS = ["ADMIN", "EDITOR", "REV1", "REV2", "DESK", "AUTHOR", "OUTSIDER"];
async function createPersona(key) {
  const email = emailFor(key);
  const password = crypto.randomBytes(24).toString("base64url") + "Aa1!";
  const name = `${PREFIX} ${key}`;
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, base_type: "FACULTY" } });
  if (error) throw new Abort(`createUser ${key}: ${error.message}`);
  manifest.users[key] = { id: data.user.id, email }; saveManifest();
  P[key] = { key, email, name, id: data.user.id, password, jar: newJar() };
}
async function login(p) {
  const r = await http(p, "POST", "/api/login", { json: { email: p.email, password: p.password } });
  need(`login ${p.key}`, r.status === 200 && p.jar.m.size > 0, brief(r));
}

// ---- Workflow ------------------------------------------------------------------------
async function run() {
  const h = await fetch(BASE + "/api/health").catch(() => null);
  need("server reachable", !!h, `cannot reach ${BASE}`);

  console.log("\n# Fixtures");
  for (const k of PERSONAS) await createPersona(k);
  check("personas created", PERSONAS.every((k) => P[k]?.id));
  // ADMIN via service role (bypasses the escalation trigger).
  const up = await sb.from("profiles").update({ is_admin: true }).eq("id", P.ADMIN.id).select("id");
  const ur = await sb.from("user_roles").insert({ user_id: P.ADMIN.id, role: "ADMINISTRATOR" });
  need("test admin provisioned", !up.error && up.data?.length === 1 && !ur.error, up.error?.message || ur.error?.message);

  console.log("\n# Login + role grants through the app");
  for (const k of PERSONAS) await login(P[k]);
  for (const [k, roles] of [["EDITOR", ["EDITOR"]], ["REV1", ["PEER_REVIEWER"]], ["REV2", ["PEER_REVIEWER"]], ["DESK", ["DESK_REVIEWER"]]]) {
    const r = await http(P.ADMIN, "PATCH", `/api/admin/users/${P[k].id}`, { json: { roles } });
    need(`grant ${roles} to ${k}`, r.status === 200 && JSON.stringify(r.data?.roles) === JSON.stringify(roles), brief(r));
  }
  const ou = await http(P.OUTSIDER, "GET", "/api/admin/users");
  check("OUTSIDER cannot list users (403)", ou.status === 403, brief(ou));
  const au = await http(P.ADMIN, "GET", "/api/admin/users");
  check("ADMIN lists users (200)", au.status === 200 && au.text.includes(P.AUTHOR.id), brief(au));

  console.log("\n# Submission");
  const coEmail = emailFor("coauthor");
  const authorNames = [`${PREFIX} Author One`, `${PREFIX} Co Author`];
  const f = pdfForm(makePdf(`${PREFIX} original`));
  f.append("title", `${PREFIX} Live E2E paper`);
  f.append("abstract", "Automated end-to-end test submission. Safe to ignore.");
  f.append("keywords", `e2e, ${RUN}`);
  f.append("authors", JSON.stringify([
    { fullName: authorNames[0], email: P.AUTHOR.email, affiliation: "Test Affiliation", isCorresponding: true },
    { fullName: authorNames[1], email: coEmail, affiliation: "Test Affiliation", isCorresponding: false },
  ]));
  const sub = await http(P.AUTHOR, "POST", "/api/papers", { form: f });
  need("AUTHOR submits paper (201)", sub.status === 201 && sub.data?.id, brief(sub));
  const pid = sub.data.id; rec("paperIds", pid);
  const authorSecrets = [P.AUTHOR.email, coEmail, ...authorNames];
  const reviewerSecrets = [P.REV1, P.REV2, P.DESK].flatMap((p) => [p.email, p.id, p.name]);

  const list = await http(P.AUTHOR, "GET", "/api/papers");
  check("AUTHOR sees paper in list", list.status === 200 && list.data?.papers?.some((x) => x.id === pid && x.mine), brief(list));
  const op = await http(P.OUTSIDER, "GET", `/api/papers/${pid}`);
  check("OUTSIDER paper detail → 403/404", [403, 404].includes(op.status), brief(op));
  const om = await http(P.OUTSIDER, "GET", `/api/papers/${pid}/manuscript`);
  check("OUTSIDER manuscript → 403/404", [403, 404].includes(om.status), brief(om));
  const aa = await http(P.AUTHOR, "POST", `/api/papers/${pid}/assign`, { json: { assignee: P.REV1.id, role: "PEER_REVIEWER" } });
  check("AUTHOR cannot assign (403)", aa.status === 403, brief(aa));

  console.log("\n# Assignment (EDITOR first so manager mail goes to the test editor, not real admins)");
  const due = new Date(Date.now() + 14 * 86400000).toISOString();
  for (const [k, role] of [["EDITOR", "EDITOR"], ["REV1", "PEER_REVIEWER"], ["REV2", "PEER_REVIEWER"], ["DESK", "DESK_REVIEWER"]]) {
    const r = await http(P.ADMIN, "POST", `/api/papers/${pid}/assign`, { json: { assignee: P[k].id, role, dueAt: due } });
    need(`assign ${k} as ${role}`, r.status === 200, brief(r));
  }
  let d = await http(P.AUTHOR, "GET", `/api/papers/${pid}`);
  check("status UNDER_REVIEW", d.data?.paper?.status === "UNDER_REVIEW", d.data?.paper?.status);
  check("AUTHOR detail hides reviewer identity", lacks(d.text, reviewerSecrets));

  console.log("\n# Double-blind reviewer access");
  const r1d = await http(P.REV1, "GET", `/api/papers/${pid}`);
  check("REV1 paper detail 200", r1d.status === 200, brief(r1d));
  check("REV1 detail has no author identity", lacks(r1d.text, authorSecrets) && !("authors" in (r1d.data?.paper || {})));
  const r2d = await http(P.REV2, "GET", `/api/papers/${pid}`);
  check("REV2 cannot see co-reviewer REV1", r2d.status === 200 && lacks(r2d.text, [P.REV1.id, P.REV1.email]));
  const r1m = await http(P.REV1, "GET", `/api/papers/${pid}/manuscript`);
  check("REV1 downloads manuscript (PDF)", r1m.status === 200 && r1m.buf.subarray(0, 5).toString() === "%PDF-", brief(r1m));
  check("REV1 download filename is neutral", !/test-manuscript/.test(r1m.headers.get("content-disposition") || ""));

  console.log("\n# Reviews round 0");
  const review = (rec_, extra = {}) => ({
    recommendation: rec_, technicalQuality: 4, originality: 3, methodology: 4, clarity: 5,
    strengths: "Clear test strengths.", weaknesses: "Some test weaknesses.",
    commentsToAuthor: `Reviewer comment for the author (${RUN}).`, confidentialToEditor: `${MARK} do not share`, ...extra,
  });
  for (const k of ["REV1", "REV2", "DESK"]) {
    const dr = await http(P[k], "PUT", `/api/papers/${pid}/review`, { json: { ...review("MAJOR_REVISION"), clarity: "" } });
    check(`${k} saves draft`, dr.status === 200 && dr.data?.status === "DRAFT", brief(dr));
    const sr = await http(P[k], "PUT", `/api/papers/${pid}/review`, { json: { ...review(k === "DESK" ? "MINOR_REVISION" : "MAJOR_REVISION"), submit: true } });
    need(`${k} submits review`, sr.status === 200 && sr.data?.status === "SUBMITTED", brief(sr));
  }
  const again = await http(P.REV1, "PUT", `/api/papers/${pid}/review`, { json: { ...review("ACCEPT"), submit: true } });
  check("second submit → 409", again.status === 409, brief(again));

  const rv = await http(P.EDITOR, "GET", `/api/papers/${pid}/reviews`);
  check("EDITOR sees reviews incl. confidential", rv.status === 200 && rv.text.includes(MARK), brief(rv));
  const rev1Review = rv.data?.reviewers?.find((x) => x.reviewer === P.REV1.id)?.review?.id;
  need("REV1 review id found", !!rev1Review);

  const decBody = { decision: "MAJOR_REVISION", summary: `Please revise (${RUN}).`, confidentialNote: `${MARK} editor note`, reviewIds: [rev1Review], dueAt: due };
  const r1dec = await http(P.REV1, "POST", `/api/papers/${pid}/decisions`, { json: decBody });
  check("REV1 cannot make a decision (403)", r1dec.status === 403, brief(r1dec));

  console.log("\n# Decision: MAJOR_REVISION");
  const sd = await http(P.EDITOR, "POST", `/api/papers/${pid}/decisions`, { json: decBody });
  need("EDITOR saves decision", sd.status === 200 && sd.data?.decision?.id, brief(sd));
  const pre = await http(P.AUTHOR, "GET", `/api/papers/${pid}/decisions`);
  check("AUTHOR sees no unreleased decision", pre.status === 200 && (pre.data?.decisions || []).length === 0, brief(pre));
  const rel = await http(P.EDITOR, "POST", `/api/papers/${pid}/decisions/${sd.data.decision.id}/release`, { json: { expectedVersion: sd.data.decision.version } });
  need("EDITOR releases decision", rel.status === 200, brief(rel));
  d = await http(P.AUTHOR, "GET", `/api/papers/${pid}`);
  check("status REVISION", d.data?.paper?.status === "REVISION", d.data?.paper?.status);

  const ad = await http(P.AUTHOR, "GET", `/api/papers/${pid}/decisions`);
  const dec0 = ad.data?.decisions?.[0];
  check("AUTHOR sees released decision", ad.status === 200 && dec0?.decision === "MAJOR_REVISION", brief(ad));
  check("AUTHOR sees 'Reviewer 1' comments", dec0?.reviews?.length === 1 && dec0.reviews[0].label === "Reviewer 1" && dec0.reviews[0].commentsToAuthor.includes(RUN));
  check("AUTHOR decisions: no confidential/reviewer identity", lacks(ad.text, [MARK, ...reviewerSecrets, P.EDITOR.id, P.EDITOR.email]));

  console.log("\n# Revision round 1");
  const ar = await http(P.AUTHOR, "GET", `/api/papers/${pid}/revisions`);
  check("AUTHOR revisions view", ar.status === 200 && ar.data?.revisions?.[0]?.round === 1, brief(ar));
  check("AUTHOR revisions: no confidential/reviewer identity", lacks(ar.text, [MARK, ...reviewerSecrets]));
  const upl = await http(P.AUTHOR, "POST", `/api/papers/${pid}/revisions/1/manuscript`, { form: pdfForm(makePdf(`${PREFIX} revised`), "revised.pdf") });
  need("AUTHOR uploads revised manuscript", upl.status === 201 && upl.data?.version === 1, brief(upl));
  const responses = [{ reviewKey: "R1", comment: "Reviewer 1 main point", response: `Addressed (${RUN}).`, addressed: true }];
  const sv = await http(P.AUTHOR, "PUT", `/api/papers/${pid}/revisions/1`, { json: { responses } });
  check("AUTHOR saves responses draft", sv.status === 200, brief(sv));
  const sbm = await http(P.AUTHOR, "PUT", `/api/papers/${pid}/revisions/1`, { json: { responses, submit: true } });
  need("AUTHOR submits revision", sbm.status === 200 && sbm.data?.status === "REVISION_SUBMITTED", brief(sbm));
  const early = await http(P.REV1, "GET", `/api/papers/${pid}/manuscript?version=1`);
  check("REV1 cannot fetch v1 before re-review (404)", early.status === 404, brief(early));
  const rr = await http(P.EDITOR, "POST", `/api/papers/${pid}/revisions/1/rereview`, { json: { dueAt: due } });
  need("EDITOR starts re-review", rr.status === 200, brief(rr));
  const v1 = await http(P.REV1, "GET", `/api/papers/${pid}/manuscript?version=1`);
  check("REV1 downloads v1 after re-review", v1.status === 200 && v1.buf.subarray(0, 5).toString() === "%PDF-", brief(v1));

  console.log("\n# Round 1 review + ACCEPT");
  const s1 = await http(P.REV1, "PUT", `/api/papers/${pid}/review`, { json: { ...review("ACCEPT"), submit: true } });
  need("REV1 submits round-1 review", s1.status === 200 && s1.data?.round === 1, brief(s1));
  const rv1 = await http(P.EDITOR, "GET", `/api/papers/${pid}/reviews`);
  const r1Round1 = rv1.data?.reviewers?.find((x) => x.reviewer === P.REV1.id)?.review?.id;
  const acc = await http(P.EDITOR, "POST", `/api/papers/${pid}/decisions`, { json: { decision: "ACCEPT", summary: `Accepted (${RUN}).`, reviewIds: r1Round1 ? [r1Round1] : [] } });
  need("EDITOR saves ACCEPT", acc.status === 200 && acc.data?.decision?.id, brief(acc));
  const accRel = await http(P.EDITOR, "POST", `/api/papers/${pid}/decisions/${acc.data.decision.id}/release`, { json: { expectedVersion: acc.data.decision.version } });
  need("EDITOR releases ACCEPT", accRel.status === 200, brief(accRel));
  d = await http(P.AUTHOR, "GET", `/api/papers/${pid}`);
  check("status ACCEPTED", d.data?.paper?.status === "ACCEPTED", d.data?.paper?.status);

  console.log("\n# Publication");
  const vol = await http(P.ADMIN, "POST", "/api/publications/volumes", { json: { volumeNumber: 1000 + crypto.randomInt(8999), year: 2199, title: `${PREFIX} Volume` } });
  need("ADMIN creates volume", vol.status === 201 && vol.data?.id, brief(vol)); rec("volumeIds", vol.data.id);
  const iss = await http(P.ADMIN, "POST", "/api/publications/issues", { json: { volumeId: vol.data.id, issueNumber: 1, title: `${PREFIX} Issue` } });
  need("ADMIN creates issue", iss.status === 201 && iss.data?.id, brief(iss)); rec("issueIds", iss.data.id);
  const { data: ms } = await sb.from("paper_manuscripts").select("id, version, storage_key").eq("paper_id", pid);
  (ms || []).forEach((m) => { if (!manifest.storageKeys.includes(m.storage_key)) manifest.storageKeys.push(m.storage_key); }); saveManifest();
  const finalMs = (ms || []).find((m) => m.version === 1);
  const pubMeta = { paperId: pid, volumeId: vol.data.id, issueId: iss.data.id, title: `${PREFIX} Live E2E paper`, abstract: "Published test abstract.",
    authors: [{ name: authorNames[0], affiliation: "Test Affiliation" }], keywords: ["e2e", RUN], manuscriptId: finalMs?.id, manuscriptPublic: false };
  const sch = await http(P.EDITOR, "POST", "/api/publications", { json: pubMeta });
  need("EDITOR schedules publication", sch.status === 201 && sch.data?.id, brief(sch));
  const pubId = sch.data.id; rec("publicationIds", pubId);
  const { data: pubRow } = await sb.from("publications").select("version").eq("id", pubId).single();
  const pp = await http(P.EDITOR, "PATCH", `/api/publications/${pubId}`, { json: { ...pubMeta, manuscriptPublic: true, expectedVersion: pubRow.version } });
  check("EDITOR sets manuscriptPublic=true", pp.status === 200, brief(pp));
  const evp = await http(P.EDITOR, "PATCH", `/api/publications/volumes/${vol.data.id}`, { json: { status: "PUBLISHED" } });
  check("EDITOR cannot publish a volume (403)", evp.status === 403, brief(evp));
  const pre404 = await http(null, "GET", `/api/public/publications/${pubId}`);
  check("anon: scheduled publication is 404", pre404.status === 404, brief(pre404));
  const vp = await http(P.ADMIN, "PATCH", `/api/publications/volumes/${vol.data.id}`, { json: { status: "PUBLISHED" } });
  need("ADMIN publishes volume", vp.status === 200, brief(vp));
  const ip = await http(P.ADMIN, "PATCH", `/api/publications/issues/${iss.data.id}`, { json: { status: "PUBLISHED", publishPapers: true } });
  need("ADMIN publishes issue + papers", ip.status === 200 && ip.data?.papersPublished === 1, brief(ip) + ` papersPublished=${ip.data?.papersPublished}`);
  d = await http(P.AUTHOR, "GET", `/api/papers/${pid}`);
  check("status PUBLISHED", d.data?.paper?.status === "PUBLISHED", d.data?.paper?.status);

  console.log("\n# Public catalogue (anonymous)");
  const pl = await http(null, "GET", `/api/public/publications?q=${encodeURIComponent(RUN)}`);
  check("anon list includes publication", pl.status === 200 && pl.data?.publications?.some((x) => x.id === pubId), brief(pl));
  const pd = await http(null, "GET", `/api/public/publications/${pubId}`);
  check("anon detail 200", pd.status === 200 && pd.data?.publication?.id === pubId, brief(pd));
  check("anon detail: no emails/paper id/reviewers", lacks(pd.text, [P.AUTHOR.email, coEmail, pid, "paper_id", "@", MARK, ...reviewerSecrets]));
  const pm = await http(null, "GET", `/api/public/publications/${pubId}/manuscript`);
  check("anon public manuscript 200 (PDF)", pm.status === 200 && pm.buf.subarray(0, 5).toString() === "%PDF-", brief(pm));
  // Non-public case: flip the flag on THIS test row only (published rows can't be edited via the API).
  const flip = await sb.from("publications").update({ manuscript_public: false }).eq("id", pubId).eq("paper_id", pid).select("id");
  if (!flip.error && flip.data?.length === 1) {
    const pm2 = await http(null, "GET", `/api/public/publications/${pubId}/manuscript`);
    check("anon non-public manuscript → 4xx", pm2.status >= 400 && pm2.status < 500, brief(pm2));
  } else warnOnly("could not flip manuscript_public for the non-public check", false, flip.error?.message);

  console.log("\n# Dashboards / activity / author confidentiality");
  for (const k of ["AUTHOR", "REV1", "EDITOR", "ADMIN"]) {
    const db = await http(P[k], "GET", "/api/dashboard");
    const ac = await http(P[k], "GET", "/api/activity");
    check(`${k} dashboard + activity 200`, db.status === 200 && ac.status === 200, `${brief(db)} / ${brief(ac)}`);
    if (k === "AUTHOR") check("AUTHOR dashboard/activity: no reviewer identity or confidential", lacks(db.text + ac.text, [MARK, "CONFIDENTIAL", ...reviewerSecrets]));
  }
  const finals = await Promise.all([`/api/papers/${pid}`, `/api/papers/${pid}/decisions`, `/api/papers/${pid}/revisions`, "/api/papers"].map((u) => http(P.AUTHOR, "GET", u)));
  check("AUTHOR never sees confidential text (all views)", finals.every((r) => r.status === 200 && lacks(r.text, [MARK])), finals.map(brief).join(" | "));
  const ar2 = await http(P.AUTHOR, "GET", `/api/papers/${pid}/review`);
  check("AUTHOR cannot read reviews endpoint", [403, 404].includes(ar2.status), brief(ar2));

  console.log("\n# Logout");
  const stale = new Map(P.OUTSIDER.jar.m);
  const lo = await http(P.OUTSIDER, "POST", "/api/logout", { json: {} });
  check("logout 200", lo.status === 200, brief(lo));
  const after = await http(P.OUTSIDER, "GET", "/api/dashboard");
  check("after logout → 401", after.status === 401, brief(after));
  const replay = await http({ jar: { m: stale, header: () => [...stale].map(([k, v]) => `${k}=${v}`).join("; "), absorb() {} } }, "GET", "/api/dashboard");
  warnOnly("replayed pre-logout cookies rejected (401)", replay.status === 401, `${replay.status}: access token may stay valid until expiry`);
}

// ---- Main ------------------------------------------------------------------------------
let cleaned = false;
async function finish() {
  if (cleaned) return; cleaned = true;
  await sleep(3000); // let after()-scheduled notifications finish before users vanish
  const probs = await cleanup(manifest).catch((e) => { console.log(`  cleanup crashed: ${e.message}`); return 1; });
  console.log(`\n== SUMMARY: ${passes} passed, ${failures} failed${probs ? `, ${probs} cleanup problem(s)` : ""} ==`);
  if (probs) console.log(`Re-run cleanup: node --env-file=.env.local scripts/test-e2e-live.mjs --cleanup ${manifestPath}`);
  process.exit(failures || probs ? 1 : 0);
}
process.on("SIGINT", () => { console.log("\nInterrupted — cleaning up…"); failures++; finish(); });
try {
  await run();
} catch (e) {
  if (!(e instanceof Abort)) { failures++; console.log(`  FAIL unexpected error — ${e?.message}`); }
  else console.log(`  (aborted workflow after: ${e.message})`);
} finally {
  await finish();
}
