"use client";

import { useState } from "react";
import Link from "next/link";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { GOOGLE_NOTICES } from "@/lib/authNotices";
import { AUTHOR_STATUSES, CONFERENCE_NAME, validateAuthorRegistration } from "@/lib/authorRegistration";
import { PASSWORD_MIN, passwordStrength } from "@/lib/passwordPolicy";

const STATUS_OPTIONS = [{ value: "", label: "Select your current status…" }, ...AUTHOR_STATUSES];
const Req = ({ children }) => <>{children} <span className="text-accent">*</span></>;
const FIELDS = ["name", "email", "phone", "organization", "currentStatus", "designation", "location", "password", "confirmPassword"];

/**
 * External AUTHOR registration (AIDC 2026): profile fields + password.
 * One step — the server creates the account (Argon2id hash), signs the user in
 * and sends a confirmation email. Authors sign in with email + password; Google
 * Sign-In is not available for them. Validation runs here for instant feedback
 * AND again on the server.
 */
export default function AuthorRegisterForm({ notice = "" }) {
  const [issues, setIssues] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState("");
  const noticeText = Object.hasOwn(GOOGLE_NOTICES, notice) ? GOOGLE_NOTICES[notice] : "";
  const strength = password ? passwordStrength(password) : null;

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setIssues({});
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(FIELDS.map((k) => [k, fd.get(k) || ""]));
    const v = validateAuthorRegistration(body);
    if (!v.ok) {
      setIssues(v.fields);
      setError("Please complete all required fields.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/register/author", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v.data, password: body.password, confirmPassword: body.confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not register.");
        if (data.issues && typeof data.issues === "object") setIssues(data.issues);
        setLoading(false);
        return;
      }
      setDone(true);
      window.location.assign(data.redirect || "/dashboard"); // signed in by the server
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="mt-5 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ink" role="status">
        Your Author account has been created. Taking you to your dashboard…
      </div>
    );
  }

  return (
    <div className="mt-5">
      {noticeText && (
        <div role="status" className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-ink">{noticeText}</div>
      )}

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Input label="Full name" name="name" placeholder="e.g. Priya Menon" autoComplete="name" required error={issues.name} />
        <Input label="Email address" name="email" type="email" placeholder="you@example.com" autoComplete="email" required error={issues.email}
          hint="You will sign in with this email address and your password." />
        <Input label="Phone number" name="phone" type="tel" placeholder="e.g. +91 98765 43210" autoComplete="tel" required error={issues.phone}
          hint="Include the country code if you are outside India." />
        <Input label="Organization / Institution name" name="organization" placeholder="e.g. National Institute of Design" autoComplete="organization" required error={issues.organization} />
        <Select label={<Req>Current status</Req>} name="currentStatus" options={STATUS_OPTIONS} defaultValue="" error={issues.currentStatus} />
        <Input label="Designation / Job role / Course / Area of study" name="designation" placeholder="e.g. Assistant Professor, UX Designer, M.Des Interaction Design" required error={issues.designation} />
        <Input label="Organization / Institution location" name="location" placeholder="City, Country (e.g. Ahmedabad, India)" required error={issues.location}
          hint="Where you work or study." />
        <div>
          <Input label="Password" name="password" type="password" autoComplete="new-password" required error={issues.password}
            value={password} onChange={(e) => setPassword(e.target.value)}
            hint={`At least ${PASSWORD_MIN} characters.`} />
          {strength && !issues.password && (
            <p className="mt-1.5 text-xs text-muted">Strength: <b className="text-ink">{strength.label}</b>{strength.hints[0] ? ` · ${strength.hints[0]}` : ""}</p>
          )}
        </div>
        <Input label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" required error={issues.confirmPassword} />

        {error && (
          <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{error}</p>
        )}

        <p className="text-xs text-muted">
          Your Author account lets you submit papers for {CONFERENCE_NAME} and follow their review. Authors sign in with email and password; Google Sign-In is not available for Author accounts.
        </p>

        <Button type="submit" variant="primary" size="lg" full disabled={loading}>
          {loading ? "Creating account…" : "Create Author account →"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already registered as an Author?{" "}
        <Link href="/login#author-signin" className="font-semibold text-accent hover:underline">Sign in with email and password →</Link>
      </p>
    </div>
  );
}
