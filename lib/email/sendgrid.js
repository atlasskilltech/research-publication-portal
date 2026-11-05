// SendGrid adapter for lib/email/core.js. Pure: the SendGrid MailService
// (official @sendgrid/mail SDK) is injected, so the payload shape and the error
// mapping are unit-tested without a network (scripts/test-email-service.mjs).
//
// core.js expects a Resend-shaped client: emails.send(payload, { idempotencyKey })
// → { data: { id } } | { error: { name } }. SendGrid outcomes are mapped onto the
// same error names, so core's validation, retry, duplicate-suppression and
// secret-free logging apply unchanged.

/** "Name <addr>" | "addr" → { email, name? } (core has already validated and sanitised it). */
export function parseFrom(from) {
  const m = /^(.*)<([^<>\s]+)>\s*$/.exec(String(from || ""));
  if (!m) return { email: String(from || "").trim() };
  const name = m[1].trim();
  return name ? { email: m[2], name } : { email: m[2] };
}

/** Map a SendGrid SDK error (ResponseError: code = HTTP status) to a core.js error name, or null for a network failure. */
export function sendgridErrorName(err) {
  const status = typeof err?.code === "number" ? err.code : Number.NaN;
  if (!Number.isFinite(status)) return null; // socket / DNS / timeout → network (one retry)
  const text = JSON.stringify(err?.response?.body?.errors || []).toLowerCase();
  if (status === 401) return "invalid_api_key";
  if (status === 403) return /sender identity|from address|from_email|verified/.test(text) ? "invalid_from_address" : "invalid_access";
  if (status === 429) return "rate_limit_exceeded";
  if (status >= 500) return "internal_server_error";
  return "validation_error"; // 400 / 413 / other 4xx: permanent
}

/**
 * Build a core.js-compatible client around a configured SendGrid MailService
 * (setApiKey already called). Click/open tracking is OFF so password-reset links
 * are never rewritten through a tracking redirect.
 */
export function createSendgridClient(mailService) {
  return {
    emails: {
      async send(payload, { idempotencyKey } = {}) {
        const purpose = (payload.tags || []).find((t) => t?.name === "purpose")?.value;
        try {
          const [res] = await mailService.send({
            from: parseFrom(payload.from),
            to: payload.to,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
            ...(purpose ? { categories: [purpose] } : {}),
            ...(idempotencyKey ? { headers: { "X-Entity-Ref-ID": idempotencyKey }, customArgs: { ref: idempotencyKey } } : {}),
            trackingSettings: { clickTracking: { enable: false, enableText: false }, openTracking: { enable: false } },
          });
          const status = Number(res?.statusCode) || 0;
          if (status < 200 || status >= 300) return { data: null, error: { name: "application_error" } };
          const headers = res?.headers || {};
          const id = headers["x-message-id"] || headers["X-Message-Id"] || "sendgrid";
          return { data: { id: String(id) }, error: null };
        } catch (e) {
          const name = sendgridErrorName(e);
          if (name) return { data: null, error: { name } };
          const net = new Error("SendGrid connection failed");
          net.name = "Error";
          throw net; // core classifies as "network" (retryable once); no request details leak
        }
      },
    },
  };
}
