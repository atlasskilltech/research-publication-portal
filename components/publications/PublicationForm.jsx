"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";

const fmtBytes = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/**
 * Publication metadata form — used to SCHEDULE an eligible paper (mode
 * "create") and to EDIT a scheduled record (mode "edit"). The server validates
 * everything again; this only gives early feedback.
 */
export default function PublicationForm({ mode, paperId, publication, defaults, manuscripts, volumes, onDone, onCancel }) {
  const init = publication || defaults || {};
  const [volumeId, setVolumeId] = useState(publication?.volumeId || "");
  const [issueId, setIssueId] = useState(publication?.issueId || "");
  const [title, setTitle] = useState(init.title || "");
  const [abstract, setAbstract] = useState(init.abstract || "");
  const [authors, setAuthors] = useState((init.authors || []).length ? init.authors : [{ name: "", affiliation: "" }]);
  const [keywords, setKeywords] = useState((init.keywords || []).join(", "));
  const [pageStart, setPageStart] = useState(publication?.pageStart ?? "");
  const [pageEnd, setPageEnd] = useState(publication?.pageEnd ?? "");
  const [doi, setDoi] = useState(publication?.doi || "");
  const [publicationDate, setPublicationDate] = useState(publication?.publicationDate || "");
  const [manuscriptId, setManuscriptId] = useState(init.manuscriptId || "");
  const [manuscriptPublic, setManuscriptPublic] = useState(!!publication?.manuscriptPublic);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [issues, setIssues] = useState({});

  const volume = volumes.find((v) => v.id === volumeId);
  const issueOpts = useMemo(() => (volume?.issues || []).map((i) => ({ value: i.id, label: `Issue ${i.issue_number} — ${i.title} (${i.status.toLowerCase()})` })), [volume]);
  const setAuthor = (i, patch) => setAuthors((as) => as.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  async function submit() {
    setBusy(true); setMsg(""); setIssues({});
    const payload = {
      volumeId, issueId, title, abstract, authors, keywords: keywords.split(","),
      pageStart, pageEnd, doi, publicationDate: publicationDate || null,
      manuscriptId: manuscriptId || null, manuscriptPublic,
    };
    try {
      const res = mode === "create"
        ? await fetch("/api/publications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paperId, ...payload }) })
        : await fetch(`/api/publications/${publication.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: publication.version, ...payload }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setIssues(d.issues || {}); setMsg(d.error || "Could not save."); return; }
      onDone?.(mode === "create" ? "Paper scheduled for publication." : "Publication updated.");
    } catch { setMsg("Something went wrong."); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Volume" value={volumeId} onChange={(e) => { setVolumeId(e.target.value); setIssueId(""); }} error={issues.volumeId}
          options={[{ value: "", label: volumes.length ? "Select a volume…" : "No volumes yet" }, ...volumes.map((v) => ({ value: v.id, label: `Vol. ${v.volume_number} (${v.year}) — ${v.title}` }))]} />
        <Select label="Issue" value={issueId} onChange={(e) => setIssueId(e.target.value)} error={issues.issueId}
          options={[{ value: "", label: volume ? (issueOpts.length ? "Select an issue…" : "This volume has no issues") : "Select a volume first" }, ...issueOpts]} />
      </div>
      <Input label="Published title" value={title} onChange={(e) => setTitle(e.target.value)} error={issues.title} required />
      <div>
        <Textarea label="Abstract" rows={4} value={abstract} onChange={(e) => setAbstract(e.target.value)} />
        {issues.abstract && <p className="mt-1 text-xs text-danger">{issues.abstract}</p>}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Authors (as published)</p>
        <ul className="space-y-2">
          {authors.map((a, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <Input containerClassName="min-w-40 flex-1" placeholder="Full name" value={a.name} onChange={(e) => setAuthor(i, { name: e.target.value })} aria-label={`Author ${i + 1} name`} />
              <Input containerClassName="min-w-40 flex-1" placeholder="Affiliation" value={a.affiliation} onChange={(e) => setAuthor(i, { affiliation: e.target.value })} aria-label={`Author ${i + 1} affiliation`} />
              <Button variant="outline" size="sm" onClick={() => setAuthors((as) => as.filter((_, j) => j !== i))} disabled={authors.length === 1}>Remove</Button>
            </li>
          ))}
        </ul>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setAuthors((as) => [...as, { name: "", affiliation: "" }])}>+ Add author</Button>
        {issues.authors && <p className="mt-1 text-xs text-danger">{issues.authors}</p>}
        <p className="mt-1 text-[11px] text-muted">Only names and affiliations are published. Email addresses are never shown publicly.</p>
      </div>

      <Input label="Keywords (comma-separated)" value={keywords} onChange={(e) => setKeywords(e.target.value)} error={issues.keywords} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input label="First page" type="number" min={1} value={pageStart} onChange={(e) => setPageStart(e.target.value)} error={issues.pageStart} />
        <Input label="Last page" type="number" min={1} value={pageEnd} onChange={(e) => setPageEnd(e.target.value)} error={issues.pageEnd} />
        <Input label="Publication date" type="date" value={publicationDate} onChange={(e) => setPublicationDate(e.target.value)} error={issues.publicationDate} />
        <Input label="DOI (optional)" placeholder="10.1234/abc" value={doi} onChange={(e) => setDoi(e.target.value)} error={issues.doi} />
      </div>

      <Select label="Final manuscript" value={manuscriptId} onChange={(e) => setManuscriptId(e.target.value)} error={issues.manuscriptId}
        options={[{ value: "", label: "None" }, ...(manuscripts || []).map((m) => ({ value: m.id, label: `${m.version === 0 ? "Original" : `Revision ${m.version}`} · ${fmtBytes(m.byteSize)}` }))]} />
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-1" checked={manuscriptPublic} onChange={(e) => setManuscriptPublic(e.target.checked)} disabled={!manuscriptId} />
        <span>Make the final manuscript publicly downloadable once published.
          <span className="block text-xs text-muted">Off by default. Check that the file is the final, publishable version.</span></span>
      </label>
      <p className="text-[11px] text-muted">DOI is entered manually. No external DOI registration is performed.</p>

      {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button variant="primary" size="sm" onClick={submit} disabled={busy}>{busy ? "Saving…" : mode === "create" ? "Schedule publication" : "Save changes"}</Button>
      </div>
    </div>
  );
}
