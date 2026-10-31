"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import { RevisionStatusBadge, TYPE_LABEL } from "@/components/revisions/RevisionStatusBadge";

const MAX_BYTES = 25 * 1024 * 1024;
const fmtBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const blankEntry = (reviewKey = "") => ({ reviewKey, comment: "", response: "", addressed: false });

// Author workspace for the latest revision request on one of their papers.
// Everything shown here comes from the author-shaped API: reviewer comments are
// anonymous (Reviewer 1, 2…) and limited to "comments to the author".
export default function RevisionWorkspacePage() {
  const { id } = useParams();
  const [title, setTitle] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // First load shows the spinner. Refreshes after an upload/save keep the page
  // mounted, so unsaved responses and status messages are not thrown away.
  async function load({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [rp, rr] = await Promise.all([
        fetch(`/api/papers/${id}`, { cache: "no-store" }),
        fetch(`/api/papers/${id}/revisions`, { cache: "no-store" }),
      ]);
      const dp = await rp.json().catch(() => ({}));
      const dr = await rr.json().catch(() => ({}));
      if (!rp.ok) throw new Error(dp.error || "Could not load the submission.");
      if (!rr.ok) throw new Error(dr.error || "Could not load the revision.");
      setTitle(dp.paper?.title || "");
      setData(dr);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (id) load(); }, [id]);

  if (loading) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;
  if (error) return <Card className="px-6 py-12 text-center text-sm text-danger">{error}</Card>;

  if (data.view !== "author") {
    return (
      <Card className="px-6 py-12 text-center text-sm text-muted">
        Revision requests are managed from the submission page.
        <div className="mt-3"><Button href={`/submissions/${id}`} variant="outline" size="sm">Open submission</Button></div>
      </Card>
    );
  }

  const revisions = data.revisions || [];
  const latest = revisions[revisions.length - 1];
  const earlier = revisions.slice(0, -1).reverse();

  return (
    <>
      <PageHeader
        eyebrow={`Paper ${String(id).slice(0, 8)}`}
        title={title || "Revision"}
        subtitle={latest ? <span className="flex items-center gap-2">Revision {latest.round} · {TYPE_LABEL[latest.type]} <RevisionStatusBadge status={latest.displayStatus} /></span> : "No revision requested"}
        action={<Button href={`/submissions/${id}`} variant="outline" size="sm">← Submission</Button>}
      />
      {!latest ? (
        <Card className="px-6 py-12 text-center text-sm text-muted">No revision has been requested for this paper.</Card>
      ) : (
        <div className="space-y-5">
          <RevisionWork key={latest.round} paperId={id} rev={latest} onChanged={() => load({ quiet: true })} />
          {earlier.length > 0 && (
            <Card className="p-5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Earlier revisions</h2>
              <ul className="mt-2 space-y-2">
                {earlier.map((r) => (
                  <li key={r.round} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-ink">Revision {r.round}</span>
                    <Badge className="bg-soft-2 text-ink border-line">{TYPE_LABEL[r.type]}</Badge>
                    <RevisionStatusBadge status={r.displayStatus} />
                    <span className="text-xs text-muted">submitted {fmtDate(r.submittedAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

function RevisionWork({ paperId, rev, onChanged }) {
  const [entries, setEntries] = useState(() =>
    rev.responses.length ? rev.responses : rev.reviews.map((r) => blankEntry(r.key)),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [issues, setIssues] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const editable = rev.editable;

  const reviewerOpts = [{ value: "", label: "General (all reviewers)" }, ...rev.reviews.map((r) => ({ value: r.key, label: r.label }))];
  const labelOf = (key) => rev.reviews.find((r) => r.key === key)?.label || "General";
  const setEntry = (i, patch) => setEntries((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  async function save(final) {
    setBusy(true); setMsg(""); setIssues([]);
    try {
      const res = await fetch(`/api/papers/${paperId}/revisions/${rev.round}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: entries, submit: final }),
      });
      const d = await res.json().catch(() => ({}));
      setConfirming(false);
      if (!res.ok) { setIssues(d.issues || []); setMsg(d.error || "Could not save."); return; }
      setMsg(final ? "Revision submitted. The editor will send it for re-review." : "Draft saved.");
      onChanged();
    } catch { setMsg("Something went wrong."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted">Revision</p><p className="font-semibold text-ink">#{rev.round}</p></div>
          <div><p className="text-xs text-muted">Type</p><p className="font-semibold text-ink">{TYPE_LABEL[rev.type]}</p></div>
          <div><p className="text-xs text-muted">Requested</p><p className="font-semibold text-ink">{fmtDate(rev.requestedAt)}</p></div>
          <div><p className="text-xs text-muted">Deadline</p><p className={`font-semibold ${rev.displayStatus === "REVISION_OVERDUE" ? "text-danger" : "text-ink"}`}>{fmtDate(rev.dueAt)}</p></div>
        </div>
        <h2 className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">Editor&apos;s instructions</h2>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{rev.instructions}</p>
      </Card>

      <Card className="p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Reviewer comments</h2>
        <p className="mt-1 text-xs text-muted"><Icon name="lock" size={11} /> Reviewers are anonymous (double-blind).</p>
        <ul className="mt-3 space-y-3">
          {rev.reviews.map((r) => (
            <li key={r.key}>
              <p className="text-sm font-semibold text-ink">{r.label}</p>
              <p className="mt-1 whitespace-pre-wrap rounded bg-soft px-3 py-2 text-sm text-ink">{r.commentsToAuthor || <span className="text-muted">No comments.</span>}</p>
            </li>
          ))}
        </ul>
      </Card>

      <ManuscriptUpload paperId={paperId} rev={rev} editable={editable} onUploaded={onChanged} />

      <Card className="p-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Point-by-point response</h2>
        {editable && <p className="mt-1 text-xs text-muted">Add one entry per reviewer comment. Every reviewer needs at least one response before you can submit.</p>}
        <ol className="mt-3 space-y-4">
          {entries.map((e, i) => (
            <li key={i} className="rounded-lg border border-line p-3">
              {editable ? (
                <div className="space-y-2">
                  <div className="flex items-end gap-2">
                    <Select containerClassName="flex-1" label={`Response ${i + 1} · reviewer`} options={reviewerOpts}
                      value={e.reviewKey} onChange={(ev) => setEntry(i, { reviewKey: ev.target.value })} />
                    <Button variant="outline" size="sm" onClick={() => setEntries((es) => es.filter((_, j) => j !== i))} aria-label={`Remove response ${i + 1}`}>Remove</Button>
                  </div>
                  <Textarea label="Reviewer comment (quote or summarize)" rows={2} value={e.comment} onChange={(ev) => setEntry(i, { comment: ev.target.value })} />
                  <Textarea label="Your response" rows={3} value={e.response} onChange={(ev) => setEntry(i, { response: ev.target.value })} />
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={e.addressed} onChange={(ev) => setEntry(i, { addressed: ev.target.checked })} /> Addressed in the revised manuscript
                  </label>
                </div>
              ) : (
                <div className="text-sm">
                  <p className="text-xs text-muted">{labelOf(e.reviewKey)}{e.addressed && <span className="ml-2 text-ok">✓ addressed</span>}</p>
                  <p className="text-xs italic text-muted">“{e.comment}”</p>
                  <p className="mt-1 whitespace-pre-wrap text-ink">{e.response}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
        {editable && (
          <>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setEntries((es) => [...es, blankEntry()])}>+ Add response</Button>
            {issues.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-danger">{issues.slice(0, 6).map((x, k) => <li key={k}>{x}</li>)}</ul>}
            {msg && <p className="mt-3 text-xs text-muted">{msg}</p>}
            {confirming ? (
              <div className="mt-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-3 text-sm">
                Submit revision {rev.round}? Your revised manuscript and responses become final and are sent to the editor.
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
                  <Button variant="primary" size="sm" onClick={() => save(true)} disabled={busy}>{busy ? "Submitting…" : "Submit revision"}</Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => save(false)} disabled={busy}>{busy ? "Saving…" : "Save draft"}</Button>
                <Button variant="primary" size="sm" onClick={() => setConfirming(true)} disabled={busy || !rev.manuscript}>Submit revision</Button>
              </div>
            )}
            {!rev.manuscript && <p className="mt-2 text-right text-xs text-muted">Upload the revised manuscript to enable submission.</p>}
          </>
        )}
        {!editable && <p className="mt-3 text-xs text-muted">Submitted {fmtDate(rev.submittedAt)}. This revision can no longer be edited.</p>}
      </Card>
    </>
  );
}

function ManuscriptUpload({ paperId, rev, editable, onUploaded }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function upload() {
    if (!file) return;
    if (file.size > MAX_BYTES) { setMsg("File exceeds the 25 MB limit."); return; }
    setBusy(true); setMsg("");
    try {
      const fd = new FormData();
      fd.append("manuscript", file);
      const res = await fetch(`/api/papers/${paperId}/revisions/${rev.round}/manuscript`, { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Upload failed.");
      setMsg("Revised manuscript uploaded."); setFile(null);
      onUploaded();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="p-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Revised manuscript</h2>
      {rev.manuscript ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm text-ink">{rev.manuscript.filename || `Revision ${rev.round}`}</p>
            <p className="text-xs text-muted">{fmtBytes(rev.manuscript.byteSize)} · uploaded {fmtDate(rev.manuscript.uploadedAt)}</p>
          </div>
          <a href={`/api/papers/${paperId}/manuscript?version=${rev.manuscript.version}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-soft">
            <Icon name="download" size={14} /> Download
          </a>
        </div>
      ) : <p className="mt-2 text-sm text-muted">Not uploaded yet.</p>}
      {editable && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <input type="file" accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm" aria-label="Revised manuscript file" />
          <p className="text-xs text-muted">PDF, DOCX or DOC, up to 25 MB. {rev.manuscript ? "Uploading again replaces this draft file; your original and earlier versions are kept." : "Your original manuscript is kept unchanged."}</p>
          <Button variant="primary" size="sm" onClick={upload} disabled={busy || !file}>{busy ? "Uploading…" : rev.manuscript ? "Replace file" : "Upload"}</Button>
          {msg && <p className="text-xs text-muted">{msg}</p>}
        </div>
      )}
    </Card>
  );
}
