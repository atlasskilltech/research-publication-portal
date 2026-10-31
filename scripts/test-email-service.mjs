/**
 * Email service tests with a MOCKED Resend client (no network, no real key):
 * lib/email/core.js (delivery, retry, idempotency, dedupe, config, log hygiene),
 * lib/email/templates.js (branding, escaping, plain text) and lib/authMailer.js
 * (registration + recovery email flows with a mocked Supabase generateLink).
 * Real delivery is NOT tested here — it needs a real RESEND_API_KEY and a
 * verified sender. Run: node scripts/test-email-service.mjs
 */
import { readFileSync } from "node:fs";
import { createEmailSender, resolveSender, classifyEmailError, idempotencyKey, maskEmail } from "../lib/email/core.js";
import { escapeHtml, inviteEmail, setupEmail, resetEmail, passwordChangedEmail, editorialNotificationEmail, renderLayout } from "../lib/email/templates.js";
import { deliverInvite, deliverRecovery, deliverPasswordChanged, readGeneratedLink } from "../lib/authMailer.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const FAKE_KEY = "re_FAKE_test_key_1234567890";
const CONFIG = { apiKey: FAKE_KEY, from: "portal@example.edu", fromName: "Research Publication Portal", replyTo: "help@example.edu" };
const TOKEN = "ab".repeat(28);
const LINK = `https://research.atlasskilltech.app/auth/confirm?token_hash=${TOKEN}&type=invite&flow=setup`;
const MSG = { to: "student@atlasuniversity.edu.in", subject: "S", html: `<p>${LINK}</p>`, text: LINK, purpose: "invite" };

