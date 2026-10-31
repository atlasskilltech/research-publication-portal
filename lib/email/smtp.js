// SMTP adapter (Gmail / Google Workspace App Password) for lib/email/core.js.
// Pure: the nodemailer transport is injected, so the error mapping is unit-
// tested without a network (scripts/test-email-service.mjs).
//
// core.js expects a Resend-shaped client: emails.send(payload, { idempotencyKey })
// → { data: { id } } | { error: { name } }. This maps SMTP outcomes onto the
// same error names, so core's retry / duplicate-suppression rules apply as-is.

/** Map a nodemailer error to a core.js error name (or rethrow-style network error). */
export function smtpErrorName(err) {
  const code = String(err?.code || "");
  const rc = Number(err?.responseCode) || 0;
  if (code === "EAUTH" || rc === 535 || rc === 534) return "invalid_api_key";       // bad user / app password → config
  if (code === "EENVELOPE" || rc === 553 || rc === 501) return "invalid_from_address"; // sender rejected → config
  if (rc === 550 && /quota|limit|rate/i.test(String(err?.response || ""))) return "daily_quota_exceeded";
  if (rc === 421 || rc === 450 || rc === 451 || rc === 452 || (rc >= 400 && rc < 500)) return "rate_limit_exceeded"; // transient
  if (rc >= 500) return "validation_error";                                          // permanent rejection
  return null; // connection/socket/timeout → treated as a network error (one retry)
}

/** Build a core.js-compatible client around a nodemailer transport. */
export function createSmtpClient(transport) {
  return {
    emails: {
      async send(payload, { idempotencyKey } = {}) {
        try {
          const info = await transport.sendMail({
            from: payload.from,
            to: payload.to,
            subject: payload.subject,
            html: payload.html,
            text: payload.text,
            ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
            // Stable per logical email: lets mail clients thread/dedupe retries.
            ...(idempotencyKey ? { headers: { "X-Entity-Ref-ID": idempotencyKey } } : {}),
          });
          const accepted = Array.isArray(info?.accepted) ? info.accepted.length : 1;
          if (!accepted) return { data: null, error: { name: "validation_error" } };
          return { data: { id: info?.messageId || "smtp" }, error: null };
        } catch (e) {
          const name = smtpErrorName(e);
          if (name) return { data: null, error: { name } };
          const net = new Error("SMTP connection failed");
          net.name = "Error";
          throw net; // core classifies as "network" (retryable once)
        }
      },
    },
  };
}
