"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

const PURPOSES = {
  setup: { endpoint: "/api/auth/resend", title: "Email me sign-in instructions", button: "Send instructions", placeholder: "name@atlasuniversity.edu.in" },
  reset: { endpoint: "/api/auth/forgot-password", title: "Reset your password", button: "Send reset link", placeholder: "name@atlasuniversity.edu.in" },
  "author-verify": { endpoint: "/api/register/author/resend", title: "Resend verification email", button: "Resend verification email", placeholder: "you@example.com" },
};

/**
 * "Email me sign-in instructions" (purpose "setup"), "Forgot password"
 * (purpose "reset") or the external Author's "Resend verification email"
 * (purpose "author-verify"). The server always answers with the same neutral
 * message, whether or not the address has an account.
 */
export default function ResendSetupForm({ compact = false, purpose = "setup", defaultEmail = "" }) {
  const cfg = PURPOSES[purpose] || PURPOSES.setup;
  const endpoint = cfg.endpoint;
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { kind, text }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok ? { kind: "ok", text: d.message } : { kind: "error", text: d.error || "Please try again." });
    } catch {
      setMsg({ kind: "error", text: "Something went wrong. Please try again." });
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={onSubmit} className={compact ? "mt-4 space-y-3" : "mt-6 space-y-3 border-t border-line pt-5"} noValidate>
      {!compact && <p className="text-sm font-semibold text-ink">{cfg.title}</p>}
      <Input label="Your registered email" name="email" type="email" autoComplete="email" required
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder={cfg.placeholder} />
      <Button type="submit" variant="primary" full disabled={busy || !email}>{busy ? "Sending…" : cfg.button}</Button>
      {msg && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>{msg.text}</p>
      )}
    </form>
  );
}