/** Mock Resend client: scripted responses; records every call. */
function mockClient(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    emails: {
      send: async (payload, opts) => {
        calls.push({ payload, opts });
        const r = responses[Math.min(i++, responses.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}
function captureLogger() {
  const lines = [];
  return { lines, info: (m, meta) => lines.push(`${m} ${JSON.stringify(meta)}`), error: (m, meta) => lines.push(`${m} ${JSON.stringify(meta)}`) };
}
const noSleep = () => { const waits = []; return Object.assign(async (ms) => { waits.push(ms); }, { waits }); };
const ok = (id = "re_1") => ({ data: { id }, error: null });
const err = (name, statusCode = 422) => ({ data: null, error: { name, message: `${name} happened`, statusCode } });

console.log("\n=== Email service (mocked Resend) tests ===\n");

console.log("Configuration:");
check("valid config → 'Name <addr>' sender + reply-to", resolveSender(CONFIG).from === "Research Publication Portal <portal@example.edu>" && resolveSender(CONFIG).replyTo === "help@example.edu");
check("missing API key → config error", resolveSender({ ...CONFIG, apiKey: "" }).ok === false && /RESEND_API_KEY/.test(resolveSender({ ...CONFIG, apiKey: "" }).error));
check("missing sender → config error", /EMAIL_FROM/.test(resolveSender({ ...CONFIG, from: "" }).error));
check("sender with display name in EMAIL_FROM rejected (use EMAIL_FROM_NAME)", !resolveSender({ ...CONFIG, from: "Portal <portal@example.edu>" }).ok);
check("invalid reply-to rejected", !resolveSender({ ...CONFIG, replyTo: "not-an-email" }).ok);
check("header injection stripped from display name", !/[\r\n<>"]/.test(resolveSender({ ...CONFIG, fromName: 'Evil"\r\nBcc: x<y>' }).from.split(" <")[0]));
check("config error message never contains the key", !JSON.stringify(resolveSender({ ...CONFIG, from: "" })).includes(FAKE_KEY));

console.log("\nDelivery:");
{
  const client = mockClient([ok("re_success")]);
  const log = captureLogger();
  const send = createEmailSender({ client, config: CONFIG, logger: log, sleep: noSleep() });
  const r = await send(MSG);
  check("successful send → { ok, id }", r.ok && r.id === "re_success");
  const call = client.calls[0];
  check("payload: from, to[], subject, html, text, replyTo, purpose tag", call.payload.from.includes("portal@example.edu") && call.payload.to[0] === MSG.to && call.payload.text === LINK && call.payload.replyTo === "help@example.edu" && call.payload.tags[0].value === "invite");
  check("idempotency key always sent", typeof call.opts.idempotencyKey === "string" && call.opts.idempotencyKey.length > 10);
}
{
  const client = mockClient([err("validation_error", 422)]);
  const sleep = noSleep();
  const r = await createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep })(MSG);
  check("provider rejection (validation_error) → ok:false 'rejected', NOT retried", !r.ok && r.code === "rejected" && client.calls.length === 1 && sleep.waits.length === 0);
}
{
  const client = mockClient([new TypeError("fetch failed"), new TypeError("fetch failed")]);
  const r = await createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("network failure → one retry, then ok:false 'network'", !r.ok && r.code === "network" && client.calls.length === 2);
}
{
  const client = mockClient([err("internal_server_error", 500), ok("re_retry")]);
  const r = await createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("transient 5xx then success → delivered on retry", r.ok && r.id === "re_retry" && client.calls.length === 2);
  check("retry reuses the SAME idempotency key (provider can't send twice)", client.calls[0].opts.idempotencyKey === client.calls[1].opts.idempotencyKey);
}
{
  const client = mockClient([err("rate_limit_exceeded", 429), err("rate_limit_exceeded", 429)]);
  const sleep = noSleep();
  const r = await createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep })(MSG);
  check("rate limited → backs off once (1.5s), then reports 'rate_limited'", !r.ok && r.code === "rate_limited" && sleep.waits.join() === "1500" && client.calls.length === 2);
}
{
  const client = mockClient([err("daily_quota_exceeded", 429)]);
  const r = await createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("plan quota exceeded → 'quota', no retry (limits respected)", !r.ok && r.code === "quota" && client.calls.length === 1);
}
{
  const client = mockClient([err("invalid_api_key", 403)]);
  const r = await createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("invalid API key → 'config', no retry", !r.ok && r.code === "config" && client.calls.length === 1);
}
{
  const client = mockClient([ok()]);
  const r = await createEmailSender({ client, config: { ...CONFIG, apiKey: "" }, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("missing API key → 'config' and the provider is never called", !r.ok && r.code === "config" && client.calls.length === 0);
  const r2 = await createEmailSender({ client, config: { ...CONFIG, from: "" }, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("missing sender → 'config', provider not called", !r2.ok && r2.code === "config" && client.calls.length === 0);
  const r3 = await createEmailSender({ client: null, config: CONFIG, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("no client (SDK not initialised) → 'config'", !r3.ok && r3.code === "config");
}
{
  const client = mockClient([ok()]);
  const send = createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep: noSleep() });
  check("invalid recipient rejected before sending", (await send({ ...MSG, to: "nope" })).code === "rejected" && client.calls.length === 0);
  check("missing text alternative rejected", (await send({ ...MSG, text: "" })).code === "rejected");
}

console.log("\nDuplicate-send protection:");
{
  let t = 0;
  const client = mockClient([ok("re_a"), ok("re_b")]);
  const send = createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep: noSleep(), now: () => t, dedupeMs: 600_000 });
  const key = idempotencyKey("invite", "user-1", TOKEN);
  const a = await send({ ...MSG, key });
  const b = await send({ ...MSG, key });
  check("same logical email twice → provider called once, second deduplicated", a.ok && b.ok && b.deduplicated === true && client.calls.length === 1);
  const c = await send({ ...MSG, key: idempotencyKey("invite", "user-1", "cd".repeat(28)) });
  check("new token → new key → genuinely re-sent (legitimate resend)", c.ok && client.calls.length === 2);
  t += 600_001;
  await send({ ...MSG, key });
  check("dedupe window expires (provider idempotency still applies)", client.calls.length === 3);
  check("idempotency key is stable and opaque", idempotencyKey("invite", "u", TOKEN) === idempotencyKey("invite", "u", TOKEN) && !idempotencyKey("invite", "u", TOKEN).includes(TOKEN));
}
{
  const client = mockClient([err("validation_error")]);
  const send = createEmailSender({ client, config: CONFIG, logger: captureLogger(), sleep: noSleep() });
  await send({ ...MSG, key: "k1" });
  client.emails.send = async (p, o) => { client.calls.push({ p, o }); return ok("re_after_fail"); };
  const again = await send({ ...MSG, key: "k1" });
  check("a FAILED send is not remembered as delivered (retry allowed)", again.ok && again.id === "re_after_fail");
}

console.log("\nNo secrets or tokens in logs:");
{
  const log = captureLogger();
  const client = mockClient([err("internal_server_error", 500), err("internal_server_error", 500)]);
  await createEmailSender({ client, config: CONFIG, logger: log, sleep: noSleep() })(MSG);
  const success = captureLogger();
  await createEmailSender({ client: mockClient([ok()]), config: CONFIG, logger: success, sleep: noSleep() })(MSG);
  await createEmailSender({ client: mockClient([ok()]), config: { ...CONFIG, apiKey: "" }, logger: success, sleep: noSleep() })(MSG);
  const all = log.lines.join("\n") + success.lines.join("\n");
  check("logs contain no API key", !all.includes(FAKE_KEY));
  check("logs contain no token, link or email body", !all.includes(TOKEN) && !all.includes("token_hash") && !all.includes("<p>"));
  check("logs contain no full recipient address (masked)", !all.includes("student@atlasuniversity.edu.in") && all.includes("s***@atlasuniversity.edu.in"));
  check("failure log has useful diagnostics (purpose, code, provider name)", /delivery failed.*"purpose":"invite".*"code":"provider_unavailable".*"provider":"internal_server_error"/.test(log.lines.join("\n")));
  check("maskEmail", maskEmail("jane.doe@x.edu") === "j***@x.edu" && maskEmail("bad") === "***");
  check("classifier: TypeError → network (retryable)", classifyEmailError(new TypeError("fetch failed")).code === "network");
}

console.log("\nSMTP adapter:");
{
  const { createSmtpClient, smtpErrorName } = await import("../lib/email/smtp.js");
  const sent = [];
  const okT = { sendMail: async (m) => { sent.push(m); return { messageId: "<m1@x>", accepted: [m.to[0]] }; } };
  const r = await createSmtpClient(okT).emails.send({ from: "P <p@x.edu>", to: ["a@x.edu"], subject: "s", html: "<p>h</p>", text: "t", replyTo: "r@x.edu" }, { idempotencyKey: "k1" });
  check("SMTP success → { data: { id } }", r.data?.id === "<m1@x>" && !r.error);
  check("SMTP passes from/to/subject/html/text/replyTo + ref header", sent[0].from === "P <p@x.edu>" && sent[0].replyTo === "r@x.edu" && sent[0].headers["X-Entity-Ref-ID"] === "k1" && !!sent[0].html && !!sent[0].text);
  const failT = (e) => ({ sendMail: async () => { throw e; } });
  const authErr = await createSmtpClient(failT(Object.assign(new Error("x"), { code: "EAUTH", responseCode: 535 }))).emails.send({ to: ["a@x.edu"] });
  check("bad app password → config error (not retried)", classifyEmailError(authErr.error).code === "config");
  check("transient 421 → retryable", classifyEmailError({ name: smtpErrorName({ responseCode: 421 }) }).retryable === true);
  check("permanent 550 → rejected", classifyEmailError({ name: smtpErrorName({ responseCode: 550, response: "no such user" }) }).code === "rejected");
  let thrown = null;
  try { await createSmtpClient(failT(Object.assign(new Error("connect ECONNREFUSED"), { code: "ESOCKET" }))).emails.send({ to: ["a@x.edu"] }); } catch (e) { thrown = e; }
  check("connection failure → network error (retryable), no details leaked", !!thrown && classifyEmailError(thrown).code === "network" && !/ECONNREFUSED/.test(thrown.message));
  const calls = [];
  const flaky = { sendMail: async () => { calls.push(1); if (calls.length === 1) throw Object.assign(new Error("x"), { responseCode: 421 }); return { messageId: "<ok>", accepted: ["a@x.edu"] }; } };
  const res = await createEmailSender({ client: createSmtpClient(flaky), config: CONFIG, logger: captureLogger(), sleep: noSleep() })(MSG);
  check("core retries a transient SMTP failure once, then succeeds", res.ok && calls.length === 2);
  check("SMTP config error names EMAIL_APP_PASSWORD", /EMAIL_APP_PASSWORD/.test(resolveSender({ ...CONFIG, apiKey: "", credentialName: "EMAIL_APP_PASSWORD" }).error));
}

console.log("\nServer-only boundaries:");
{
  const resendJs = read("../lib/email/send.js");
  check("lib/email/send.js is server-only", /^import "server-only";/.test(resendJs));
  check("SMTP credentials read from server env only", /process.env.EMAIL_APP_PASSWORD/.test(read("../lib/config/env.js")) && !/NEXT_PUBLIC_EMAIL/.test(read("../lib/config/env.js")));
  const env = read("../lib/config/env.js");
  check("RESEND_API_KEY read from server env only (never NEXT_PUBLIC_)", /process\.env\.RESEND_API_KEY/.test(env) && !/NEXT_PUBLIC_RESEND|NEXT_PUBLIC_EMAIL/.test(env + read("../.env.example")));
  const clientFiles = ["../components/auth/CreatePasswordForm.jsx", "../components/auth/ResendSetupForm.jsx", "../components/auth/FragmentScrubber.jsx", "../components/auth/ConfirmSubmit.jsx"];
  check("no client component imports the email service", clientFiles.every((f) => !/lib\/email|resend/i.test(read(f).replace(/\/api\/auth\/resend|ResendSetup|Resend setup/g, ""))));
  check(".env.example documents RESEND_API_KEY / EMAIL_FROM / EMAIL_FROM_NAME / EMAIL_REPLY_TO with no values", /^RESEND_API_KEY=\s*$/m.test(read("../.env.example")) && /^EMAIL_FROM=\s*$/m.test(read("../.env.example")) && /^EMAIL_FROM_NAME=Research Publication Portal\s*$/m.test(read("../.env.example")) && /^EMAIL_REPLY_TO=\s*$/m.test(read("../.env.example")));
  check("no hard-coded Resend key or sender address in lib/", !/re_[A-Za-z0-9]{20,}/.test(read("../lib/email/core.js") + resendJs + read("../lib/authMailer.js")) && !/@atlasskilltech\.app|@atlasuniversity\.edu\.in/.test(resendJs + read("../lib/email/core.js")));
}

console.log("\nTemplates:");
{
  const site = "https://research.atlasskilltech.app";
  const all = [inviteEmail({ siteUrl: site, link: LINK }), setupEmail({ siteUrl: site, link: LINK }), resetEmail({ siteUrl: site, link: LINK }), passwordChangedEmail({ siteUrl: site, loginUrl: `${site}/login` })];
  check("every template has subject, HTML and plain text", all.every((m) => m.subject && m.html.startsWith("<!doctype html>") && m.text.length > 50));
  check("branding: ATLAS SkillTech University + Research Publication Portal + brand colour", all.every((m) => /ATLAS SkillTech University/.test(m.html) && /Research Publication Portal/.test(m.html) && /#2e2a6b/.test(m.html)));
  check("uses the existing logo asset (/apple-icon.png)", all.every((m) => m.html.includes(`${site}/apple-icon.png`)));
  check("table-based, inline-styled, responsive container", all.every((m) => /role="presentation"/.test(m.html) && /max-width:600px/.test(m.html) && !/<style/.test(m.html)));
  check("link templates include CTA + fallback link + security notice", all.slice(0, 3).every((m) => (m.html.match(/token_hash=/g) || []).length >= 3 && /can be used once before it expires/.test(m.html) && /(Didn&#39;t|Wasn&#39;t)/.test(m.html)));
  check("plain text carries the full link", all.slice(0, 3).every((m) => m.text.includes(LINK)));
  check("invite subject as specified", all[0].subject === "Complete Your Research Portal Registration" && /Welcome to the Research Publication Portal/.test(all[0].html));
  check("password-changed email contains no token or action link", !/token_hash|auth\/confirm/.test(all[3].html + all[3].text) && /Sign In/.test(all[3].html));
  check("first-time variant says the account is ready", /account is ready/i.test(passwordChangedEmail({ siteUrl: site, loginUrl: `${site}/login`, firstTime: true }).html));
  const evil = renderLayout({ siteUrl: site, preheader: "<x>", heading: "<script>alert(1)</script>", paragraphs: ['"><img src=x onerror=alert(1)>'], cta: { label: "Go", url: 'https://ok.example/"onmouseover="x' } });
  check("all interpolations HTML-escaped (no tag/attribute injection)", !/<script>|<img src=x|"onmouseover="/.test(evil.html));
  check("escapeHtml", escapeHtml(`<a href="x">'&`) === "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  const ed = editorialNotificationEmail({ siteUrl: site, subject: "Decision available", heading: "A decision is available", paragraphs: ["Sign in to view it."], cta: { label: "Open portal", url: `${site}/login` } });
  check("editorial notification structure ready (reusable layout)", ed.subject === "Decision available" && /A decision is available/.test(ed.html) && ed.text.includes(`${site}/login`));
  check("no Supabase {{ .ConfirmationURL }} anywhere in app templates", !/ConfirmationURL/.test(read("../lib/email/templates.js")));
}

console.log("\nRegistration email flow (mock Supabase generateLink + mock Resend):");
{
  const sent = [];
  const genCalls = [];
  const deps = (over = {}) => ({
    generateLink: async (a) => { genCalls.push(a); return { data: { user: { id: "user-123" }, properties: { hashed_token: TOKEN, verification_type: a.type } }, error: null }; },
    sendEmail: async (m) => { sent.push(m); return { ok: true, id: "re_x" }; },
    redirectBase: "https://research.atlasskilltech.app/auth/confirm",
    siteUrl: "https://research.atlasskilltech.app",
    ...over,
  });
  const r = await deliverInvite({ email: "new@atlasuniversity.edu.in", data: { name: "N", base_type: "STUDENT" } }, deps());
  check("Supabase asked for an INVITE link with metadata + redirect", genCalls[0].type === "invite" && genCalls[0].options.data.base_type === "STUDENT" && genCalls[0].options.redirectTo.endsWith("/auth/confirm"));
  check("one email, to the registrant, with our /auth/confirm link", r.ok && r.emailSent && sent.length === 1 && sent[0].to === "new@atlasuniversity.edu.in" && sent[0].html.includes(`/auth/confirm?token_hash=${TOKEN}&amp;type=invite&amp;flow=setup`));
  check("Supabase's own action_link (implicit flow) is NOT used", !sent[0].html.includes("/auth/v1/verify"));
  check("idempotency key bound to user + token", sent[0].key === idempotencyKey("invite", "user-123", TOKEN));

  const failSend = await deliverInvite({ email: "x@atlasuniversity.edu.in" }, deps({ sendEmail: async () => ({ ok: false, code: "provider_unavailable" }) }));
  check("delivery fails after account creation → ok:true, emailSent:false (recoverable via resend)", failSend.ok && failSend.emailSent === false && failSend.emailCode === "provider_unavailable");
  const before = sent.length;
  const linkErr = await deliverInvite({ email: "dup@atlasuniversity.edu.in" }, deps({ generateLink: async () => ({ data: null, error: { status: 422, code: "email_exists" } }) }));
  check("Supabase refuses (existing account) → no email sent", !linkErr.ok && linkErr.stage === "link" && sent.length === before);
  check("malformed generateLink result → no email", readGeneratedLink({ data: { user: { id: "u" }, properties: {} } }, "invite") === null);
  const reg = read("../app/api/register/route.js");
  check("register route surfaces emailSent:false with a resend instruction", /emailSent: false/.test(reg) && /Resend setup email/.test(reg));
}

console.log("\nPassword recovery email flow:");
{
  const sent = [];
  const deps = {
    generateLink: async (a) => (a.type === "recovery" && a.email === "known@atlasuniversity.edu.in"
      ? { data: { user: { id: "u-9" }, properties: { hashed_token: TOKEN, verification_type: "recovery" } }, error: null }
      : { data: null, error: { status: 404, code: "user_not_found" } }),
    sendEmail: async (m) => { sent.push(m); return { ok: true, id: "re_r" }; },
    redirectBase: "https://research.atlasskilltech.app/auth/confirm",
    siteUrl: "https://research.atlasskilltech.app",
  };
  const reset = await deliverRecovery({ email: "known@atlasuniversity.edu.in", flow: "reset" }, deps);
  check("forgot password → RESET email with type=recovery&flow=reset", reset.ok && sent[0].subject === "Reset Your Research Portal Password" && sent[0].html.includes("type=recovery&amp;flow=reset"));
  const setup = await deliverRecovery({ email: "known@atlasuniversity.edu.in", flow: "setup" }, deps);
  check("verified-without-password → SETUP email with flow=setup (different template)", setup.ok && sent[1].subject === "Create Your Research Portal Password" && sent[1].html.includes("type=recovery&amp;flow=setup"));
  check("recovery and invite never share an idempotency key", sent[0].key !== sent[1].key && sent[0].key !== idempotencyKey("invite", "u-9", TOKEN));
  const none = await deliverRecovery({ email: "ghost@atlasuniversity.edu.in", flow: "reset" }, deps);
  check("unknown account → no email (caller still answers neutrally)", !none.ok && sent.length === 2);
  const pc = await deliverPasswordChanged({ email: "known@atlasuniversity.edu.in", firstTime: false, userId: "u-9", at: 0 }, deps);
  check("password-changed confirmation sent, links only to /login", pc.ok && sent[2].purpose === "password_changed" && sent[2].html.includes("https://research.atlasskilltech.app/login") && !sent[2].html.includes("token_hash"));
}

console.log(`\n${failures === 0 ? "✓ PASS — email service is sound (mocked SMTP + Resend)." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
