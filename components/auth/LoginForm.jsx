"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

/**
 * LoginForm — the real sign-in form. Same markup/look as the original static
 * form; posts credentials to /api/login and, on success, enters the app.
 */
export default function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password") }),
      });
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setLoading(false);
      if (res.status === 401) {
        setError("Invalid email or password.");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Sign-in is temporarily unavailable. Please try again.");
      }
    } catch {
      setLoading(false);
      setError("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
      <Input label="Email" type="email" name="email" placeholder="you@atlasuniversity.edu.in" autoComplete="email" required />
      <Input
        label="Password"
        type="password"
        name="password"
        placeholder="••••••••"
        autoComplete="current-password"
        required
        error={error || undefined}
      />
      <Button type="submit" variant="primary" size="lg" full disabled={loading}>
        {loading ? "Signing in…" : "Sign in →"}
      </Button>
    </form>
  );
}
