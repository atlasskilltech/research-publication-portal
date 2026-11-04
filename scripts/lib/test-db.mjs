/**
 * Shared helpers for the live HTTP suites (MySQL-backed app).
 *
 * - DB access through the app's own core (lib/db/core.mjs) using DB_* env —
 *   point it at the SAME database as the running app (never production).
 * - Throwaway accounts: rpp.it.<rand>@atlasuniversity.edu.in, tracked in a
 *   manifest and deleted in FK-safe order by cleanup() (runs even on failure).
 * - A tiny cookie-jar "browser" that always sends Origin (CSRF middleware).
 * - confirmLink(): submits the /auth/confirm server-action form exactly like a
 *   browser without JS (multipart POST with the $ACTION_ID_ field).
 */
import crypto from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createDb, createPool, dbConfigFromEnv } from "../../lib/db/core.mjs";
import { T } from "../../lib/db/tables.mjs";
import { hashPassword } from "../../lib/auth/password.mjs";
import { issueToken } from "../../lib/auth/store.mjs";
import { createRegisteredUser, setPasswordHash, markEmailVerified, setUserRoles, findUserByEmail } from "../../lib/repos/users.mjs";

export const REAL_ACCOUNTS = ["faizan.shaikh@atlasuniversity.edu.in", "elizabeth.jerome@atlasuniversity.edu.in", "sf48116@gmail.com"];

