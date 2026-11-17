"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import ProofNotice from "@/components/achievements/ProofNotice";

/**
 * Dashboard copy of the "upload your proof" warning. Renders nothing for
 * accounts without achievements access (e.g. external authors) or when every
 * entry already has its proof uploaded.
 */
export default function DashboardProofNotice() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/achievements", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const n = (data.achievements || []).filter((a) => a.canUpload && a.links.length > 0 && a.files.length === 0).length;
        if (alive) setCount(n);
      } catch { /* the notice is optional */ }
    })();
    return () => { alive = false; };
  }, []);
  if (!count) return null;
  return (
    <div className="mb-6">
      <ProofNotice count={count} action={<Button href="/achievements" size="sm">Upload proof</Button>} />
    </div>
  );
}
