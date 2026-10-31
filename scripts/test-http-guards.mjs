/**
 * Unauthenticated HTTP sweep against a RUNNING app (no login, no writes that can
 * succeed): every protected API must refuse with 401/403 (never 500 or 200),
 * every protected page must redirect to /login, and public pages must render.
 * Mutating methods are sent WITHOUT a session, so they are rejected before any
 * database write. Run: node scripts/test-http-guards.mjs [baseUrl]
 */
const BASE = process.argv[2] || "http://127.0.0.1:5631";
const Z = "00000000-0000-4000-8000-000000000000";
let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };

const API = [
  ["GET", "/api/papers"], ["POST", "/api/papers"],
  ["GET", `/api/papers/${Z}`], ["POST", `/api/papers/${Z}/assign`], ["DELETE", `/api/papers/${Z}/assign`],
  ["GET", `/api/papers/${Z}/manuscript`], ["GET", `/api/papers/${Z}/review`], ["PUT", `/api/papers/${Z}/review`],
  ["GET", `/api/papers/${Z}/reviews`], ["GET", `/api/papers/${Z}/decisions`], ["POST", `/api/papers/${Z}/decisions`],
  ["POST", `/api/papers/${Z}/decisions/${Z}/release`], ["GET", `/api/papers/${Z}/revisions`], ["POST", `/api/papers/${Z}/revisions`],
  ["PUT", `/api/papers/${Z}/revisions/1`], ["POST", `/api/papers/${Z}/revisions/1/manuscript`], ["POST", `/api/papers/${Z}/revisions/1/rereview`],
  ["GET", "/api/reviews"], ["GET", "/api/revisions"], ["GET", "/api/editorial"], ["GET", "/api/dashboard"], ["GET", "/api/activity"],
  ["GET", "/api/admin/users"], ["PATCH", `/api/admin/users/${Z}`], ["DELETE", `/api/admin/users/${Z}`], ["GET", "/api/admin/reviews"],
  ["GET", "/api/publications/manage"], ["POST", "/api/publications"], ["PATCH", `/api/publications/${Z}`],
  ["POST", `/api/publications/${Z}/publish`], ["POST", "/api/publications/volumes"], ["PATCH", `/api/publications/volumes/${Z}`],
  ["POST", "/api/publications/issues"], ["PATCH", `/api/publications/issues/${Z}`],
];
const PAGES = ["/dashboard", "/submissions", "/submit", "/reviews", "/revisions", "/editorial", "/publications/manage", "/activity", "/users", `/submissions/${Z}`];
const PUBLIC = ["/", "/login", "/register", "/auth/forgot-password", "/auth/resend", "/publications"];

console.log(`\nProtected APIs without a session (${BASE}):`);
for (const [m, p] of API) {
  const r = await fetch(BASE + p, { method: m, redirect: "manual", headers: { "content-type": "application/json", origin: BASE }, body: ["GET", "DELETE"].includes(m) ? undefined : "{}" });
  check(`${m} ${p}`, r.status === 401 || r.status === 403, `status ${r.status}`);
}
console.log("\nProtected pages redirect to /login:");
for (const p of PAGES) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  const loc = r.headers.get("location") || "";
  check(p, [302, 303, 307, 308].includes(r.status) && loc.includes("/login"), `status ${r.status} → ${loc}`);
}
console.log("\nPublic pages render (no 5xx):");
for (const p of PUBLIC) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  check(p, r.status < 500, `status ${r.status}`);
}
console.log("\nInvalid inputs are rejected safely:");
const bad = await fetch(`${BASE}/api/public/publications/not-a-uuid`);
check("public record with a malformed id → 4xx (not 500)", bad.status >= 400 && bad.status < 500, `status ${bad.status}`);
const dl = await fetch(`${BASE}/api/public/publications/${Z}/manuscript`);
check("public download of an unknown record → 4xx", dl.status >= 400 && dl.status < 500, `status ${dl.status}`);

console.log(failures ? `\n✗ FAIL — ${failures} check(s) failed.\n` : "\n✓ PASS — every protected route refuses anonymous access; public pages render.\n");
process.exit(failures ? 1 : 0);
