// Provider-agnostic email delivery core. Pure: no SDK, env or framework
// imports — the Resend client, config, clock and logger are injected, so the
// delivery rules (config validation, error classification, bounded retry,
// idempotency + duplicate suppression, secret-free logging) are unit-tested
// with mocks (scripts/test-email-service.mjs). lib/email/send.js wires the
// real provider (SMTP, or Resend as fallback) in.
import crypto from "node:crypto";

// Resend error names (SDK RESEND_ERROR_CODE_KEY) that are worth ONE retry.
const RETRYABLE = new Set(["rate_limit_exceeded", "internal_server_error", "application_error", "concurrent_idempotent_requests"]);
// Never retried: config/auth/validation/quota problems won't fix themselves.
const CONFIG = new Set(["missing_api_key", "invalid_api_key", "restricted_api_key", "invalid_from_address", "invalid_access"]);
const QUOTA = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/**
 * Validate sender config. Never returns the key itself.
 * @returns {{ ok:true, from:string, replyTo:string|null } | { ok:false, error:string }}
 */
export function resolveSender({ apiKey, from, fromName, replyTo, credentialName = "RESEND_API_KEY" } = {}) {
  if (!apiKey || !String(apiKey).trim()) return { ok: false, error: `${credentialName} is not set.` };
  const addr = String(from || "").trim();
  if (!addr) return { ok: false, error: "EMAIL_FROM is not set." };
  if (!EMAIL_RE.test(addr)) return { ok: false, error: "EMAIL_FROM must be a plain email address on your Resend-verified domain." };
  const name = String(fromName || "").replace(/["<>\r\n]/g, "").trim();
  const reply = String(replyTo || "").trim();
  if (reply && !EMAIL_RE.test(reply)) return { ok: false, error: "EMAIL_REPLY_TO is not a valid email address." };
  return { ok: true, from: name ? `${name} <${addr}>` : addr, replyTo: reply || null };
}

/** Classify a provider error / thrown exception. */
export function classifyEmailError(err) {
  const name = String(err?.name || "");
  if (CONFIG.has(name)) return { code: "config", retryable: false };
  if (QUOTA.has(name)) return { code: "quota", retryable: false };
  if (RETRYABLE.has(name)) return { code: name === "rate_limit_exceeded" ? "rate_limited" : "provider_unavailable", retryable: true };
  if (typeof err?.statusCode === "number" && err.statusCode >= 500) return { code: "provider_unavailable", retryable: true };
  if (err instanceof Error && !err.name?.includes("_")) return { code: "network", retryable: true }; // fetch/socket failure
  return { code: "rejected", retryable: false }; // validation_error, invalid_parameter, …
}

/** Stable idempotency key: same logical email → same key (safe retries); new token → new key. */
export function idempotencyKey(purpose, ...parts) {
  const digest = crypto.createHash("sha256").update(parts.map(String).join("\u0000")).digest("hex").slice(0, 40);
  return `${String(purpose).replace(/[^a-z0-9_-]/gi, "")}/${digest}`;
}

/** Mask an address for diagnostics: j***@example.edu */
export function maskEmail(email) {
  const [u, d] = String(email || "").split("@");
  return d ? `${(u || "").slice(0, 1)}***@${d}` : "***";
}

/**
 * Build a sender. deps:
 *   client   { emails: { send(payload, { idempotencyKey }) → { data, error } } }
 *   config   { apiKey, from, fromName, replyTo }
 *   logger   { info(msg, meta), error(msg, meta) }   — receives NO secrets/tokens
 *   sleep    ms → Promise (injected for tests)
 *   now      () → ms
 *   dedupeMs window in which an already-delivered idempotency key is not re-sent
 */
export function createEmailSender({ client, config, logger = console, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), dedupeMs = 10 * 60 * 1000 } = {}) {
  const delivered = new Map(); // idempotencyKey → { id, at }

  return async function send({ to, subject, html, text, purpose = "email", key, tags = [] }) {
    const sender = resolveSender(config);
    if (!sender.ok) {
      logger.error("email: not configured", { purpose, reason: sender.error });
      return { ok: false, code: "config", error: sender.error };
    }
    if (!EMAIL_RE.test(String(to || ""))) return { ok: false, code: "rejected", error: "Invalid recipient." };
    if (!subject || !html || !text) return { ok: false, code: "rejected", error: "Email content is incomplete." };
    if (!client?.emails?.send) return { ok: false, code: "config", error: "Email client unavailable." };

    const idem = key || idempotencyKey(purpose, to, subject, html);
    const prev = delivered.get(idem);
    if (prev && now() - prev.at < dedupeMs) {
      logger.info("email: duplicate suppressed", { purpose, to: maskEmail(to) });
      return { ok: true, id: prev.id, deduplicated: true };
    }

    const payload = {
      from: sender.from, to: [to], subject, html, text,
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      tags: [{ name: "purpose", value: String(purpose).replace(/[^a-z0-9_-]/gi, "_") }, ...tags],
    };

    // At most 2 attempts, same idempotency key → the provider can't deliver twice.
    let last;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await client.emails.send(payload, { idempotencyKey: idem });
        if (res?.data?.id && !res.error) {
          delivered.set(idem, { id: res.data.id, at: now() });
          if (delivered.size > 5000) for (const [k, v] of delivered) if (now() - v.at > dedupeMs) delivered.delete(k);
          logger.info("email: sent", { purpose, to: maskEmail(to), id: res.data.id, attempt });
          return { ok: true, id: res.data.id };
        }
        last = classifyEmailError(res?.error || { name: "application_error" });
        last.providerName = res?.error?.name || null;
      } catch (e) {
        last = classifyEmailError(e);
        last.providerName = e?.name || "Error";
      }
      if (!last.retryable || attempt === 2) break;
      await sleep(last.code === "rate_limited" ? 1500 : 500);
    }
    // Diagnostics: purpose, masked recipient, provider error NAME only — never
    // the API key, the email body or the action link.
    logger.error("email: delivery failed", { purpose, to: maskEmail(to), code: last.code, provider: last.providerName });
    return { ok: false, code: last.code, error: "Email delivery failed." };
  };
}
