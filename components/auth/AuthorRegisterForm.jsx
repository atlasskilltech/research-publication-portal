"use client";

import { useState } from "react";
import Link from "next/link";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { GOOGLE_NOTICES } from "@/lib/authNotices";
import { AUTHOR_STATUSES, CONFERENCE_NAME, validateAuthorRegistration } from "@/lib/authorRegistration";

const STATUS_OPTIONS = [{ value: "", label: "Select your current status…" }, ...AUTHOR_STATUSES];
const Req = ({ children }) => <>{children} <span className="text-accent">*</span></>;

// Notices that leave a usable pending registration in this browser: offer
// "Continue with Google" again instead of the form.
const RETRY_WITH_GOOGLE = new Set(["author_email_mismatch", "google_external_unverified", "google_failed", "google_unavailable"]);

/**
 * External AUTHOR registration (AIDC 2026), step 1 of 2: the details form.
 * Step 2 is "Continue with Google" — the account is activated only when the
 * verified Google email matches the email entered here (server-enforced).
 * Validation runs here for instant feedback AND again on the server.
 */
export default function AuthorRegisterForm({ notice = "" }) {
  const [issues, setIssues] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const noticeText = Object.hasOwn(GOOGLE_NOTICES, notice) ? GOOGLE_NOTICES[notice] : "";
  const [showRetry, setShowRetry] = useState(RETRY_WITH_GOOGLE.has(notice));

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setIssues({});
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(["name", "email", "phone", "organization", "currentStatus", "designation", "location"].map((k) => [k, fd.get(k) || ""]));
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
        body: JSON.stringify(v.data),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not register.");
        if (data.issues && typeof data.issues === "object") setIssues(data.issues);
        setLoading(false);
        return;
      }
      setPendingEmail(data.email || v.data.email);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  // ---- Step 2: continue with Google --------------------------------------------
  if (pendingEmail) {
    return (
      <div className="mt-5">
        <div className="rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ink" role="status">
          Your details are saved. To activate your Author account, continue with Google using <b className="break-all">{pendingEmail}</b>.
        </div>
        <div className="mt-5">
          <GoogleSignInButton intent="author" prominent label="Continue with Google"
            hint={`Choose the Google account for ${pendingEmail}. Any verified Google account works (Gmail, university or company).`} />
        </div>
        <p className="mt-4 text-xs text-muted">
          The Google account email must exactly match the email you entered. This step must be completed within 30 minutes. No password is needed.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      {noticeText && (
        <div role="status" className="mb-4 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-ink">{noticeText}</div>
      )}

      {showRetry && (
        <div className="mb-6 rounded-xl border border-line bg-white p-4">
          <GoogleSignInButton intent="author" prominent label="Continue with Google"
            hint="Use the same email address you entered on the Author form." />
          <button type="button" onClick={() => setShowRetry(false)} className="mt-3 w-full text-center text-xs font-semibold text-accent hover:underline">
            Or fill in the Author form again
          </button>
        </div>
      )}

      {!showRetry && (
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input label="Full name" name="name" placeholder="e.g. Priya Menon" autoComplete="name" required error={issues.name} />
          <Input label="Email address" name="email" type="email" placeholder="you@example.com" autoComplete="email" required error={issues.email}
            hint="Use the email of the Google account you will sign in with (Gmail, university or company Google account)." />
          <Input label="Phone number" name="phone" type="tel" placeholder="e.g. +91 98765 43210" autoComplete="tel" required error={issues.phone}
            hint="Include the country code if you are outside India." />
          <Input label="Organization / Institution name" name="organization" placeholder="e.g. National Institute of Design" autoComplete="organization" required error={issues.organization} />
          <Select label={<Req>Current status</Req>} name="currentStatus" options={STATUS_OPTIONS} defaultValue="" error={issues.currentStatus} />
          <Input label="Designation / Job role / Course / Area of study" name="designation" placeholder="e.g. Assistant Professor, UX Designer, M.Des Interaction Design" required error={issues.designation} />
          <Input label="Organization / Institution location" name="location" placeholder="City, Country (e.g. Ahmedabad, India)" required error={issues.location}
            hint="Where you work or study." />

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{error}</p>
          )}

          <p className="text-xs text-muted">
            Next, you&apos;ll continue with Google to verify your email. Your Author account lets you submit papers for {CONFERENCE_NAME} and follow their review.
          </p>

          <Button type="submit" variant="primary" size="lg" full disabled={loading}>
            {loading ? "Saving…" : "Continue to Google sign-in →"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm text-muted">
        Already registered as an Author?{" "}
        <Link href="/login" className="font-semibold text-accent hover:underline">Sign in →</Link>
      </p>
    </div>
  );
}
