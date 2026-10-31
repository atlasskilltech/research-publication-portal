"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";

const ROLE_LABEL = { PEER_REVIEWER: "peer reviewer", DESK_REVIEWER: "desk reviewer", SPOC: "SPOC", EDITOR: "editor" };

function relTime(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

// Real activity feed (data from /api/activity, shaped per viewer server-side).
export default function ActivityPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/activity?limit=100", { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Could not load activity.");
        setItems(d.activity || []);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  return (
    <>
      <PageHeader eyebrow="Activity" title="Recent activity" subtitle="What has happened on your submissions, reviews and the papers you manage." />
      {error ? (
        <Card className="px-6 py-10 text-center text-sm text-danger">{error}</Card>
      ) : !items ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
      ) : items.length === 0 ? (
        <Card className="px-6 py-12"><EmptyState icon="activity" title="No activity yet" message="Submissions, reviews, decisions and publications will appear here." /></Card>
      ) : (
        <Card className="divide-y divide-line">
          {items.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  <span className="font-semibold">{a.label}</span>
                  {a.round > 0 && <span className="text-muted"> · revision {a.round}</span>}
                  {a.decision && <span className="text-muted"> · {a.decision}</span>}
                  {a.role && <span className="text-muted"> · {ROLE_LABEL[a.role] || a.role}</span>}
                </p>
                {a.paperTitle && (
                  <Link href={`/submissions/${a.paperId}`} className="block truncate text-xs text-accent hover:underline">{a.paperTitle}</Link>
                )}
              </div>
              <p className="shrink-0 text-right text-xs text-muted">
                {a.actor && <span className="block text-ink">{a.actor}</span>}
                <time dateTime={a.at}>{relTime(a.at)}</time>
              </p>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
