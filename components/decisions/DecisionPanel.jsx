"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import { DecisionBadge } from "@/components/decisions/DecisionBadge";

const REC_LABEL = { ACCEPT: "Accept", MINOR_REVISION: "Minor Revision", MAJOR_REVISION: "Major Revision", REJECT: "Reject" };
const DECISION_OPTS = [
  { value: "", label: "Select a decision…" },
  { value: "ACCEPT", label: "Accept" },
  { value: "MINOR_REVISION", label: "Minor revision" },
  { value: "MAJOR_REVISION", label: "Major revision" },
  { value: "REJECT", label: "Reject" },
];
const isRev = (d) => d === "MINOR_REVISION" || d === "MAJOR_REVISION";
const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const today = () => new Date().toISOString().slice(0, 10);

/**
 * Admin / paper-editor decision panel: read the submitted reviews (shown in the
 * Review progress card), save a decision draft, then communicate it. Shows the
 * full decision history. Every rule is enforced server-side.
 */
export default function DecisionPanel({ paperId, onChanged }) {
  const [data, setData] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  async function load() {
    setLoading(true); setFailed(false);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/papers/${paperId}/decisions`, { cache: "no-store" }),
        fetch(`/api/papers/${paperId}/reviews`, { cache: "no-store" }),
      ]);
      const d1 = await r1.json().catch(() => ({}));
      const d2 = await r2.json().catch(() => ({}));
      if (r1.ok) setData(d1);
      if (r2.ok) setReviews(d2);
      // Without the reviews list the panel would wrongly say "no reviews submitted".
      if (!r1.ok || !r2.ok) setFailed(true);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [paperId]);

  if (loading) return <Card className="p-5"><p className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading decisions…</p></Card>;
  if (!data || failed) {
    return (
      <Card className="p-5">
        <p className="text-sm text-danger" role="alert">Could not load the editorial decision panel.</p>
        <button type="button" onClick={load} className="mt-2 text-xs font-semibold text-accent hover:underline">Try again</button>
      </Card>
    );
  }

  const round = data.currentRound ?? 0;
  const current = data.decisions.find((d) => d.round === round) || null;
  const submittedReviews = (reviews?.reviewers || []).filter((r) => r.reviewStatus === "SUBMITTED" && r.review?.id);
  const canDecideNow = data.paperStatus === "UNDER_REVIEW" && !(current && !current.editable);
  const history = data.decisions.slice().reverse();

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Editorial decision</h2>
        <span className="text-xs text-muted">Round {round + 1}{round > 0 ? ` (revision ${round})` : ""}</span>
      </div>

      {canDecideNow ? (
        submittedReviews.length ? (
          <DecisionForm key={current ? `${current.id}:${current.version}` : "new"} paperId={paperId} draft={current}
            submittedReviews={submittedReviews} onDone={() => { load(); onChanged?.(); }} />
        ) : (
          <p className="mt-2 text-sm text-muted">A decision can be made once at least one reviewer has submitted a report for this round.</p>
        )
      ) : (
        <p className="mt-2 text-sm text-muted">
          {data.paperStatus === "ACCEPTED" ? "This paper has been accepted." :
           data.paperStatus === "REJECTED" ? "This paper has been rejected. No further decisions or revisions are possible." :
           data.paperStatus === "REVISION" ? "Waiting for the author's revision. Start the re-review when it is submitted." :
           "No decision can be made at this stage."}
        </p>
      )}

      <div className="mt-5 border-t border-line pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Decision history</p>
        {history.length === 0 ? <p className="mt-1 text-sm text-muted">No decisions yet.</p> : (
          <ol className="mt-2 space-y-3">
            {history.map((d) => (
              <li key={d.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">Round {d.round + 1}</span>
                  <DecisionBadge decision={d.decision} />
                  {d.releasedAt
                    ? <Badge className="bg-ok-soft text-ok border-ok/30">Communicated</Badge>
                    : <Badge className="bg-warn-soft text-warn border-warn/30">Draft · v{d.version}</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {d.releasedAt ? `Communicated ${fmt(d.releasedAt)}${d.releasedBy ? ` by ${d.releasedBy}` : ""}` : `Last saved ${fmt(d.updatedAt)}${d.decidedBy ? ` by ${d.decidedBy}` : ""}`}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-ink">{d.summary}</p>
                {d.confidentialNote && (
                  <p className="mt-2 rounded bg-warn-soft px-2 py-1 text-xs"><span className="inline-flex items-center gap-1 font-semibold text-warn"><Icon name="lock" size={11} /> Confidential note:</span> {d.confidentialNote}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function DecisionForm({ paperId, draft, submittedReviews, onDone }) {
  const [decision, setDecision] = useState(draft?.decision || "");
  const [summary, setSummary] = useState(draft?.summary || "");
  const [note, setNote] = useState(draft?.confidentialNote || "");
  const [due, setDue] = useState(draft?.revisionDueAt ? draft.revisionDueAt.slice(0, 10) : "");
  const [selected, setSelected] = useState(() => new Set(draft ? draft.reviewIds : submittedReviews.map((r) => r.review.id)));
  const [saved, setSaved] = useState(draft ? { id: draft.id, version: draft.version } : null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [issues, setIssues] = useState({});
  const [confirming, setConfirming] = useState(false);

  const touch = (fn) => (v) => { fn(v); setDirty(true); };
  const toggle = (rid) => { setSelected((s) => { const n = new Set(s); n.has(rid) ? n.delete(rid) : n.add(rid); return n; }); setDirty(true); };

  async function save() {
    setBusy(true); setMsg(""); setIssues({});
    try {
      const res = await fetch(`/api/papers/${paperId}/decisions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision, summary, confidentialNote: note, reviewIds: [...selected],
          dueAt: isRev(decision) && due ? new Date(`${due}T23:59:59`).toISOString() : null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setIssues(d.issues || {}); throw new Error(d.error || "Could not save the decision."); }
      setSaved({ id: d.decision.id, version: d.decision.version });
      setDirty(false);
      setMsg("Draft saved. Review it, then communicate it to the author.");
      return d.decision;
    } catch (e) { setMsg(e.message); return null; }
    finally { setBusy(false); }
  }

  async function communicate() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/papers/${paperId}/decisions/${saved.id}/release`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: saved.version }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not communicate the decision.");
      setConfirming(false);
      onDone();
    } catch (e) { setMsg(e.message); setConfirming(false); }
    finally { setBusy(false); }
  }

  const effect = {
    ACCEPT: "The paper will be marked ACCEPTED and become eligible for publication.",
    REJECT: "The paper will be marked REJECTED. The author cannot revise it further.",
    MINOR_REVISION: "A minor revision request will be sent to the author.",
    MAJOR_REVISION: "A major revision request will be sent to the author.",
  }[decision];

  return (
    <div className="mt-3 space-y-3">
      <Select label="Decision" options={DECISION_OPTS} value={decision} onChange={(e) => touch(setDecision)(e.target.value)} error={issues.decision} />
      <div>
        <Textarea label={isRev(decision) ? "Message to the author (decision letter + revision instructions)" : "Message to the author (decision summary)"}
          rows={5} value={summary} onChange={(e) => touch(setSummary)(e.target.value)} />
        {issues.summary && <p className="mt-1 text-xs text-danger">{issues.summary}</p>}
      </div>
      <div>
        <Textarea label="Confidential note (editors and admins only)" rows={2} value={note} onChange={(e) => touch(setNote)(e.target.value)} />
        <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Icon name="lock" size={11} /> Never shown to the author.</p>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Reviewer comments to release to the author</p>
        <ul className="space-y-1">
          {submittedReviews.map((r) => (
            <li key={r.review.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.has(r.review.id)} onChange={() => toggle(r.review.id)} aria-label={`Release review by ${r.reviewerName || "reviewer"}`} />
              <span className="text-ink">{r.reviewerName || r.reviewerEmail || "Reviewer"}</span>
              <Badge className="bg-soft-2 text-ink border-line">recommends {REC_LABEL[r.review.recommendation] || r.review.recommendation}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-muted">Released reviews reach the author anonymously and only as “comments to the author”. Reviewer recommendations are advisory: the decision is yours.</p>
        {issues.reviewIds && <p className="text-xs text-danger">{issues.reviewIds}</p>}
      </div>
      {isRev(decision) && (
        <Input type="date" label="Revision deadline (optional)" value={due} min={today()} onChange={(e) => touch(setDue)(e.target.value)} error={issues.dueAt} />
      )}

      {msg && <p className="text-xs text-muted">{msg}</p>}
      {confirming ? (
        <div className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-3 text-sm">
          Communicate this decision to the author? {effect} A communicated decision can&apos;t be changed.
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={communicate} disabled={busy}>{busy ? "Sending…" : "Communicate decision"}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={save} disabled={busy || !decision}>{busy ? "Saving…" : saved ? "Save changes" : "Save draft"}</Button>
          <Button variant="primary" size="sm" onClick={() => setConfirming(true)} disabled={busy || !saved || dirty}>Communicate to author</Button>
        </div>
      )}
      {saved && dirty && <p className="text-right text-[11px] text-muted">Save your changes before communicating.</p>}
    </div>
  );
}
