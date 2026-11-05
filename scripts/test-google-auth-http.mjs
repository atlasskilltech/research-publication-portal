/**
 * Google Sign-In (direct OpenID Connect) — HTTP checks against a RUNNING app.
 *
 * Verifies the login UI, the start request (Authorization Code + PKCE S256,
 * state, nonce, no hd hint, redirect_uri, httpOnly state cookie, hashed single-use
 * state row in MySQL) and every callback rejection path: missing / mismatched
 * state cookie, unknown state, REPLAYED state, expired state, provider error;
 * plus forged session cookies against pages and APIs. A successful Google
 * login needs a real Google account + client and is covered offline by
 * scripts/test-google-auth.mjs (real RS256 verification).
 *
 *   node scripts/test-google-auth-http.mjs http://localhost:3001
 * Env: DB_* = the app's DB; optional SERVER_LOG=<path to the server's stdout>
 * to assert the exact refusal reason the callback logged.
 */
import { readFileSync, existsSync } from "node:fs";
import { makeHarness } from "./lib/test-db.mjs";
import { sha256Hex } from "../lib/auth/crypto.mjs";

const h = makeHarness(process.argv[2]);
const { check, db, T } = h;
const loc = (r) => r.headers.get("location") || "";
const stateRow = (s) => db.one(`SELECT state_hash, nonce, code_verifier, next_path, expires_at FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [sha256Hex(s)]);
const logLines = () => (process.env.SERVER_LOG && existsSync(process.env.SERVER_LOG) ? readFileSync(process.env.SERVER_LOG, "utf8").split(/\r?\n/) : null);

async function start(br, next = "/submissions") {
  const fd = new URLSearchParams({ next });
  const r = await br.req("/auth/google", { method: "POST", body: fd, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const u = r.status === 303 ? new URL(loc(r)) : null;
  return { r, u, state: u?.searchParams.get("state") };
}
async function callback(br, qs) {
  const r = await br.req(`/auth/callback?${new URLSearchParams(qs)}`);
  return { status: r.status, to: loc(r), cleared: (r.headers.getSetCookie?.() || []).some((c) => /^rpp_oauth_state=;/.test(c) || /^rpp_oauth_state=[^;]*;.*Max-Age=0/i.test(c)) };
}

async function main() {
  console.log(`\n=== Google Sign-In (direct OIDC) against ${h.BASE} ===\n`);

  console.log("Login page UI:");
  {
    const r = await h.browser().req("/login");
    const html = await r.text();
    check("GET /login → 200 with 'Sign in with Google'", r.status === 200 && html.includes("Sign in with Google"));
    check("button posts to /auth/google", /<form[^>]*action="\/auth\/google"/.test(html) && /method="post"/i.test(html));
    check("official multicolour G logo", ["#EA4335", "#4285F4", "#FBBC05", "#34A853"].every((c) => html.includes(c)));
    check("email/password form still present", html.includes('name="password"') && html.includes('name="email"'));
    check("no client secret / Supabase in the page", !/test-secret-not-real|client_secret|supabase/i.test(html));
    const n = await (await h.browser().req("/login?notice=google_domain")).text();
    check("domain notice text rendered", n.includes("sign in with your ATLAS University Google account."));
    check("unknown/prototype notice key harmless", (await h.browser().req("/login?notice=__proto__")).status === 200);
  }

  console.log("\nStart: POST /auth/google:");
  const br = h.browser();
  const { r, u, state } = await start(br);
  check("303 → https://accounts.google.com/o/oauth2/v2/auth", r.status === 303 && u?.origin === "https://accounts.google.com" && u.pathname === "/o/oauth2/v2/auth", `${r.status} ${u?.origin}${u?.pathname}`);
  check("response_type=code, scope openid email profile", u?.searchParams.get("response_type") === "code" && /openid/.test(u?.searchParams.get("scope")) && /email/.test(u?.searchParams.get("scope")));
  check("client_id from server config", u?.searchParams.get("client_id") === "test-client.apps.googleusercontent.com");
  check("redirect_uri = GOOGLE_REDIRECT_URI (app route, not Supabase)", u?.searchParams.get("redirect_uri") === "http://localhost:3001/auth/callback");
  check("PKCE code_challenge, method S256", /^[A-Za-z0-9_-]{43}$/.test(u?.searchParams.get("code_challenge") || "") && u?.searchParams.get("code_challenge_method") === "S256");
  check("state + nonce present and distinct", !!state && !!u?.searchParams.get("nonce") && state !== u.searchParams.get("nonce"));
  check("no hd hint (one button for every Google account), prompt=select_account", !u?.searchParams.has("hd") && u?.searchParams.get("prompt") === "select_account");
  check("client secret NOT in the authorize URL", !/test-secret-not-real|client_secret/.test(u?.toString() || ""));
  const setCookie = (r.headers.getSetCookie?.() || []).find((c) => c.startsWith("rpp_oauth_state="));
  check("state cookie: httpOnly, SameSite=Lax, path /auth, 10 min", !!setCookie && /HttpOnly/i.test(setCookie) && /SameSite=lax/i.test(setCookie) && /Path=\/auth/.test(setCookie) && /Max-Age=600/.test(setCookie));
  check("cookie holds the same state as the URL", br.jar.get("rpp_oauth_state") === state);
  const row = await stateRow(state);
  check("state row stored HASHED in MySQL (raw state not stored)", !!row && !(await db.one(`SELECT 1 AS x FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [state])));
  check("row binds nonce + PKCE verifier + safe next path, expires in ~10 min",
    row?.nonce === u?.searchParams.get("nonce") && row?.code_verifier?.length >= 43 && row?.next_path === "/submissions" &&
    Math.abs(Date.parse(row.expires_at) - Date.now() - 600_000) < 60_000);
  { const evil = await start(h.browser(), "//evil.example");
    check("unsafe next path is normalised before storage", (await stateRow(evil.state))?.next_path === "/dashboard");
    await db.exec(`DELETE FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [sha256Hex(evil.state)]); }
  { const g = await h.browser().req("/auth/google");
    check("GET /auth/google never starts OAuth → /login", g.status === 303 && new URL(loc(g), h.BASE).pathname === "/login"); }
  { const x = await h.browser().req("/auth/google", { method: "POST", body: "next=/", headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" } });
    check("cross-site POST /auth/google → 403 (CSRF)", x.status === 403); }

  console.log("\nCallback rejections:");
  const failed = (c) => c.status === 303 && c.to.endsWith("/login?notice=google_failed");
  { const c = await callback(h.browser(), { code: "abc", state });
    check("missing state cookie (login CSRF) → google_failed", failed(c), `${c.status} ${c.to}`);
    check("…and the state row is NOT consumed by it", !!(await stateRow(state))); }
  { const other = h.browser(); other.set("rpp_oauth_state", "someone-elses-state");
    check("state ≠ cookie → google_failed", failed(await callback(other, { code: "abc", state }))); }
  { const f = h.browser(); f.set("rpp_oauth_state", "forged-state-value");
    check("unknown (forged) state → google_failed", failed(await callback(f, { code: "abc", state: "forged-state-value" }))); }
  {
    const before = Math.max(0, (logLines()?.length ?? 1) - 1); // last element is the empty tail after the final newline
    const first = await callback(br, { code: "fake-authorization-code", state });
    check("real state, fake code → google_failed (Google rejects the code)", failed(first), `${first.status} ${first.to}`);
    check("state cookie cleared on the callback", first.cleared);
    check("state row DELETED after one use", !(await stateRow(state)));
    const again = h.browser(); again.set("rpp_oauth_state", state);
    const second = await callback(again, { code: "fake-authorization-code", state });
    check("REPLAY of the same state → google_failed", failed(second));
    const lines = logLines();
    if (lines) {
      await new Promise((res) => setTimeout(res, 300));
      const fresh = (logLines() || []).slice(before).filter((l) => /google-auth: sign-in refused/.test(l));
      check("server log: first attempt failed at the token step, replay at the state step",
        fresh.some((l) => /token_invalid|no_id_token/.test(l)) && fresh.some((l) => /state_unknown_or_expired/.test(l)), fresh.join(" | "));
    } else console.log("  (SERVER_LOG not set — refusal reasons not asserted from the log)");
  }
  {
    const b2 = h.browser();
    const s2 = (await start(b2)).state;
    await db.exec(`UPDATE \`${T.oauthStates}\` SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE state_hash = ?`, [sha256Hex(s2)]);
    check("expired state row → google_failed", failed(await callback(b2, { code: "abc", state: s2 })));
    check("expired row is deleted too", !(await stateRow(s2)));
  }
  {
    const b3 = h.browser();
    const s3 = (await start(b3)).state;
    check("provider error (access_denied) → google_failed", failed(await callback(b3, { error: "access_denied", state: s3 })));
    await db.exec(`DELETE FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [sha256Hex(s3)]);
  }
  { const b4 = h.browser(); b4.set("rpp_oauth_state", "x");
    check("browser-supplied email param is ignored (still rejected)", failed(await callback(b4, { code: "x", state: "x", email: "faizan.shaikh@atlasuniversity.edu.in" }))); }
  check("no session was created by any callback", !br.jar.has("rpp_sid"));

  console.log("\nForged / absent sessions:");
  const forged = h.browser(); forged.set("rpp_sid", "A".repeat(43));
  for (const p of ["/dashboard", "/users", "/submissions"]) {
    const a = await h.browser().req(p);
    check(`${p} anonymous → /login`, a.status === 307 && new URL(loc(a), h.BASE).pathname === "/login", `${a.status}`);
    const f = await forged.req(p);
    check(`${p} with forged rpp_sid → /login`, [302, 303, 307].includes(f.status) && new URL(loc(f), h.BASE).pathname === "/login", `${f.status}`);
  }
  for (const p of ["/api/dashboard", "/api/admin/users", "/api/papers"]) {
    check(`${p} anonymous → 401`, (await h.browser().api(p)).status === 401);
    check(`${p} forged rpp_sid → 401`, (await forged.api(p)).status === 401);
  }
  const leftover = await db.one(`SELECT COUNT(*) AS n FROM \`${T.oauthStates}\` WHERE expires_at > UTC_TIMESTAMP(3)`);
  console.log(`  (live oauth state rows left: ${leftover.n})`);
}
main().catch(h.fail).finally(() => h.finish("Google Sign-In HTTP"));
