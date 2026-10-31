"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import Tabs from "@/components/ui/Tabs";
import Modal from "@/components/ui/Modal";
import EmptyState from "@/components/ui/EmptyState";
import PublicationForm from "@/components/publications/PublicationForm";
import VolumesManager, { CONTAINER_BADGE } from "@/components/publications/VolumesManager";

const PUB_BADGE = { SCHEDULED: "bg-warn-soft text-warn border-warn/30", PUBLISHED: "bg-ok-soft text-ok border-ok/30" };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

// Publication management (admins: everything; editors: their own papers).
// Every action is re-authorized and re-validated by the API and the database.
export default function PublicationManagePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("awaiting");
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState(null); // { mode, eligible?, publication? }
  const [publishing, setPublishing] = useState(null);
  const [f, setF] = useState({ q: "", year: "", volume: "", issue: "", status: "" });

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/publications/manage", { cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not load publication management.");
      setData(d);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  const notify = (text, kind = "ok") => setToast({ text, kind });

  const volumes = useMemo(() => data?.volumes || [], [data]);
  const issueById = useMemo(() => new Map(volumes.flatMap((v) => v.issues.map((i) => [i.id, { ...i, volume: v }]))), [volumes]);
  const years = useMemo(() => [...new Set(volumes.map((v) => v.year))].sort((a, b) => b - a), [volumes]);

  const pubs = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return (data?.publications || []).filter((p) => {
      const iss = issueById.get(p.issueId);
      if (q && !p.title.toLowerCase().includes(q)) return false;
      if (f.year && String(iss?.volume.year) !== f.year) return false;
      if (f.volume && p.volumeId !== f.volume) return false;
      if (f.issue && p.issueId !== f.issue) return false;
      if (f.status && p.status !== f.status) return false;
      return true;
    });
  }, [data, f, issueById]);
  const eligible = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return (data?.eligible || []).filter((e) => !q || e.title.toLowerCase().includes(q));
  }, [data, f.q]);

  async function publish(p) {
    try {
      const res = await fetch(`/api/publications/${p.id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedVersion: p.version }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not publish.");
      notify("Paper published.", "ok");
      load();
    } catch (e) { notify(e.message, "error"); }
    finally { setPublishing(null); }
  }

  if (loading && !data) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;
  if (error) {
    return (
      <Card className="px-6 py-12 text-center text-sm text-danger">
        {error}
        <div className="mt-3"><Button variant="outline" size="sm" onClick={() => load()}>Try again</Button></div>
      </Card>
    );
  }

  const s = data.summary;
  const issueLabel = (id) => { const i = issueById.get(id); return i ? `Vol. ${i.volume.volume_number} (${i.volume.year}) · Issue ${i.issue_number}` : "—"; };
  const filterVolume = volumes.find((v) => v.id === f.volume);

  return (
    <>
      <PageHeader eyebrow="Publication" title="Publication management"
        subtitle={data.canManageVolumes ? "Volumes, issues and accepted papers" : "Publication records for papers you edit"}
        action={<Button href="/publications" variant="outline" size="sm">View public site</Button>} />

      {toast && (
        <div role="status" className={`mb-4 flex items-center justify-between rounded-lg border px-4 py-2 text-sm ${toast.kind === "error" ? "border-danger/30 bg-danger-soft text-danger" : "border-ok/30 bg-ok-soft text-ok"}`}>
          <span>{toast.text}</span>
          <button type="button" className="text-xs font-semibold" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[["Awaiting publication", s.awaiting], ["Scheduled", s.scheduled], ["Published", s.published], ["Volumes", s.volumes], ["Issues", s.issues]].map(([label, n]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">{n}</p>
          </Card>
        ))}
      </div>

      <Tabs className="mb-4" active={tab} onChange={setTab}
        tabs={[{ key: "awaiting", label: `Awaiting (${s.awaiting})` }, { key: "records", label: `Publications (${s.scheduled + s.published})` }, { key: "volumes", label: "Volumes & issues" }]} />

      {tab !== "volumes" && (
        <Card className="mb-4 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <Input label="Search title" value={f.q} onChange={(e) => setF((x) => ({ ...x, q: e.target.value }))} placeholder="Paper title…" />
            {tab === "records" && <>
              <Select label="Year" value={f.year} onChange={(e) => setF((x) => ({ ...x, year: e.target.value }))} options={[{ value: "", label: "All" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
              <Select label="Volume" value={f.volume} onChange={(e) => setF((x) => ({ ...x, volume: e.target.value, issue: "" }))} options={[{ value: "", label: "All" }, ...volumes.map((v) => ({ value: v.id, label: `Vol. ${v.volume_number} (${v.year})` }))]} />
              <Select label="Issue" value={f.issue} onChange={(e) => setF((x) => ({ ...x, issue: e.target.value }))} options={[{ value: "", label: "All" }, ...(filterVolume?.issues || []).map((i) => ({ value: i.id, label: `Issue ${i.issue_number}` }))]} />
              <Select label="Status" value={f.status} onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))} options={[{ value: "", label: "All" }, { value: "SCHEDULED", label: "Scheduled" }, { value: "PUBLISHED", label: "Published" }]} />
            </>}
          </div>
        </Card>
      )}

      {tab === "awaiting" && (
        eligible.length === 0 ? (
          <Card className="px-6 py-12"><EmptyState icon="papers" title="Nothing awaiting publication" message="Papers appear here after an ACCEPT decision has been communicated." /></Card>
        ) : (
          <div className="space-y-3">
            {eligible.map((e) => (
              <Card key={e.paperId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{e.title}</p>
                  <p className="text-xs text-muted">Paper {String(e.paperId).slice(0, 8)} · accepted {fmtDate(e.acceptedAt)} · {e.manuscripts.length} manuscript version(s)</p>
                </div>
                <div className="flex gap-2">
                  <Button href={`/submissions/${e.paperId}`} variant="outline" size="sm">Submission</Button>
                  <Button variant="primary" size="sm" onClick={() => setForm({ mode: "create", eligible: e })} disabled={!volumes.some((v) => v.issues.length)}
                    title={!volumes.some((v) => v.issues.length) ? "Create a volume and issue first" : undefined}>Assign to issue</Button>
                </div>
              </Card>
            ))}
            {!volumes.some((v) => v.issues.length) && <p className="text-xs text-muted">Create a volume with at least one issue before scheduling papers.</p>}
          </div>
        )
      )}

      {tab === "records" && (
        pubs.length === 0 ? (
          <Card className="px-6 py-12"><EmptyState icon="papers" title="No publication records" message="Scheduled and published papers appear here." /></Card>
        ) : (
          <div className="space-y-3">
            {pubs.map((p) => {
              const iss = issueById.get(p.issueId);
              const canPublish = p.status === "SCHEDULED" && iss?.status === "PUBLISHED";
              return (
                <Card key={p.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">{p.title} <Badge className={PUB_BADGE[p.status]}>{p.status}</Badge></p>
                      <p className="text-xs text-muted">{issueLabel(p.issueId)}{iss && <> · issue <Badge className={CONTAINER_BADGE[iss.status]}>{iss.status.toLowerCase()}</Badge></>}</p>
                      <p className="mt-1 text-xs text-muted">
                        {p.authors.map((a) => a.name).join(", ")}
                        {p.pageStart ? ` · pp. ${p.pageStart}${p.pageEnd && p.pageEnd !== p.pageStart ? `–${p.pageEnd}` : ""}` : ""}
                        {p.doi ? ` · DOI ${p.doi}` : ""} · {p.status === "PUBLISHED" ? `published ${fmtDate(p.publishedAt)}` : `scheduled ${fmtDate(p.scheduledAt)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.status === "PUBLISHED" && <Button href={`/publications/${p.id}`} variant="outline" size="sm">Public page</Button>}
                      {p.status === "SCHEDULED" && <Button variant="outline" size="sm" onClick={() => setForm({ mode: "edit", publication: p })}>Edit</Button>}
                      {p.status === "SCHEDULED" && (
                        <Button variant="primary" size="sm" onClick={() => setPublishing(p)} disabled={!canPublish}
                          title={!canPublish ? "Publish the issue first" : undefined}>Publish</Button>
                      )}
                    </div>
                  </div>
                  {p.status === "SCHEDULED" && !canPublish && <p className="mt-2 text-xs text-muted">This paper can be published once its issue is published.</p>}
                </Card>
              );
            })}
          </div>
        )
      )}

      {tab === "volumes" && <VolumesManager volumes={volumes} canManage={data.canManageVolumes} onChanged={load} notify={notify} />}

      {form && (
        <Modal open size="lg" onClose={() => setForm(null)} title={form.mode === "create" ? "Assign to issue" : "Edit publication"} eyebrow={form.mode === "create" ? form.eligible.title : form.publication.title}>
          <PublicationForm
            mode={form.mode}
            paperId={form.eligible?.paperId}
            publication={form.publication}
            defaults={form.eligible?.defaults}
            manuscripts={form.mode === "create" ? form.eligible.manuscripts : form.publication.manuscripts}
            volumes={volumes}
            onCancel={() => setForm(null)}
            onDone={(m) => { setForm(null); notify(m, "ok"); load(); setTab("records"); }}
          />
        </Modal>
      )}
      {publishing && (
        <Modal open onClose={() => setPublishing(null)} title="Publish this paper?"
          footer={<div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setPublishing(null)}>Cancel</Button><Button variant="primary" size="sm" onClick={() => publish(publishing)}>Publish</Button></div>}>
          <p className="text-sm text-ink">“{publishing.title}” becomes publicly visible and the record can no longer be edited.</p>
        </Modal>
      )}
    </>
  );
}
