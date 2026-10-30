/**
 * End-to-end HTTP auth + navigation test against the running Next dev server.
 *
 * Uses a THROWAWAY admin user it creates and deletes — it never touches the real
 * admin accounts or their passwords. Verifies: middleware gating, login/logout,
 * SSR session + admin identity, the Back-button fix (/login while authenticated
 * → /dashboard), refresh persistence, multi-tab (shared cookie) behaviour, and
 * admin access to /users.
 *
 * Usage: npm run supabase:test-http -- http://localhost:3002
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY.
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) { console.error("\n✖ Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.\n"); process.exit(1); }

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
let failures = 0;
const cleanup = [];
const check = (label, ok, detail = "") => { console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`); if (!ok) failures++; };

// cookie jar across a "browser"
function makeJar() {
  const jar = new Map();
  return {
    store(res) {
      const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of set) {
        const [pair] = c.split(";");
        const i = pair.indexOf("=");
        const name = pair.slice(0, i).trim();
        const val = pair.slice(i + 1).trim();
        if (!val || val === '""') jar.delete(name); else jar.set(name, val);
      }
    },
    header: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    size: () => jar.size,
    clone() { const j = makeJar(); for (const [k, v] of jar) j._set(k, v); return j; },
    _set(k, v) { jar.set(k, v); },
  };
}

async function main() {
  console.log(`\n=== HTTP auth + navigation flow against ${BASE} ===\n`);

  // Throwaway admin (confirmed) with a known ephemeral password.
  const email = `rpp.test.httpadmin.${crypto.randomBytes(4).toString("hex")}@atlasuniversity.edu.in`;
  const password = crypto.randomBytes(18).toString("base64url");
  {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: "HTTP Test Admin", base_type: "FACULTY" } });
    if (error) { check("create throwaway admin", false, error.message); return; }
    cleanup.push(data.user.id);
    await admin.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
  }

  const jar = makeJar();

  // 1) Unauthenticated protected route → redirect to /login.
  {
    const r = await fetch(`${BASE}/dashboard`, { redirect: "manual" });
    const loc = r.headers.get("location") || "";
    check("GET /dashboard unauthenticated → /login", [302, 303, 307].includes(r.status) && loc.includes("/login"), `HTTP ${r.status}`);
  }
  // 2) Wrong password → 401.
  {
    const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "wrong-" + password }) });
    check("POST /api/login wrong password → 401", r.status === 401, `HTTP ${r.status}`);
  }
  // 3) Correct password → 200 + cookie.
  {
    const r = await fetch(`${BASE}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    jar.store(r);
    check("POST /api/login correct → 200", r.status === 200, `HTTP ${r.status}`);
    check("session cookie set", [...jar.header().matchAll(/auth-token/g)].length > 0 || jar.size() > 0, `${jar.size()} cookie(s)`);
  }
  // 4) Authenticated dashboard → 200 + admin identity + admin nav.
  {
    const r = await fetch(`${BASE}/dashboard`, { headers: { Cookie: jar.header() }, redirect: "manual" });
    const html = await r.text();
    check("GET /dashboard authenticated → 200", r.status === 200, `HTTP ${r.status}`);
    check("profile retrieval: admin name rendered (SSR)", /HTTP Test Admin/.test(html));
    check("admin nav present (link to /users)", /href="\/users"/.test(html) || /\/users/.test(html));
  }
  // 5) Back-button fix: /login while authenticated → redirect to /dashboard.
  {
    const r = await fetch(`${BASE}/login`, { headers: { Cookie: jar.header() }, redirect: "manual" });
    const loc = r.headers.get("location") || "";
    check("GET /login while authenticated → /dashboard (Back-button fix)", [302, 303, 307].includes(r.status) && loc.includes("/dashboard"), `HTTP ${r.status} → ${loc || "(no redirect)"}`);
  }
  // 6) Refresh persistence: dashboard again.
  {
    const r = await fetch(`${BASE}/dashboard`, { headers: { Cookie: jar.header() }, redirect: "manual" });
    check("session persists on refresh (GET /dashboard → 200)", r.status === 200, `HTTP ${r.status}`);
  }
  // 7) Admin Users section accessible.
  {
    const r = await fetch(`${BASE}/users`, { headers: { Cookie: jar.header() }, redirect: "manual" });
    check("admin can access /users → 200", r.status === 200, `HTTP ${r.status}`);
  }
  // 7b) Regression smoke: every app route renders (200) for an authed admin.
  console.log("  — route regression smoke —");
  {
    // "/" intentionally redirects to /login (the portal opens at the login screen).
    const root = await fetch(`${BASE}/`, { redirect: "manual" });
    const rootLoc = root.headers.get("location") || "";
    check("GET / → redirect to /login (by design)", [302, 303, 307].includes(root.status) && rootLoc.includes("/login"), `HTTP ${root.status}`);

    const ROUTES = ["/dashboard", "/papers", "/papers/ISME-01", "/volumes", "/users", "/activity", "/archive", "/import", "/submit", "/submissions"];
    for (const route of ROUTES) {
      const r = await fetch(`${BASE}${route}`, { headers: { Cookie: jar.header() }, redirect: "manual" });
      check(`GET ${route} → 200`, r.status === 200, `HTTP ${r.status}`);
    }
  }
  // 8) Multiple tabs: a second browser context sharing the same cookies stays logged in.
  {
    const tab2 = jar.clone();
    const r = await fetch(`${BASE}/dashboard`, { headers: { Cookie: tab2.header() }, redirect: "manual" });
    check("second tab (shared cookies) stays authenticated", r.status === 200, `HTTP ${r.status}`);
  }
  // 9) Logout clears session.
  {
    const r = await fetch(`${BASE}/api/logout`, { method: "POST", headers: { Cookie: jar.header() } });
    jar.store(r);
    check("POST /api/logout → 200", r.status === 200, `HTTP ${r.status}`);
  }
  // 10) After logout: protected route redirects; /login shows (no redirect).
  {
    const r = await fetch(`${BASE}/dashboard`, { headers: { Cookie: jar.header() }, redirect: "manual" });
    const loc = r.headers.get("location") || "";
    check("after logout GET /dashboard → /login", [302, 303, 307].includes(r.status) && loc.includes("/login"), `HTTP ${r.status}`);
  }
  {
    const r = await fetch(`${BASE}/login`, { headers: { Cookie: jar.header() }, redirect: "manual" });
    check("after logout GET /login → 200 (shows form, no redirect loop)", r.status === 200, `HTTP ${r.status}`);
  }

  console.log("");
}

main().finally(async () => {
  for (const id of cleanup) { try { await admin.auth.admin.deleteUser(id); } catch {} }
  console.log(`Cleanup: removed ${cleanup.length} throwaway user(s).`);
  console.log(`${failures === 0 ? "✓ PASS — HTTP auth + navigation flow verified." : `✗ ${failures} check(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
});
