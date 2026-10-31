"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Badge from "@/components/ui/Badge";
import { DecisionBadge } from "@/components/decisions/DecisionBadge";
import { RevisionStatusBadge } from "@/components/revisions/RevisionStatusBadge";

const OUTCOME = { ACCEPT: "Accepted", MINOR_REVISION: "Minor revision requested", MAJOR_REVISION: "Major revision requested", REJECT: "Rejected" };

/**
 * Author-facing editorial decisions. The API returns only RELEASED decisions,
 * already stripped of confidential notes and reviewer identities.
 */
export default function AuthorDecisions({ paperId }) {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/papers/${paperId}/decisions`, { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) setFailed(true);
        setItems(res.ok && d.view === "author" ? d.decisions || [] : []);
      } catch { setFailed(true); setItems([]); }
    })();
  }, [paperId]);

  if (failed) return <Card className="p-5"><p className="text-sm text-danger" role="alert">Could not load editorial decisions. Please reload the page.</p></Card>;
  if (!items || items.length === 0) return null;
  const [latest, ...older] = items;

  return (
    <Card className="p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Editorial decision</h2>
      <DecisionView paperId={paperId} d={latest} />
      {older.length > 0 && (
        <details className="mt-4 border-t border-line pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted">Earlier decisions ({older.length})</summary>
          <div className="mt-2 space-y-4">{older.map((d) => <DecisionView key={d.round} paperId={paperId} d={d} compact />)}</div>
        </details>
      )}
    </Card>
  );
}

function DecisionView({ paperId, d, compact = false }) {
  const isRevision = d.decision === "MINOR_REVISION" || d.decision === "MAJOR_REVISION";
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg font-bold text-ink">{OUTCOME[d.decision]}</span>
        <DecisionBadge decision={d.decision} />
        <span className="text-xs text-muted">{new Date(d.decidedAt).toLocaleDateString()} · round {d.round + 1}</span>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted">Message from the editor</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{d.message}</p>
      </div>
      {d.reviews.length > 0 && (
        <div>
          <p className="flex items-center gap-1 text-xs font-semibold text-muted">Reviewer comments <Icon name="lock" size={11} /> <span className="font-normal">reviewers are anonymous</span></p>
          <ul className="mt-1 space-y-2">
            {d.reviews.map((r) => (
              <li key={r.key} className="rounded bg-soft px-3 py-2 text-sm">
                <Badge className="bg-soft-2 text-ink border-line">{r.label}</Badge>
                <p className="mt-1 whitespace-pre-wrap text-ink">{r.commentsToAuthor || "No comments."}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!compact && (
        <div className="rounded-lg border border-line px-3 py-2 text-sm">
          <p className="text-xs font-semibold text-muted">Next step</p>
          <p className="text-ink">{d.nextAction}</p>
          {isRevision && d.revisionRound && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {d.revisionStatus && <RevisionStatusBadge status={d.revisionStatus} />}
              {d.revisionDueAt && <span className="text-xs text-muted">Deadline {new Date(d.revisionDueAt).toLocaleDateString()}</span>}
              <Button href={`/submissions/${paperId}/revision`} variant="primary" size="sm">Open revision {d.revisionRound}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
