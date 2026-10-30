"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

export default function CreatePasswordForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") || "");
    const confirm = String(fd.get("confirm") || "");

    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not set your password.");
        setLoading(false);
        return;
      }
      // Session is already active — go straight in.
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
      <Input
        label="New password"
        name="password"
        type="password"
        placeholder="at least 10 characters"
        autoComplete="new-password"
        required
      />
      <Input
        label="Confirm password"
        name="confirm"
        type="password"
        placeholder="re-enter your password"
        autoComplete="new-password"
        required
        error={error || undefined}
      />
      <Button type="submit" variant="primary" size="lg" full disabled={loading}>
        {loading ? "Saving…" : "Save password & continue →"}
      </Button>
    </form>
  );
}
