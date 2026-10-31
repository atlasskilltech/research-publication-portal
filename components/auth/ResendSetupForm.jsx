"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

/**
 * "Resend setup email" (purpose "setup") or "Forgot password" (purpose "reset"). The server always answers with the same neutral
 * message, whether or not the address has an account.
 */
export default function ResendSetupForm({ compact = false, purpose = "setup" }) {
  const endpoint = purpose === "reset" ? "/api/auth/forgot-password" : "/api/auth/resend";
  const [email, setEmail] = useState("");
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
      {!compact && <p className="text-sm font-semibold text-ink">{purpose === "reset" ? "Reset your password" : "Resend setup email"}</p>}
      <Input label="Your registered email" name="email" type="email" autoComplete="email" required
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@atlasuniversity.edu.in" />
      <Button type="submit" variant="primary" full disabled={busy || !email}>{busy ? "Sending…" : purpose === "reset" ? "Send reset link" : "Send a new link"}</Button>
      {msg && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>{msg.text}</p>
      )}
    </form>
  );
}
