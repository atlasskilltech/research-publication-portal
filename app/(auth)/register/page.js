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

  return (
    <div className="flex min-h-screen flex-col justify-center px-6 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand p-1">
            <AtlasCube size={28} />
          </span>
          <span className="text-sm font-bold text-ink">Portal 2025–26</span>
        </div>

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
                onClick={() => setType(t)}
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

        <form className="mt-5 flex flex-col gap-4" action="/dashboard">
          <Input label="Full name" placeholder="Anushi Shah" />
          <Input label="University email" type="email" placeholder="you@university.edu" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="School" options={SCHOOLS} />
            {type === "student" && <Input label="Roll No. (students)" placeholder="e.g. 2022UGD012" />}
          </div>
          <Input label="Password" type="password" placeholder="min 6 characters" hint="Every account starts as a Submitter. An administrator assigns reviewer, SPOC and editor roles per paper." />
          <Button type="submit" variant="primary" size="lg" full>Create account →</Button>
        </form>

        <p className="mt-6 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-accent hover:underline">Sign in →</Link>
        </p>
      </div>
    </div>
  );
}
