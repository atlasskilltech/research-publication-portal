/**
 * End-to-end HTTP auth + navigation test against the running app (MySQL).
 *
 * Uses a THROWAWAY admin it creates and deletes — it never touches the real
 * accounts. Verifies: middleware gating, login/logout, SSR session + admin
 * identity, the Back-button fix (/login while authenticated → /dashboard),
 * refresh persistence, multi-tab (shared cookie) behaviour, server-side
 * revocation on logout, and admin access to every app route.
 *
 * Usage: node scripts/test-auth-http.mjs http://localhost:3001
 * Env: DB_* pointing at the SAME database as the running app.
 */
import { makeHarness } from "./lib/test-db.mjs";

const h = makeHarness(process.argv[2] || process.env.BASE_URL);
const { check } = h;
const isRedirect = (r) => [302, 303, 307, 308].includes(r.status);
const loc = (r) => r.headers.get("location") || "";

async function main() {
  console.log(`\n=== HTTP auth + navigation flow against ${h.BASE} ===\n`);
  const admin = await h.mkAdmin({ name: "HTTP Test Admin" });
  const br = h.browser();

  { const r = await br.req("/dashboard"); check("GET /dashboard unauthenticated → /login", isRedirect(r) && loc(r).includes("/login"), `HTTP ${r.status}`); }
  check("POST /api/login wrong password → 401", (await br.login(admin.email, "wrong-" + admin.password)) === 401);
  check("POST /api/login unknown account → same 401", (await br.login("nobody." + admin.email, admin.password)) === 401);
  check("POST /api/login correct → 200", (await br.login(admin.email, admin.password)) === 200);
  check("httpOnly session cookie rpp_sid set", br.jar.has("rpp_sid"));
  const sid = br.jar.get("rpp_sid");

  {
    const r = await br.req("/dashboard");
    const html = await r.text();
    check("GET /dashboard authenticated → 200", r.status === 200, `HTTP ${r.status}`);
    check("profile retrieval: admin name rendered (SSR)", /HTTP Test Admin/.test(html));
    check("admin nav present (link to /users)", /href="\/users"/.test(html));
  }
  { const r = await br.req("/login"); check("GET /login while authenticated → /dashboard (Back-button fix)", isRedirect(r) && loc(r).includes("/dashboard"), `HTTP ${r.status} → ${loc(r)}`); }
  { const r = await br.req("/dashboard"); check("session persists on refresh", r.status === 200); }
  { const r = await br.req("/users"); check("admin can access /users → 200", r.status === 200, `HTTP ${r.status}`); }
  { const r = await br.api("/api/admin/users"); check("admin API /api/admin/users → 200 with users", r.status === 200 && Array.isArray(r.data?.users)); }

  console.log("  — route regression smoke —");
  { const r = await br.req("/"); check("GET / → /login (by design; authed then → /dashboard)", isRedirect(r), `HTTP ${r.status} → ${loc(r)}`); }
  for (const route of ["/dashboard", "/users", "/activity", "/submit", "/submissions", "/reviews", "/revisions", "/editorial", "/publications/manage", "/import"]) {
    const r = await br.req(route);
    check(`GET ${route} → 200`, r.status === 200, `HTTP ${r.status}`);
  }
  // Retired mock routes redirect to their real replacements.
  for (const [route, target] of [["/papers", "/submissions"], ["/volumes", "/publications/manage"], ["/archive", "/publications"]]) {
    const r = await br.req(route);
    // Inside the streamed (app) layout Next delivers redirect() as an in-page
    // redirect (meta refresh / RSC redirect) rather than a 3xx.
    const html = isRedirect(r) ? "" : await r.text();
    const to = isRedirect(r) ? new URL(loc(r), h.BASE).pathname : (html.match(/url=([^"&;]+)/) || [])[1];
    check(`GET ${route} → redirect to ${target}`, to === target, `HTTP ${r.status} → ${to}`);
  }
  for (const route of ["/publications", "/login"]) {
    const anon = await fetch(h.BASE + route, { redirect: "manual" });
    check(`public ${route} renders anonymously`, anon.status === 200, `HTTP ${anon.status}`);
  }

  {
    const tab2 = h.browser(); tab2.set("rpp_sid", sid);
    const r = await tab2.req("/dashboard");
    check("second tab (shared cookie) stays authenticated", r.status === 200);
  }
  {
    const r = await br.req("/api/logout", { method: "POST" });
    check("POST /api/logout → 200 and cookie cleared", r.status === 200 && !br.jar.has("rpp_sid"));
  }
  { const r = await br.req("/dashboard"); check("after logout GET /dashboard → /login", isRedirect(r) && loc(r).includes("/login")); }
  {
    const old = h.browser(); old.set("rpp_sid", sid);
    const r = await old.api("/api/dashboard");
    check("old cookie replayed after logout → 401 (revoked server-side)", r.status === 401, `HTTP ${r.status}`);
    const row = await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.sessions}\` WHERE userId = ? AND revokedAt IS NOT NULL`, [admin.id]);
    check("session row marked revoked in MySQL", Number(row.n) >= 1);
  }
  { const r = await br.req("/login"); check("after logout GET /login → 200 (no redirect loop)", r.status === 200); }
}

main().catch(h.fail).finally(() => h.finish("HTTP auth + navigation"));
