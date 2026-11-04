/**
 * LIVE account flows through the app's own endpoints (running server, MySQL):
 * registration, duplicate registration, unverified login refused, resend,
 * forgot password (neutral, no enumeration), reset via a RECOVERY link
 * (confirm → RESET session → /reset-password → new password), session
 * revocation on reset, old password refused / new accepted, reused + invalid
 * tokens rejected, login + reset rate limiting.
 *
 * Throwaway rpp.it.* accounts only (deleted at the end). With SMTP disabled the
 * emails are not delivered; the test issues the equivalent token itself.
 *
 * Run: node scripts/test-auth-live-app.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import { makeHarness } from "./lib/test-db.mjs";

const h = makeHarness(process.argv[2]);
const { check } = h;

async function main() {
  console.log(`\n=== Live account flows (app ${h.BASE}) ===\n`);
  const br = h.browser();
  const post = (p, json, b = br) => b.api(p, { method: "POST", json });

  console.log("Registration:");
  const regEmail = h.email("faculty");
  const reg = await post("/api/register", { name: "IT Faculty", email: regEmail, baseType: "FACULTY" });
  check("register faculty → 201", reg.status === 201, `${reg.status} ${reg.data?.error || ""}`);
  check("SMTP down → account kept, emailSent=false + resend instruction", reg.data?.emailSent === false && /Resend setup email/.test(reg.data?.message || ""));
  const ru = await h.track(regEmail);
  check("FACULTY, never admin, unverified", ru?.base_type === "FACULTY" && ru?.is_admin === false && !ru?.email_confirmed_at);
  const dup = await post("/api/register", { name: "IT Faculty", email: regEmail, baseType: "FACULTY" });
  check("duplicate registration → 409, no second account", dup.status === 409 && Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.users}\` WHERE email = ?`, [regEmail])).n) === 1);
  check("non-university email rejected (422)", (await post("/api/register", { name: "X Y", email: `it.${h.tag()}@gmail.com`, baseType: "FACULTY" })).status === 422);
  check("unverified account cannot log in (401)", (await br.login(regEmail, "Whatever#123456")) === 401);
  const before = await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.authTokens}\` WHERE user_id = ?`, [ru.id]);
  const rs = await post("/api/auth/resend", { email: regEmail });
  const after = await h.db.one(`SELECT COUNT(*) AS n, SUM(consumed_at IS NULL) AS live FROM \`${h.T.authTokens}\` WHERE user_id = ?`, [ru.id]);
  check("resend → 200 neutral; a fresh INVITE replaces the old one (1 live)", rs.status === 200 && Number(after.n) === Number(before.n) + 1 && Number(after.live) === 1);
  const rsUnknown = await post("/api/auth/resend", { email: h.email("ghost") });
  check("resend for unknown email → identical response", rsUnknown.status === rs.status && rsUnknown.data?.message === rs.data?.message);

  console.log("\nForgot / reset password:");
  const member = await h.mkUser({ kind: "member" });
  check("member logs in with password", (await br.login(member.email, member.password)) === 200);
  const other = h.browser();
  check("member also signed in on a second device", (await other.login(member.email, member.password)) === 200);
  const fp = await post("/api/auth/forgot-password", { email: member.email }, h.browser());
  check("forgot password → 200 + a RECOVERY token issued", fp.status === 200 && !!(await h.db.one(`SELECT 1 AS x FROM \`${h.T.authTokens}\` WHERE user_id = ? AND purpose = 'RECOVERY'`, [member.id])));
  const fpUnknown = await post("/api/auth/forgot-password", { email: h.email("nobody") }, h.browser());
  check("unknown email gets the SAME response (no account probing)", fpUnknown.status === fp.status && fpUnknown.data?.message === fp.data?.message);

  const raw = await h.token(member.id, "RECOVERY");
  const rb = h.browser();
  const c = await h.confirmLink(rb, raw, "recovery", "reset");
  check("recovery link → /reset-password", /\/reset-password$/.test(c.location || ""), `${c.status} → ${c.location}`);
  { const r = await rb.req("/reset-password"); check("/reset-password renders for the RESET session", r.status === 200); }
  { const r = await rb.req("/create-password"); check("RESET session can't open /create-password", [302, 303, 307].includes(r.status)); }
  const newPw = "Reset#NewPass2026";
  { const r = await rb.api("/api/set-password", { method: "POST", json: { password: newPw, confirm: newPw } }); check("new password saved → 200 (flow reset)", r.status === 200 && r.data?.flow === "reset", `HTTP ${r.status}`); }
  { const r = await other.api("/api/dashboard"); check("password reset signs out OTHER devices (401)", r.status === 401, `HTTP ${r.status}`); }
  { const r = await br.api("/api/dashboard"); check("…and this device too", r.status === 401); }
  const reuse = await h.confirmLink(h.browser(), raw, "recovery", "reset");
  check("reused reset link rejected", /status=expired/.test(reuse.location || ""), reuse.location);
  const inviteAsRecovery = await h.confirmLink(h.browser(), await h.token(member.id, "INVITE"), "recovery", "reset");
  check("invite token can't be used as a recovery link", /status=(invalid|expired)/.test(inviteAsRecovery.location || ""));
  check("old password refused (401)", (await h.browser().login(member.email, member.password)) === 401);
  check("new password accepted (200)", (await h.browser().login(member.email, newPw)) === 200);

  console.log("\nRate limiting:");
  const fixed = h.browser({ ip: `10.250.${Math.floor(Math.random() * 250)}.9` });
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await post("/api/auth/forgot-password", { email: h.email("rl") }, fixed)).status === 429;
  check("repeated reset requests are rate-limited (429)", limited);
  let loginLimited = false;
  const lb = h.browser();
  for (let i = 0; i < 12 && !loginLimited; i++) loginLimited = (await lb.login(member.email, "Wrong#Password1")) === 429;
  check("repeated failed logins for one account are rate-limited (429)", loginLimited);
}
main().catch(h.fail).finally(() => h.finish("live account flows"));
