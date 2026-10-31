"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";

export const CONTAINER_BADGE = {
  DRAFT: "bg-soft-2 text-muted border-line",
  SCHEDULED: "bg-warn-soft text-warn border-warn/30",
  PUBLISHED: "bg-ok-soft text-ok border-ok/30",
};

async function send(url, method, body) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error(d.error || "Request failed."); err.issues = d.issues || {}; throw err; }
  return d;
}

/**
 * Volumes & issues (administrators manage; editors see read-only).
 * Status: DRAFT ⇄ SCHEDULED → PUBLISHED (final). Issues publish only inside a
 * published volume; publishing an issue can publish its scheduled papers too.
 */
export default function VolumesManager({ volumes, canManage, onChanged, notify }) {
  const [editing, setEditing] = useState(null); // { kind: 'volume'|'issue', item?, volumeId? }
  const [publishIssue, setPublishIssue] = useState(null);
  const [publishVolume, setPublishVolume] = useState(null);

  async function setStatus(kind, id, status, extra = {}) {
    try {
      const d = await send(`/api/publications/${kind === "volume" ? "volumes" : "issues"}/${id}`, "PATCH", { status, ...extra });
      notify(kind === "issue" && status === "PUBLISHED"
        ? `Issue published${d.papersPublished ? ` with ${d.papersPublished} paper(s)` : ""}.`
        : `${kind === "volume" ? "Volume" : "Issue"} set to ${status.toLowerCase()}.`, "ok");
      onChanged();
    } catch (e) { notify(e.message, "error"); }
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={() => setEditing({ kind: "volume" })}>+ New volume</Button>
        </div>
      )}
      {volumes.length === 0 && <Card className="px-6 py-10 text-center text-sm text-muted">No volumes yet.{canManage ? " Create the first one." : ""}</Card>}

      {volumes.map((v) => (
        <Card key={v.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-display text-lg font-bold text-ink">
                Volume {v.volume_number} · {v.year} <Badge className={CONTAINER_BADGE[v.status]}>{v.status}</Badge>
              </p>
              <p className="text-sm text-ink">{v.title}</p>
              {v.description && <p className="mt-1 text-xs text-muted">{v.description}</p>}
            </div>
            {canManage && v.status !== "PUBLISHED" && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing({ kind: "volume", item: v })}>Edit</Button>
                {v.status === "DRAFT" && <Button variant="outline" size="sm" onClick={() => setStatus("volume", v.id, "SCHEDULED")}>Schedule</Button>}
                {v.status === "SCHEDULED" && <Button variant="outline" size="sm" onClick={() => setStatus("volume", v.id, "DRAFT")}>Back to draft</Button>}
                <Button variant="primary" size="sm" onClick={() => setPublishVolume(v)}>Publish volume</Button>
              </div>
            )}
          </div>

          <ul className="mt-4 divide-y divide-line border-t border-line">
            {v.issues.length === 0 && <li className="py-3 text-sm text-muted">No issues in this volume.</li>}
            {v.issues.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    Issue {i.issue_number} · {i.title} <Badge className={CONTAINER_BADGE[i.status]}>{i.status}</Badge>
                  </p>
                  <p className="text-xs text-muted">{i.publication_date ? `Publication date ${i.publication_date}` : "No publication date"}</p>
                </div>
                {canManage && i.status !== "PUBLISHED" && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing({ kind: "issue", item: i, volumeId: v.id })}>Edit</Button>
                    {i.status === "DRAFT" && <Button variant="outline" size="sm" onClick={() => setStatus("issue", i.id, "SCHEDULED")}>Schedule</Button>}
                    {i.status === "SCHEDULED" && <Button variant="outline" size="sm" onClick={() => setStatus("issue", i.id, "DRAFT")}>Back to draft</Button>}
                    <Button variant="primary" size="sm" onClick={() => setPublishIssue({ issue: i, volume: v })}
                      disabled={v.status !== "PUBLISHED"} title={v.status !== "PUBLISHED" ? "Publish the volume first" : undefined}>Publish issue</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setEditing({ kind: "issue", volumeId: v.id })}>+ Add issue</Button>
          )}
        </Card>
      ))}

      {editing && (
        <ContainerForm editing={editing} onClose={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); notify(m, "ok"); onChanged(); }} />
      )}
      {publishVolume && (
        <Modal open onClose={() => setPublishVolume(null)} title={`Publish volume ${publishVolume.volume_number}?`}
          footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setPublishVolume(null)}>Cancel</Button><Button variant="primary" size="sm" onClick={async () => { const v = publishVolume; setPublishVolume(null); await setStatus("volume", v.id, "PUBLISHED"); }}>Publish volume</Button></div>}>
          <p className="text-sm text-ink">The volume becomes public and can no longer be edited. Its issues and papers stay unpublished until you publish them.</p>
        </Modal>
      )}
      {publishIssue && (
        <PublishIssueDialog target={publishIssue} onClose={() => setPublishIssue(null)}
          onConfirm={async (withPapers) => { const t = publishIssue; setPublishIssue(null); await setStatus("issue", t.issue.id, "PUBLISHED", { publishPapers: withPapers }); }} />
      )}
    </div>
  );
}

