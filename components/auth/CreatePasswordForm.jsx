"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { validatePasswordPair, passwordStrength, PASSWORD_MIN } from "@/lib/passwordPolicy";

const BAR = ["bg-danger", "bg-danger", "bg-warn", "bg-teal", "bg-ok"];

function PasswordField({ id, label, value, onChange, show, onToggle, error, describedBy, autoComplete }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</label>
      <div className="relative">
        <input id={id} name={id} type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} required
          aria-invalid={error ? "true" : undefined} aria-describedby={describedBy}
          className={`w-full rounded-lg border bg-white px-3.5 py-2.5 pr-16 text-sm text-ink transition-colors focus:border-brand-light ${error ? "border-danger" : "border-line"}`} />
        <button type="button" onClick={onToggle} aria-controls={id} aria-pressed={show}
          className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-accent hover:underline">
          {show ? "Hide" : "Show"}
        </button>
      </div>
      {error && <p id={`${id}-err`} className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

export default function CreatePasswordForm({ mode = "setup" }) {
  const reset = mode === "reset";
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState({ p: false, c: false });
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const strength = passwordStrength(password);
  const check = validatePasswordPair(password, confirm);
  const fieldError = touched && !check.ok ? check : null;

  async function onSubmit(e) {
    e.preventDefault();
    setTouched(true);
    setError("");
    if (!check.ok) return;
    setLoading(true);
    try {
      const res = await fetch("/api/set-password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, confirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "setup_required") { router.replace(`/auth/confirm?status=${reset ? "reset_required" : "setup_required"}`); return; }
        setError(data.error || "Could not set your password.");
        setLoading(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.replace(`/login?notice=${reset ? "password_reset" : "password_created"}`), 1800);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-lg border border-ok/30 bg-ok-soft px-4 py-4 text-sm text-ok" role="status">
        <p className="font-semibold">{reset ? "Password updated." : "Password created — your account is ready."}</p>
        <p className="mt-1">Taking you to sign in with your email and new password…</p>
      </div>
    );
  }

  return (
    <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit} noValidate>
      <div>
        <PasswordField id="password" label="New password" value={password} autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)} show={show.p} onToggle={() => setShow((s) => ({ ...s, p: !s.p }))}
          error={fieldError?.field === "password" ? fieldError.error : ""} describedBy="pw-strength" />
        <div id="pw-strength" className="mt-2" aria-live="polite">
          <div className="flex gap-1" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${password && i < Math.max(strength.score, 1) ? BAR[strength.score] : "bg-soft-2"}`} />)}
          </div>
          <p className="mt-1 text-xs text-muted">
            {password ? <>Strength: <b className="text-ink">{strength.label}</b></> : `Use at least ${PASSWORD_MIN} characters.`}
            {password && strength.hints.length > 0 && <> · {strength.hints[0]}</>}
          </p>
        </div>
      </div>
      <PasswordField id="confirm" label="Confirm password" value={confirm} autoComplete="new-password"
        onChange={(e) => setConfirm(e.target.value)} show={show.c} onToggle={() => setShow((s) => ({ ...s, c: !s.c }))}
        error={fieldError?.field === "confirm" ? fieldError.error : ""} />
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" variant="primary" size="lg" full disabled={loading}>
        {loading ? "Saving…" : reset ? "Update password" : "Create password"}
      </Button>
      <p className="text-xs text-muted">Never share your password. ATLAS staff will never ask for it.</p>
    </form>
  );
}
