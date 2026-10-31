"use client";

import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import Table from "@/components/ui/Table";
import { useRole } from "@/components/layout/RoleContext";

const REVIEW_STATUS = {
  PENDING: "bg-soft-2 text-muted border-line",
  DRAFT: "bg-warn-soft text-warn border-warn/30",
  SUBMITTED: "bg-ok-soft text-ok border-ok/30",
};
const ROLE_LABEL = { PEER_REVIEWER: "Peer Reviewer", DESK_REVIEWER: "Desk Reviewer", SPOC: "SPOC", EDITOR: "Editor" };

export default function ReviewsPage() {
  const { realRole } = useRole();
  return realRole === "administrator" ? <AdminMonitor /> : <ReviewerView />;
}

function ReviewerView() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/reviews", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load your assignments.");
        setItems(data.assignments || []);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <>
      <PageHeader eyebrow="Peer review" title="My reviews"
        subtitle={loading ? "Loading…" : `${items.length} assigned paper${items.length === 1 ? "" : "s"}`} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
      ) : error ? (
        <Card className="px-6 py-10 text-center text-sm text-danger">{error}</Card>
      ) : items.length === 0 ? (
        <Card className="px-6 py-12"><EmptyState icon="checks" title="No papers assigned" message="Papers assigned to you for review will appear here. Author identities are hidden (double-blind)." /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((a) => (
            <Card key={`${a.paperId}:${a.role}`} className="flex flex-col p-5">
              <div className="mb-2 flex items-center gap-2">
                <Badge className="bg-brand text-white border-brand">{ROLE_LABEL[a.role] || a.role}</Badge>
                <Badge className={REVIEW_STATUS[a.reviewStatus] || REVIEW_STATUS.PENDING}>{a.reviewStatus}</Badge>
                {a.isRevision && <Badge className="bg-warn-soft text-warn border-warn/30">Revised · round {a.round + 1}</Badge>}
                {!a.openForReview && a.reviewStatus !== "SUBMITTED" && (
                  <Badge className="bg-soft-2 text-muted border-line">{a.paperStatus === "REVISION" ? "Awaiting revision" : a.paperStatus === "SUBMITTED" ? "Not yet open" : "Review closed"}</Badge>
                )}
              </div>
              <h2 className="font-display text-lg font-bold text-ink">{a.title}</h2>
              <p className="mt-1 line-clamp-3 text-sm text-muted">{a.abstract || "No abstract."}</p>
              {a.keywords?.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.keywords.slice(0, 6).map((k) => <Badge key={k} className="bg-soft-2 text-muted border-line">{k}</Badge>)}
                </div>
              )}
              <div className="mt-3 flex items-center gap-3 text-xs text-muted">
                <span>Assigned {new Date(a.assignedAt).toLocaleDateString()}</span>
                {a.dueAt && <span className="text-warn">· Due {new Date(a.dueAt).toLocaleDateString()}</span>}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button href={`/submissions/${a.paperId}`} variant="primary" size="sm">
                  <Icon name="papers" size={14} /> {a.reviewStatus === "SUBMITTED" || !a.openForReview ? "View" : a.reviewStatus === "DRAFT" ? "Continue review" : a.isRevision ? "Review revision" : "Start review"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

const REC_LABEL = { ACCEPT: "Accept", MINOR_REVISION: "Minor Revision", MAJOR_REVISION: "Major Revision", REJECT: "Reject" };
const DEADLINE = {
  overdue: { label: "Overdue", cls: "bg-danger-soft text-danger border-danger/30" },
  due_soon: { label: "Due soon", cls: "bg-warn-soft text-warn border-warn/30" },
  on_track: { label: "On track", cls: "bg-soft-2 text-muted border-line" },
  done: { label: "Done", cls: "bg-ok-soft text-ok border-ok/30" },
  none: { label: "No deadline", cls: "bg-soft-2 text-muted border-line" },
};
const FILTERS = [
  { key: "all", label: "All" },
  { key: "PENDING", label: "Not started" },
  { key: "DRAFT", label: "In draft" },
  { key: "SUBMITTED", label: "Submitted" },
  { key: "overdue", label: "Overdue" },
];

// Administrator: review progress across every paper.
function AdminMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/reviews", { cache: "no-store" });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Could not load review monitoring.");
        setData(d);
      } catch (e) { setError(e.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const rows = useMemo(() => {
    const all = (data?.rows || []).map((r) => ({ ...r, key: `${r.paperId}:${r.reviewer}:${r.role}` }));
    if (filter === "all") return all;
    if (filter === "overdue") return all.filter((r) => r.deadline === "overdue");
    return all.filter((r) => r.reviewStatus === filter);
  }, [data, filter]);

  const s = data?.summary;
  const columns = [
    {
      key: "paper", header: "Paper", primary: true,
      render: (r) => <a href={`/submissions/${r.paperId}`} className="font-semibold text-ink hover:underline">{r.paperTitle || "Untitled"}</a>,
    },
    {
      key: "reviewer", header: "Reviewer",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{r.reviewerName || r.reviewerEmail || r.reviewer}</p>
          <p className="truncate text-xs text-muted">{ROLE_LABEL[r.role] || r.role}</p>
        </div>
      ),
    },
    { key: "status", header: "Review", render: (r) => <Badge className={REVIEW_STATUS[r.reviewStatus] || REVIEW_STATUS.PENDING}>{r.reviewStatus}</Badge> },
    { key: "rec", header: "Recommendation", render: (r) => (r.recommendation ? REC_LABEL[r.recommendation] || r.recommendation : <span className="text-muted">—</span>) },
    {
      key: "due", header: "Deadline",
      render: (r) => (
        <span className="flex items-center gap-2">
          <Badge className={DEADLINE[r.deadline]?.cls}>{DEADLINE[r.deadline]?.label}</Badge>
          {r.dueAt && <span className="text-xs text-muted">{new Date(r.dueAt).toLocaleDateString()}</span>}
        </span>
      ),
    },
    { key: "assigned", header: "Assigned", hideOnMobile: true, render: (r) => <span className="text-xs text-muted">{new Date(r.assignedAt).toLocaleDateString()}</span> },
  ];

  return (
    <>
      <PageHeader eyebrow="Peer review" title="Review monitoring"
        subtitle={loading ? "Loading…" : "Reviewer progress across all submissions"} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner /> Loading…</div>
      ) : error ? (
        <Card className="px-6 py-10 text-center text-sm text-danger">{error}</Card>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[["Assigned", s.assigned], ["Not started", s.pending], ["In draft", s.draft], ["Submitted", s.submitted], ["Overdue", s.overdue]].map(([label, n]) => (
              <Card key={label} className="px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
                <p className={`mt-1 font-display text-2xl font-bold ${label === "Overdue" && n > 0 ? "text-danger" : "text-ink"}`}>{n}</p>
              </Card>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button key={f.key} size="sm" variant={filter === f.key ? "primary" : "outline"} onClick={() => setFilter(f.key)}>{f.label}</Button>
            ))}
          </div>
          <Card className="p-2">
            <Table columns={columns} rows={rows} keyField="key"
              empty={<EmptyState icon="checks" title="No reviews here" message="Assign peer or desk reviewers from a submission's page." />} />
          </Card>
        </>
      )}
    </>
  );
}
