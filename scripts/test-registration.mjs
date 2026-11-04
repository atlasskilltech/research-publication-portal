/**
 * LEGACY setup links (emailed before the Google-first change) still work end to
 * end through the running app (MySQL). Registration itself no longer issues a
 * link; this suite issues the INVITE token directly, as older emails carried:
 *   register (no password) → [legacy] email link → GET /auth/confirm (consumes nothing)
 *   → "Continue" (server action) → 30-min SETUP session → /create-password
 *   → /api/set-password → every session revoked → login with the new password.
 *
 * SMTP is normally disabled in the test server, so the emailed token is never
 * seen; the test issues a fresh INVITE token for the same account (exactly what
 * "Resend setup email" does — it also invalidates the earlier link).
 * Throwaway accounts only; never touches the real ones.
 *
 * Run: node scripts/test-registration.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import { makeHarness } from "./lib/test-db.mjs";
import { sha256Hex } from "../lib/auth/crypto.mjs";

const h = makeHarness(process.argv[2]);
const { check } = h;
const isRedirect = (r) => [302, 303, 307, 308].includes(r.status);

async function onboard(label, body) {
  console.log(`\n${label}:`);
  const br = h.browser();
  const reg = await br.api("/api/register", { method: "POST", json: body });
  check("register → 201 (no password collected)", reg.status === 201, `${reg.status} ${reg.data?.error || ""}`);
  const u = await h.track(body.email);
  check("account exists, UNVERIFIED, no password, not admin", !!u && !u.email_confirmed_at && !u.has_password && u.is_admin === false);
  if (!u) return null;
  check("login refused before the link is used (401)", (await br.login(body.email, "Anything#12345")) === 401);

  const raw = await h.token(u.id, "INVITE");
  const page = await br.req(`/auth/confirm?token_hash=${raw}&type=invite&flow=setup`);
  const html = await page.text();
  const tokRow = await h.db.one(`SELECT consumed_at FROM \`${h.T.authTokens}\` WHERE token_hash = ?`, [sha256Hex(raw)]);
  check("GET /auth/confirm shows Continue and consumes nothing (scanner-safe)", page.status === 200 && /\$ACTION_ID_/.test(html) && !!tokRow && tokRow.consumed_at === null);
  const c = await h.confirmLink(br, raw, "invite", "setup");
  check("Continue → redirect to /create-password", isRedirect({ status: c.status }) && /\/create-password$/.test(c.location), `${c.status} → ${c.location}`);
  check("email now verified", !!(await h.db.one(`SELECT emailVerified FROM \`${h.T.users}\` WHERE id = ?`, [u.id])).emailVerified);
  check("SETUP session cookie set", br.jar.has("rpp_sid"));
  const setupSession = await h.db.one(`SELECT purpose, TIMESTAMPDIFF(MINUTE, createdAt, expiresAt) AS mins FROM \`${h.T.sessions}\` WHERE userId = ? AND revokedAt IS NULL ORDER BY createdAt DESC LIMIT 1`, [u.id]);
  check("session is purpose SETUP with a 30-minute lifetime", setupSession?.purpose === "SETUP" && Number(setupSession.mins) === 30, JSON.stringify(setupSession));
  { const r = await br.req("/create-password"); check("/create-password renders for the SETUP session", r.status === 200 && /Create your password/.test(await r.text())); }
  { const r = await br.api("/api/dashboard"); check("SETUP session grants NO app access (/api/dashboard 401)", r.status === 401, `HTTP ${r.status}`); }
  { const r = await br.req("/reset-password"); check("SETUP session can't open /reset-password (flow-bound)", isRedirect(r), `HTTP ${r.status}`); }

  const replay = h.browser();
  const again = await h.confirmLink(replay, raw, "invite", "setup");
  check("same link used again → expired (single use)", /status=expired/.test(again.location || ""), again.location);

  { const r = await br.api("/api/set-password", { method: "POST", json: { password: "Onboard#Pass2026", confirm: "Onboard#Pass2026x" } }); check("mismatch → 422", r.status === 422); }
  { const r = await br.api("/api/set-password", { method: "POST", json: { password: "short", confirm: "short" } }); check("too short → 422", r.status === 422); }
  { const r = await br.api("/api/set-password", { method: "POST", json: { password: "Onboard#Pass2026", confirm: "Onboard#Pass2026", userId: h.manifest.users[0] } });
    check("password set → 200 (flow setup)", r.status === 200 && r.data?.flow === "setup", `HTTP ${r.status}`); }
  const row = await h.db.one(`SELECT passwordHash FROM \`${h.T.users}\` WHERE id = ?`, [u.id]);
  check("stored as Argon2id", /^\$argon2id\$/.test(row.passwordHash || ""));
  check("all sessions revoked after setting the password", Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.sessions}\` WHERE userId = ? AND revokedAt IS NULL`, [u.id])).n) === 0);
  { const r = await br.api("/api/set-password", { method: "POST", json: { password: "Second#Pass2026", confirm: "Second#Pass2026" } }); check("setup session can't be reused to change it again (401)", r.status === 401); }
  const fresh = h.browser();
  check("login with the new password → 200", (await fresh.login(body.email, "Onboard#Pass2026")) === 200);
  { const r = await fresh.api("/api/dashboard"); check("app session works after login", r.status === 200, `HTTP ${r.status}`); }
  return u;
}

async function main() {
  console.log(`\n=== Passwordless onboarding (app ${h.BASE}) ===`);
  const appNo = `IT${h.tag().toUpperCase()}`;
  // Faculty never call the external student API; students do (needs a valid number),
  // so the student path uses an application number set directly on the account.
  await onboard("Faculty onboarding", { name: "Reg Test Faculty", email: h.email("fac"), baseType: "FACULTY" });

  console.log("\nStudent account invariants (MySQL):");
  const st = await h.mkUser({ kind: "stu", baseType: "STUDENT", applicationNo: appNo, verified: false, withPassword: false });
  const prof = await h.db.one(`SELECT applicationNo, isAdmin, baseType FROM \`${h.T.users}\` WHERE id = ?`, [st.id]);
  check("student carries applicationNo, never admin", prof.applicationNo === appNo && prof.isAdmin === false && prof.baseType === "STUDENT");
  let dup = "OK";
  try { await h.mkUser({ kind: "stu2", baseType: "STUDENT", applicationNo: appNo.toLowerCase() }); } catch (e) { dup = e.code; }
  check("applicationNo unique (case-insensitive) → ER_DUP_ENTRY", dup === "ER_DUP_ENTRY", dup);

  console.log("\nInvalid / expired links:");
  const br = h.browser();
  const junk = await h.confirmLink(br, "f".repeat(64), "invite", "setup");
  check("unknown token → invalid/expired, no session", /status=(invalid|expired)/.test(junk.location || "") && !br.jar.has("rpp_sid"), junk.location);
  const old = await h.mkUser({ kind: "exp", verified: false, withPassword: false });
  const t = await h.token(old.id, "INVITE");
  await h.db.exec(`UPDATE \`${h.T.authTokens}\` SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE user_id = ?`, [old.id]);
  const ex = await h.confirmLink(h.browser(), t, "invite", "setup");
  check("expired token (24 h invite) → expired", /status=expired/.test(ex.location || ""), ex.location);
  const mal = await br.req(`/auth/confirm?token_hash=<script>&type=invite`);
  check("malformed token → error page, no form", mal.status === 200 && !/\$ACTION_ID_/.test(await mal.text()));
  { const r = await br.req("/create-password"); check("/create-password without a setup session → /auth/confirm?status=setup_required", [302, 303, 307].includes(r.status) && /setup_required/.test(r.headers.get("location") || "")); }
}
main().catch(h.fail).finally(() => h.finish("passwordless onboarding"));