export function makeHarness(base) {
  const BASE = String(base || "http://localhost:3001").replace(/\/+$/, "");
  const db = createDb(createPool({ ...dbConfigFromEnv(process.env), connectionLimit: 4 }));
  const manifest = { users: [], papers: [], volumes: [], issues: [], publications: [], files: [] };
  let failures = 0, total = 0;
  const check = (label, ok, detail = "") => { total++; console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; return ok; };
  const tag = () => crypto.randomBytes(4).toString("hex");
  const email = (kind = "u") => `rpp.it.${kind}.${tag()}@atlasuniversity.edu.in`;

  /** Throwaway, verified account with a password. → { id, email, password } */
  async function mkUser({ kind = "u", baseType = "FACULTY", name, applicationNo = null, verified = true, withPassword = true } = {}) {
    const e = email(kind);
    const id = await createRegisteredUser(db, { name: name || `IT ${kind}`, email: e, baseType, applicationNo });
    manifest.users.push(id);
    const password = withPassword ? `It#${crypto.randomBytes(12).toString("base64url")}` : null;
    if (password) await setPasswordHash(db, id, await hashPassword(password));
    if (verified) await markEmailVerified(db, id);
    return { id, email: e, password };
  }
  /** A throwaway administrator (never a real account). */
  async function mkAdmin(opts = {}) {
    const u = await mkUser({ kind: "admin", ...opts });
    await db.exec(`UPDATE \`${T.users}\` SET isAdmin = 1 WHERE id = ?`, [u.id]);
    await db.exec(`INSERT IGNORE INTO \`${T.userRoles}\` (user_id, role) VALUES (?, 'ADMINISTRATOR')`, [u.id]);
    return u;
  }
  async function grant(actorId, targetId, roles) {
    return db.transaction((tx) => setUserRoles(tx, { actorId, targetId, roles }));
  }
  /** Track an account created through the app (e.g. /api/register). */
  async function track(e) {
    const u = await findUserByEmail(db, e);
    if (u && !manifest.users.includes(u.id)) manifest.users.push(u.id);
    return u;
  }

  /** ip: the X-Forwarded-For this "browser" presents (separate rate-limit buckets per suite). */
  function browser({ ip = `10.${[1, 2, 3].map(() => crypto.randomInt(1, 255)).join(".")}` } = {}) {
    const jar = new Map();
    const store = (res) => {
      for (const c of res.headers.getSetCookie?.() || []) {
        const [pair, ...attrs] = c.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim();
        const val = pair.slice(i + 1).trim();
        const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim()) || /expires=Thu, 01 Jan 1970/i.test(a.trim()));
        if (!val || expired) jar.delete(name); else jar.set(name, val);
      }
    };
    const cookie = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    async function req(p, { method = "GET", json, body, headers = {} } = {}) {
      const h = { Cookie: cookie(), "X-Forwarded-For": ip, ...headers };
      if (method !== "GET") h.Origin = h.Origin ?? BASE;
      let payload = body;
      if (json !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(json); }
      const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: "manual" });
      store(res);
      return res;
    }
    async function api(p, opts) {
      const res = await req(p, opts);
      let data = null;
      try { data = await res.json(); } catch { /* not json */ }
      return { status: res.status, data, res };
    }
    async function login(e, password) {
      const r = await api("/api/login", { method: "POST", json: { email: e, password } });
      return r.status;
    }
    return { req, api, login, cookie, jar, set: (k, v) => jar.set(k, v) };
  }

  /**
   * Visit /auth/confirm with a raw token and press "Continue" (no-JS form POST
   * of the server action). → { status, location, browser }
   */
  async function confirmLink(br, raw, type = "invite", flow = "setup") {
    const page = await br.req(`/auth/confirm?token_hash=${raw}&type=${type}&flow=${flow}`);
    const html = await page.text();
    const action = (html.match(/name="(\$ACTION_ID_[a-f0-9]+)"/) || [])[1];
    if (!action) return { status: page.status, location: null, html };
    const fd = new FormData();
    fd.set(action, "");
    fd.set("token_hash", raw);
    fd.set("type", type);
    fd.set("flow", flow);
    const res = await br.req(`/auth/confirm?token_hash=${raw}&type=${type}&flow=${flow}`, { method: "POST", body: fd });
    return { status: res.status, location: res.headers.get("location") || "" };
  }
  const token = (userId, purpose = "INVITE") => issueToken(db, userId, purpose);

  async function cleanup() {
    const del = async (table, ids) => { if (ids.length) await db.exec(`DELETE FROM \`${table}\` WHERE id IN (?)`, [ids]); };
    try {
      // Papers created by tracked users through the app are tracked too.
      if (manifest.users.length) {
        const owned = await db.query(`SELECT id FROM \`${T.papers}\` WHERE submitted_by IN (?)`, [manifest.users]);
        for (const r of owned) if (!manifest.papers.includes(r.id)) manifest.papers.push(r.id);
      }
      if (manifest.papers.length) {
        const pubs = await db.query(`SELECT id FROM \`${T.publications}\` WHERE paper_id IN (?)`, [manifest.papers]);
        for (const r of pubs) if (!manifest.publications.includes(r.id)) manifest.publications.push(r.id);
        const keys = await db.query(`SELECT storage_key FROM \`${T.paperManuscripts}\` WHERE paper_id IN (?)`, [manifest.papers]);
        manifest.files.push(...keys.map((k) => k.storage_key));
      }
      await del(T.publications, manifest.publications);
      await del(T.issues, manifest.issues);
      await del(T.volumes, manifest.volumes);
      await del(T.papers, manifest.papers);
      await del(T.users, manifest.users);
      const dir = process.env.MANUSCRIPT_STORAGE_DIR;
      if (dir) for (const k of manifest.files) if (/^[a-f0-9]{32}\.(pdf|docx|doc)$/.test(k)) await rm(path.join(dir, k), { force: true });
    } catch (e) {
      failures++;
      console.error("✗ cleanup error:", e.code || e.message);
    }
  }

  /** Only the 3 real accounts may remain after a suite. */
  async function assertOnlyRealAccounts() {
    const rows = await db.query(`SELECT email FROM \`${T.users}\` ORDER BY email`);
    const emails = rows.map((r) => r.email);
    check(`only the ${REAL_ACCOUNTS.length} real accounts remain (${emails.length} total)`,
      emails.length === REAL_ACCOUNTS.length && REAL_ACCOUNTS.every((e) => emails.includes(e)),
      emails.filter((e) => !REAL_ACCOUNTS.includes(e)).join(", "));
  }

  async function finish(title) {
    await cleanup();
    await assertOnlyRealAccounts();
    await db.end();
    console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${title}: ${total - failures}/${total} checks`);
    process.exit(failures === 0 ? 0 : 1);
  }

  return {
    BASE, db, T, manifest, check, mkUser, mkAdmin, grant, track, browser, confirmLink, token, email, tag, finish,
    fail: (e) => { failures++; console.error("✗ suite error:", e?.stack || e?.message || e); },
  };
}
