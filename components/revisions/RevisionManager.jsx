"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import { RevisionStatusBadge, TYPE_LABEL } from "@/components/revisions/RevisionStatusBadge";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const endOfDayIso = (d) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Admin / paper-editor panel: issue a revision request from SUBMITTED reviewer
 * feedback, track the author's progress, read the point-by-point response, and
 * release a submitted revision for re-review. All rules are enforced by the API.
 */
export default function RevisionManager({ paperId, onChanged }) {
  const [revData, setRevData] = useState(null);
  const [reviewData, setReviewData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true); setFailed(false);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/papers/${paperId}/revisions`, { cache: "no-store" }),
        fetch(`/api/papers/${paperId}/reviews`, { cache: "no-store" }),
      ]);
      const d1 = await r1.json().catch(() => ({}));
      const d2 = await r2.json().catch(() => ({}));
      if (r1.ok) setRevData(d1);
      if (r2.ok) setReviewData(d2);
      if (!r1.ok || !r2.ok) setFailed(true);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [paperId]);

  const refresh = () => { load(); onChanged?.(); };

  if (loading) return <Card className="p-5"><p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading revisions…</p></Card>;
  if (!revData || failed) {
    return (
      <Card className="p-5">
        <p className="text-sm text-danger" role="alert">Could not load revisions.</p>
        <button type="button" onClick={load} className="mt-2 text-xs font-semibold text-accent hover:underline">Try again</button>
      </Card>
    );
  }

  const revisions = revData.revisions || [];
  const latest = revisions[revisions.length - 1] || null;
  const open = latest && latest.status !== "REVISION_UNDER_REVIEW";
  const submittedReviews = (reviewData?.reviewers || []).filter((r) => r.reviewStatus === "SUBMITTED" && r.review?.id);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Revisions</h2>
        <span className="text-xs text-muted">Current round: {revData.currentRound === 0 ? "original" : `revision ${revData.currentRound}`}</span>
      </div>

      {revisions.length === 0 && <p className="mt-2 text-sm text-muted">No revision has been requested.</p>}

      <ul className="mt-3 space-y-3">
        {revisions.slice().reverse().map((r) => (
          <RevisionItem key={r.round} paperId={paperId} rev={r} onChanged={refresh} setMsg={setMsg} />
        ))}
      </ul>

      {!open && revData.paperStatus === "UNDER_REVIEW" && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
          To request a revision, choose <b>Minor revision</b> or <b>Major revision</b> in the Editorial decision panel and communicate it.
          {submittedReviews.length === 0 && " (At least one submitted review is needed first.)"}
        </p>
      )}
      {msg && <p className="mt-3 text-xs text-muted">{msg}</p>}

    </Card>
  );
}

function RevisionItem({ paperId, rev, onChanged, setMsg }) {
  const [show, setShow] = useState(false);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  async function startRereview() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/papers/${paperId}/revisions/${rev.round}/rereview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: endOfDayIso(due) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not start the re-review.");
      setMsg(`Revision ${rev.round} released to reviewers.`);
      onChanged();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">Revision {rev.round}</span>
          <Badge className="bg-soft-2 text-ink border-line">{TYPE_LABEL[rev.type]}</Badge>
          <RevisionStatusBadge status={rev.displayStatus} />
        </div>
        <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={() => setShow(!show)}>{show ? "Hide" : "Details"}</button>
      </div>
      <p className="mt-1 text-xs text-muted">
        Requested {fmtDate(rev.requestedAt)} · due {fmtDate(rev.dueAt)}
        {rev.startedAt && <> · started {fmtDate(rev.startedAt)}</>}
        {rev.submittedAt && <> · submitted {fmtDate(rev.submittedAt)}</>}
      </p>

      {show && (
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <p className="text-xs font-semibold text-muted">Instructions to the author</p>
            <p className="whitespace-pre-wrap text-ink">{rev.instructions}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted">Reviews shared with the author (comments to author only)</p>
            <p className="text-ink">{rev.sharedReviews.map((s) => `${s.label}${s.reviewer ? ` (${s.reviewer})` : ""}`).join(", ") || "—"}</p>
          </div>
          {rev.manuscript && (
            <a href={`/api/papers/${paperId}/manuscript?version=${rev.manuscript.version}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline">
              <Icon name="download" size={12} /> Revised manuscript (v{rev.manuscript.version})
            </a>
          )}
          <div>
            <p className="text-xs font-semibold text-muted">Point-by-point response</p>
            {rev.responses.length === 0 ? <p className="text-muted">No responses yet.</p> : (
              <ol className="mt-1 space-y-2">
                {rev.responses.map((e, i) => (
                  <li key={i} className="rounded bg-soft px-3 py-2">
                    <p className="text-xs text-muted">
                      {e.reviewKey ? `${e.reviewKey}${e.reviewer ? ` · ${e.reviewer}` : ""}` : "General"}
                      {e.addressed && <span className="ml-2 text-ok">✓ addressed</span>}
                    </p>
                    <p className="text-xs italic text-muted">“{e.comment}”</p>
                    <p className="mt-1 whitespace-pre-wrap text-ink">{e.response}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {rev.status === "REVISION_SUBMITTED" && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-xs text-muted">The author has submitted this revision. Release it to the assigned reviewers for re-review.</p>
          <Input type="date" label="Re-review deadline (optional)" value={due} min={today()} onChange={(e) => setDue(e.target.value)} />
          <Button variant="primary" size="sm" onClick={startRereview} disabled={busy}>{busy ? "Releasing…" : "Start re-review"}</Button>
        </div>
      )}
    </li>
  );
}
