"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Spinner from "@/components/ui/Spinner";
import AchievementForm from "@/components/achievements/AchievementForm";

export default function NewAchievementPage() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");
  const [initialType, setInitialType] = useState("");
  const [done, setDone] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    // ?type=GRANT pre-selects a type (handy for links from emails or notices).
    setInitialType(new URLSearchParams(window.location.search).get("type") || "");
    (async () => {
      try {
        const res = await fetch("/api/achievements", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load your profile.");
        setMe(data.me);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  if (done) {
    return (
      <>
        <PageHeader eyebrow="Faculty achievements" title="Achievement submitted" />
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok"><Icon name="check" size={26} /></span>
          <h2 className="text-lg font-bold text-ink">Thank you, it&apos;s saved</h2>
          <p className="max-w-md text-sm text-muted">It shows as <b>Awaiting check</b> until the administrator verifies your proof.</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button href="/achievements" variant="outline">View my achievements</Button>
            <Button onClick={() => { setDone(false); setInitialType(""); setFormKey((k) => k + 1); }}>Add another</Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Faculty achievements"
        title="Add an achievement"
        subtitle="Choose the kind of achievement, fill in the details and attach the proof. Fields marked * are required."
      />
      {error ? (
        <Card className="px-5 py-10 text-center text-sm text-danger">{error}</Card>
      ) : !me ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted"><Spinner /> Loading…</div>
      ) : (
        <AchievementForm key={`${formKey}-${initialType}`} me={me} initialType={initialType} onDone={() => setDone(true)} />
      )}
    </>
  );
}
