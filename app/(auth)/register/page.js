"use client";

import { useState } from "react";
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

export default function RegisterPage() {
  const [type, setType] = useState("student");
  const [error, setError] = useState("");
  const [issues, setIssues] = useState({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setIssues({});
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const isStudent = type === "student";
    const payload = {
      name: fd.get("name"),
      email: fd.get("email"),
      baseType: isStudent ? "STUDENT" : "FACULTY",
      school: fd.get("school") || null,
      applicationNo: isStudent ? fd.get("applicationNo") : null,
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
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

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
            <div className="mt-4 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ink">
              Please check your email to verify your account and create your password. The link opens the portal and takes you to set a password.
            </div>
            <p className="mt-4 text-sm text-muted">
              Didn&apos;t get it? Check spam, or{" "}
              <button type="button" onClick={() => setDone(false)} className="font-semibold text-accent hover:underline">
                try again
              </button>
              .
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

            {/* I am a: Student / Faculty */}
            <div className="mt-6">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">I am a</p>
              <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line">
                {["student", "faculty"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setType(t); setError(""); setIssues({}); }}
                    className={cn(
                      "px-4 py-2.5 text-sm font-semibold capitalize transition-colors",
                      type === t ? "bg-brand text-white" : "bg-white text-ink hover:bg-soft",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <form className="mt-5 flex flex-col gap-4" onSubmit={onSubmit}>
              <Input label="Full name" name="name" placeholder="Anushi Shah" required error={issues.name} />
              <Input
                label="University email"
                name="email"
                type="email"
                placeholder="you@atlasuniversity.edu.in"
                required
                error={issues.email}
              />
              <Select label="School" name="school" options={SCHOOLS} error={issues.school} />
              {type === "student" && (
                <Input
                  label="Application number"
                  name="applicationNo"
                  placeholder="e.g. 2629885"
                  required
                  error={issues.applicationNo}
                  hint="We verify this with the university before creating your account."
                />
              )}

              {error && !issues.applicationNo && !issues.email && !issues.name && (
                <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>
              )}

              <p className="text-xs text-muted">
                No password needed now — you&apos;ll set one after verifying your email. Every account starts as a Submitter; an administrator assigns reviewer, SPOC and editor roles per paper.
              </p>

              <Button type="submit" variant="primary" size="lg" full disabled={loading}>
                {loading ? "Creating account…" : "Create account →"}
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
