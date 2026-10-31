"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import Table from "@/components/ui/Table";
import EmptyState from "@/components/ui/EmptyState";
import { DecisionBadge } from "@/components/decisions/DecisionBadge";
import { RevisionStatusBadge } from "@/components/revisions/RevisionStatusBadge";

const CATEGORY = {
  AWAITING_DECISION: { label: "Awaiting decision", cls: "bg-warn-soft text-warn border-warn/30" },
  AWAITING_REVIEWS: { label: "Awaiting reviews", cls: "bg-soft-2 text-ink border-line" },
  REVISION: { label: "Revision", cls: "bg-soft-2 text-ink border-line" },
  ACCEPTED: { label: "Accepted", cls: "bg-ok-soft text-ok border-ok/30" },
  REJECTED: { label: "Rejected", cls: "bg-danger-soft text-danger border-danger/30" },
  OTHER: { label: "Other", cls: "bg-soft-2 text-muted border-line" },
};
const STATUSES = ["SUBMITTED", "UNDER_REVIEW", "REVISION", "ACCEPTED", "REJECTED"];
const DECISIONS = [["ACCEPT", "Accept"], ["MINOR_REVISION", "Minor revision"], ["MAJOR_REVISION", "Major revision"], ["REJECT", "Reject"]];

// Editorial dashboard (admins: all papers; editors: papers they edit). Author
// identities are never part of this data.
export default function EditorialPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [f, setF] = useState({ category: "", status: "", decision: "", editor: "", from: "", to: "" });
  const setFilter = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/editorial", { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Could not load the editorial dashboard.");
        setData(d);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const rows = useMemo(() => {
    const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : null;
    const to = f.to ? new Date(`${f.to}T23:59:59`).getTime() : null;
    return (data?.papers || []).filter((p) => {
      if (f.category && p.category !== f.category) return false;
      if (f.status && p.status !== f.status) return false;
      if (f.decision === "NONE" && p.decision) return false;
      if (f.decision && f.decision !== "NONE" && p.decision?.decision !== f.decision) return false;
      if (f.editor === "UNASSIGNED" && p.editors.length) return false;
      if (f.editor && f.editor !== "UNASSIGNED" && !p.editors.some((e) => e.id === f.editor)) return false;
      // Date filter: latest decision date if any, else submission date.
      const t = new Date(p.decision?.at || p.submittedAt).getTime();
      if (from && t < from) return false;
      if (to && t > to) return false;
      return true;
    });
  }, [data, f]);

  const s = data?.summary;
  const tiles = s ? [
    ["Awaiting decision", s.AWAITING_DECISION, "AWAITING_DECISION"],
    ["Awaiting reviews", s.AWAITING_REVIEWS, "AWAITING_REVIEWS"],
    ["Revision requested", s.REVISION, "REVISION"],
    ["Accepted", s.ACCEPTED, "ACCEPTED"],
    ["Rejected", s.REJECTED, "REJECTED"],
    ["Decisions made", s.completedDecisions, null],
    ["Pending reports", s.pendingReports, null],
    ["Overdue reviews", s.overdueReviews, null],
  ] : [];

  const columns = [
    {
      key: "title", header: "Paper", primary: true,
      render: (p) => (
        <div className="min-w-0">
          <a href={`/submissions/${p.id}`} className="font-semibold text-ink hover:underline">{p.title}</a>
          <p className="text-xs text-muted">{String(p.id).slice(0, 8)} · round {p.round + 1}</p>
        </div>
      ),
    },
    { key: "category", header: "Stage", render: (p) => <Badge className={CATEGORY[p.category].cls}>{CATEGORY[p.category].label}</Badge> },
    {
      key: "reports", header: "Reviewer reports",
      render: (p) => (
        <span className="text-xs text-ink">
          {p.reports.submitted}/{p.reports.assigned} in
          {p.reports.pending > 0 && <span className="text-muted"> · {p.reports.pending} pending</span>}
          {p.reports.overdue > 0 && <span className="text-danger"> · {p.reports.overdue} overdue</span>}
        </span>
      ),
    },
    {
      key: "decision", header: "Latest decision",
      render: (p) => p.decision ? (
        <span className="flex flex-wrap items-center gap-1">
          <DecisionBadge decision={p.decision.decision} />
          {!p.decision.released && <Badge className="bg-warn-soft text-warn border-warn/30">draft</Badge>}
          <span className="text-xs text-muted">{new Date(p.decision.at).toLocaleDateString()}</span>
        </span>
      ) : <span className="text-xs text-muted">—</span>,
    },
    { key: "revision", header: "Revision", render: (p) => (p.revision ? <span className="flex items-center gap-1"><span className="text-xs text-muted">#{p.revision.round}</span><RevisionStatusBadge status={p.revision.status} /></span> : <span className="text-xs text-muted">—</span>) },
    { key: "editors", header: "Editor", hideOnMobile: true, render: (p) => <span className="text-xs text-ink">{p.editors.map((e) => e.name || "—").join(", ") || <span className="text-muted">Unassigned</span>}</span> },
  ];

  return (
    <>
      <PageHeader eyebrow="Editorial" title="Editorial dashboard"
        subtitle={loading ? "Loading…" : data?.scope === "editor" ? "Papers you edit" : "All submissions"} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
      ) : error ? (
        <Card className="px-6 py-10 text-center text-sm text-danger">{error}</Card>
      ) : data.scope === "none" ? (
        <Card className="px-6 py-12"><EmptyState icon="papers" title="No papers to edit" message="Papers you are assigned to as Editor will appear here." /></Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {tiles.map(([label, n, cat]) => (
              <button key={label} type="button" disabled={!cat}
                onClick={() => cat && setF((x) => ({ ...x, category: x.category === cat ? "" : cat }))}
                className={`rounded-xl border bg-white px-4 py-3 text-left ${f.category && f.category === cat ? "border-brand" : "border-line"} ${cat ? "hover:bg-soft" : "cursor-default"}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
                <p className={`mt-1 font-display text-2xl font-bold ${label === "Overdue reviews" && n > 0 ? "text-danger" : "text-ink"}`}>{n}</p>
              </button>
            ))}
          </div>

          <Card className="mb-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Select label="Stage" value={f.category} onChange={setFilter("category")}
                options={[{ value: "", label: "All" }, ...Object.entries(CATEGORY).map(([v, m]) => ({ value: v, label: m.label }))]} />
              <Select label="Status" value={f.status} onChange={setFilter("status")}
                options={[{ value: "", label: "All" }, ...STATUSES.map((v) => ({ value: v, label: v }))]} />
              <Select label="Decision" value={f.decision} onChange={setFilter("decision")}
                options={[{ value: "", label: "All" }, { value: "NONE", label: "No decision yet" }, ...DECISIONS.map(([v, l]) => ({ value: v, label: l }))]} />
              <Select label="Editor" value={f.editor} onChange={setFilter("editor")}
                options={[{ value: "", label: "All" }, { value: "UNASSIGNED", label: "Unassigned" }, ...data.editors.map((e) => ({ value: e.id, label: e.name || e.id.slice(0, 8) }))]} />
              <Input type="date" label="From" value={f.from} onChange={setFilter("from")} />
              <Input type="date" label="To" value={f.to} onChange={setFilter("to")} />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted">
              <span>{rows.length} of {data.papers.length} papers · dates use the latest decision, or submission if none</span>
              <Button variant="outline" size="sm" onClick={() => setF({ category: "", status: "", decision: "", editor: "", from: "", to: "" })}>Clear filters</Button>
            </div>
          </Card>

          <Card className="p-2">
            <Table columns={columns} rows={rows} empty={<EmptyState icon="papers" title="No papers match" message="Try clearing some filters." />} />
          </Card>
        </>
      )}
    </>
  );
}
