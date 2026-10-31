"use client";

import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { useRole } from "@/components/layout/RoleContext";

const SCHOOLS = [
  { value: "", label: "Select…" },
  { value: "ISDI", label: "ISDI · School of Design & Innovation" },
  { value: "ISME", label: "ISME · BBA" },
  { value: "uGDX", label: "uGDX · B.Tech" },
  { value: "LAW", label: "LAW · LLB" },
];
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.doc";
const blankAuthor = () => ({ fullName: "", email: "", affiliation: "" });

export default function SubmitPage() {
  const { user } = useRole();
  const [authors, setAuthors] = useState([{ ...blankAuthor(), fullName: user?.name || "" }]);
  const [corresponding, setCorresponding] = useState(0);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [issues, setIssues] = useState({});
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function updateAuthor(i, field, value) {
    setAuthors((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)));
  }
  function addAuthor() { setAuthors((prev) => [...prev, blankAuthor()]); }
  function removeAuthor(i) {
    setAuthors((prev) => prev.filter((_, idx) => idx !== i));
    setCorresponding((c) => (c === i ? 0 : c > i ? c - 1 : c));
  }
  function onFile(e) {
    const f = e.target.files?.[0];
    setFileError("");
    if (f && f.size > MAX_BYTES) { setFileError("File exceeds the 25 MB limit."); e.target.value = ""; setFileName(""); return; }
    setFileName(f ? f.name : "");
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(""); setIssues({});
    const formEl = e.currentTarget;
    const file = formEl.manuscript?.files?.[0];
    if (!file) { setFileError("Attach a manuscript (PDF, DOCX or DOC)."); return; }

    const payloadAuthors = authors.map((a, i) => ({ ...a, isCorresponding: i === corresponding }));
    const fd = new FormData();
    fd.set("title", formEl.title.value);
    fd.set("abstract", formEl.abstract.value);
    fd.set("keywords", formEl.keywords.value);
    fd.set("school", formEl.school.value);
    fd.set("authors", JSON.stringify(payloadAuthors));
    fd.set("manuscript", file);

    setLoading(true);
    try {
      const res = await fetch("/api/papers", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not submit.");
        if (data.issues) setIssues(data.issues);
        setLoading(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (done) {
    return (
      <>
        <PageHeader eyebrow="Create paper" title="Submission received" />
        <Card className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok"><Icon name="check" size={26} /></span>
          <h2 className="text-lg font-bold text-ink">Your paper was submitted</h2>
          <p className="max-w-md text-sm text-muted">It is now in <b>SUBMITTED</b> status. An administrator will assign reviewers, and you will be notified by email as it progresses.</p>
          <div className="mt-2 flex gap-2">
            <Button href="/submissions" variant="outline">View my submissions</Button>
            <Button onClick={() => { setDone(false); setLoading(false); setAuthors([{ ...blankAuthor(), fullName: user?.name || "" }]); setCorresponding(0); setFileName(""); }}>Submit another</Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Create paper" title="Submit your paper" subtitle="Provide the paper details, authors, and upload the manuscript (PDF, DOCX or DOC, max 25 MB)." />
      <Card className="p-5 sm:p-6">
        <form className="flex flex-col gap-5" onSubmit={onSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Title" name="title" containerClassName="sm:col-span-2" placeholder="Paper title" required error={issues.title} />
            <Textarea label="Abstract" name="abstract" containerClassName="sm:col-span-2" rows={4} placeholder="Short abstract" />
            <Input label="Keywords" name="keywords" placeholder="comma-separated" error={issues.keywords} />
            <Select label="School" name="school" options={SCHOOLS} error={issues.school} />
          </div>

          {/* Authors */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Authors</p>
              <Button type="button" variant="outline" size="sm" onClick={addAuthor}><Icon name="plus" size={14} /> Add author</Button>
            </div>
            {issues.authors && <p className="mb-2 text-xs text-danger">{issues.authors}</p>}
            {issues.corresponding && <p className="mb-2 text-xs text-danger">{issues.corresponding}</p>}
            <div className="flex flex-col gap-3">
              {authors.map((a, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Input label="Full name" value={a.fullName} onChange={(e) => updateAuthor(i, "fullName", e.target.value)} required />
                    <Input label="Email" type="email" value={a.email} onChange={(e) => updateAuthor(i, "email", e.target.value)} />
                    <Input label="Affiliation" value={a.affiliation} onChange={(e) => updateAuthor(i, "affiliation", e.target.value)} />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs font-medium text-ink">
                      <input type="radio" name="corresponding" checked={corresponding === i} onChange={() => setCorresponding(i)} className="h-4 w-4" />
                      Corresponding author
                    </label>
                    {authors.length > 1 && (
                      <button type="button" onClick={() => removeAuthor(i)} className="text-xs font-semibold text-danger hover:underline">Remove</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Manuscript */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Manuscript</p>
            <input type="file" name="manuscript" accept={ACCEPT} onChange={onFile}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand/90" />
            <p className="mt-1 text-xs text-muted">PDF, DOCX or DOC · max 25 MB. {fileName && <span className="text-ink">Selected: {fileName}</span>}</p>
            {fileError && <p className="mt-1 text-xs text-danger">{fileError}</p>}
          </div>

          {error && <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button href="/dashboard" variant="outline">Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>{loading ? "Submitting…" : "Submit paper →"}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
