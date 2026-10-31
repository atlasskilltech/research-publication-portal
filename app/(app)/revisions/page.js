"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import { RevisionStatusBadge, TYPE_LABEL } from "@/components/revisions/RevisionStatusBadge";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

// Author revision dashboard: latest revision request for each of the caller's
// own submissions (server-filtered by ownership).
export default function RevisionsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/revisions", { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Could not load your revisions.");
        setItems(d.revisions || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const actionNeeded = items.filter((r) => r.editable).length;

  return (
    <>
      <PageHeader eyebrow="Revisions" title="My revisions"
        subtitle={loading ? "Loading…" : actionNeeded ? `${actionNeeded} revision${actionNeeded === 1 ? "" : "s"} need your attention` : "Revision requests on your submissions"} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
      ) : error ? (
        <Card className="px-6 py-10 text-center text-sm text-danger">{error}</Card>
      ) : items.length === 0 ? (
        <Card className="px-6 py-12"><EmptyState icon="submissions" title="No revision requests" message="When an editor asks for changes to one of your papers, it will appear here." /></Card>
      ) : (
        <div className="space-y-4">
          {items.map((r) => (
            <Card key={r.paperId} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-lg font-bold text-ink">{r.paperTitle}</h2>
                  <p className="text-xs text-muted">Paper ID {String(r.paperId).slice(0, 8)}</p>
                </div>
                <RevisionStatusBadge status={r.displayStatus} />
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted">Revision</dt><dd className="font-semibold text-ink">#{r.round}</dd></div>
                <div><dt className="text-xs text-muted">Type</dt><dd className="font-semibold text-ink">{TYPE_LABEL[r.type]}</dd></div>
                <div><dt className="text-xs text-muted">Requested</dt><dd className="font-semibold text-ink">{fmtDate(r.requestedAt)}</dd></div>
                <div><dt className="text-xs text-muted">Deadline</dt><dd className={`font-semibold ${r.displayStatus === "REVISION_OVERDUE" ? "text-danger" : "text-ink"}`}>{fmtDate(r.dueAt)}</dd></div>
              </dl>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted">Instructions and reviewer comments ({r.reviews.length})</summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{r.instructions}</p>
                <ul className="mt-2 space-y-2">
                  {r.reviews.map((rv) => (
                    <li key={rv.key} className="rounded bg-soft px-3 py-2 text-sm">
                      <Badge className="bg-soft-2 text-ink border-line">{rv.label}</Badge>
                      <p className="mt-1 whitespace-pre-wrap text-ink">{rv.commentsToAuthor || "No comments."}</p>
                    </li>
                  ))}
                </ul>
              </details>

              <div className="mt-4">
                <Button href={`/submissions/${r.paperId}/revision`} variant={r.editable ? "primary" : "outline"} size="sm">
                  {r.editable ? (r.status === "REVISION_REQUESTED" ? "Start revision" : "Continue revision") : "View revision"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
