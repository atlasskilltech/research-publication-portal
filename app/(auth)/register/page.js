"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { AtlasCube } from "@/components/layout/BrandLogo";

const SCHOOLS = [
  { value: "", label: "Select…" },
  { value: "ISDI", label: "ISDI · School of Design & Innovation" },
  { value: "ISME", label: "ISME · BBA" },
  { value: "uGDX", label: "uGDX · B.Tech" },
  { value: "LAW", label: "LAW · LLB" },
];

// Live Application-Number verification states.
const CHECK = {
  idle: null,
  checking: { text: "Checking Application Number…", cls: "text-muted" },
  verified: { text: "Application Number verified ✓", cls: "text-ok" },
  notfound: { text: "Application Number not found.", cls: "text-danger" },
  unavailable: { text: "Verification temporarily unavailable. Please try again.", cls: "text-warn" },
};

export default function RegisterPage() {
  const [type, setType] = useState("student");
  const [error, setError] = useState("");
  const [issues, setIssues] = useState({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [emailFailed, setEmailFailed] = useState(false);

  // Controlled Application Number + its live-verification status.
  const [appNo, setAppNo] = useState("");
  const [checkStatus, setCheckStatus] = useState("idle");
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const seqRef = useRef(0); // ignore responses from stale requests

  const isStudent = type === "student";

  // Debounced, cancellable live check whenever the student's Application Number
  // changes. Stale in-flight requests are aborted and their responses ignored.
  useEffect(() => {
    if (!isStudent) return;
    const value = appNo.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!value) { setCheckStatus("idle"); return; }
    setCheckStatus("checking");

    const mySeq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/student-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationNo: value }),
          signal: controller.signal,
        });
        if (mySeq !== seqRef.current) return; // a newer input superseded this one
        if (res.ok) setCheckStatus("verified");
        else if (res.status === 422) setCheckStatus("notfound");
        else setCheckStatus("unavailable");
      } catch (e) {
        if (e?.name === "AbortError") return; // superseded — ignore
        if (mySeq === seqRef.current) setCheckStatus("unavailable");
      }
    }, 500);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [appNo, isStudent]);

  function switchType(t) {
    setType(t);
    setError("");
    setIssues({});
    // Reset verification when leaving/entering the student flow.
    if (abortRef.current) abortRef.current.abort();
    seqRef.current++;
    setCheckStatus("idle");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setIssues({});
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name"),
      email: fd.get("email"),
      baseType: isStudent ? "STUDENT" : "FACULTY",
      school: fd.get("school") || null,
      applicationNo: isStudent ? appNo : null,
    };

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not create the account.");
        if (data.issues && typeof data.issues === "object") setIssues(data.issues);
        setLoading(false);
        return;
      }
      setEmailFailed(data.emailSent === false);
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  const check = CHECK[checkStatus];
  // Students may only submit once the API has actually confirmed the number.
  const submitDisabled = loading || (isStudent && checkStatus !== "verified");

  return (
    <div className="flex min-h-screen flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand p-1">
            <AtlasCube size={28} />
          </span>
          <span className="text-sm font-bold text-ink">Portal 2025–26</span>
        </div>

        {done ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Check your inbox</p>
            <h1 className="mt-1 font-display text-3xl font-bold text-ink">Registration successful</h1>
            {emailFailed ? (
              <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-ink" role="status">
                Your account was created, but we couldn&apos;t send the setup email just now. Please{" "}
                <Link href="/auth/resend" className="font-semibold text-accent hover:underline">resend the setup email</Link> in a few minutes. Don&apos;t register again.
              </div>
            ) : (
            <div className="mt-4 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ink">
              Please check your email to verify your account and create your password. Open the &ldquo;Create Your Password&rdquo; link, press Continue, and choose your password &mdash; then sign in with your email and new password.
            </div>
            )}
            <p className="mt-4 text-sm text-muted">
              Didn&apos;t get it? Check spam, or{" "}
              <Link href="/auth/resend" className="font-semibold text-accent hover:underline">resend the setup email</Link>.
            </p>
            <p className="mt-6 text-sm text-muted">
              <Link href="/login" className="font-semibold text-accent hover:underline">← Back to sign in</Link>
            </p>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Create account</p>
            <h1 className="mt-1 font-display text-3xl font-bold text-ink">Submit your paper</h1>
            <p className="mt-1 text-sm text-muted">Create an account to upload your research paper for the 2025–26 publication cycle.</p>

            <div className="mt-6">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">I am a</p>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line">
                {["student", "faculty"].map((t) => (
                  <button key={t} type="button" onClick={() => switchType(t)}
                    className={cn("px-4 py-2.5 text-sm font-semibold capitalize transition-colors",
                      type === t ? "bg-brand text-white" : "bg-white text-ink hover:bg-soft")}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
              <Input label="Full name" name="name" placeholder="Anushi Shah" required error={issues.name} />
              <Input label="University email" name="email" type="email" placeholder="you@atlasuniversity.edu.in" required error={issues.email} />
              <Select label="School" name="school" options={SCHOOLS} error={issues.school} />

              {isStudent && (
                <div>
                  <Input
                    label="Application number"
                    name="applicationNo"
                    placeholder="e.g. 2629885"
                    required
                    autoComplete="off"
                    value={appNo}
                    onChange={(e) => setAppNo(e.target.value)}
                    error={issues.applicationNo}
                  />
                  {check && !issues.applicationNo && (
                    <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs font-medium", check.cls)}>
                      {checkStatus === "checking" && <Spinner />}
                      {check.text}
                    </p>
                  )}
                </div>
              )}

              {error && !issues.applicationNo && !issues.email && !issues.name && (
                <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
              )}

              <p className="text-xs text-muted">
                No password needed now — you&apos;ll set one after verifying your email. Every account starts as a Submitter; an administrator assigns reviewer, SPOC and editor roles per paper.
              </p>

              <Button type="submit" variant="primary" size="lg" full disabled={submitDisabled}>
                {loading ? "Creating account…" : isStudent && checkStatus !== "verified" ? "Verify application number to continue" : "Create account →"}
              </Button>
            </form>

            <p className="mt-6 text-sm text-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-accent hover:underline">Sign in →</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