function ContainerForm({ editing, onClose, onSaved }) {
  const isVolume = editing.kind === "volume";
  const it = editing.item;
  const [f, setF] = useState(isVolume
    ? { volumeNumber: it?.volume_number ?? "", year: it?.year ?? new Date().getFullYear(), title: it?.title || "", description: it?.description || "" }
    : { issueNumber: it?.issue_number ?? "", title: it?.title || "", description: it?.description || "", publicationDate: it?.publication_date || "" });
  const [issues, setIssues] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true); setMsg(""); setIssues({});
    try {
      if (isVolume) await send(it ? `/api/publications/volumes/${it.id}` : "/api/publications/volumes", it ? "PATCH" : "POST", f);
      else await send(it ? `/api/publications/issues/${it.id}` : "/api/publications/issues", it ? "PATCH" : "POST", { ...f, volumeId: editing.volumeId, publicationDate: f.publicationDate || null });
      onSaved(`${isVolume ? "Volume" : "Issue"} ${it ? "updated" : "created"}.`);
    } catch (e) { setMsg(e.message); setIssues(e.issues || {}); }
    finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`${it ? "Edit" : "New"} ${isVolume ? "volume" : "issue"}`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>}>
      <div className="space-y-3">
        {isVolume ? (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Volume number" type="number" min={1} value={f.volumeNumber} onChange={set("volumeNumber")} error={issues.volumeNumber} required />
            <Input label="Publication year" type="number" min={1900} max={2200} value={f.year} onChange={set("year")} error={issues.year} required />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Input label="Issue number" type="number" min={1} value={f.issueNumber} onChange={set("issueNumber")} error={issues.issueNumber} required />
            <Input label="Publication date" type="date" value={f.publicationDate} onChange={set("publicationDate")} error={issues.publicationDate} />
          </div>
        )}
        <Input label="Title" value={f.title} onChange={set("title")} error={issues.title} required />
        <div>
          <Textarea label="Description" rows={3} value={f.description} onChange={set("description")} />
          {issues.description && <p className="mt-1 text-xs text-danger">{issues.description}</p>}
        </div>
        {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
      </div>
    </Modal>
  );
}

function PublishIssueDialog({ target, onClose, onConfirm }) {
  const [withPapers, setWithPapers] = useState(true);
  return (
    <Modal open onClose={onClose} title={`Publish issue ${target.issue.issue_number}?`}
      footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button variant="primary" size="sm" onClick={() => onConfirm(withPapers)}>Publish issue</Button></div>}>
      <p className="text-sm text-ink">The issue becomes public and can no longer be edited.</p>
      <label className="mt-3 flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-1" checked={withPapers} onChange={(e) => setWithPapers(e.target.checked)} />
        <span>Also publish every paper scheduled in this issue (in the same step).</span>
      </label>
    </Modal>
  );
}
