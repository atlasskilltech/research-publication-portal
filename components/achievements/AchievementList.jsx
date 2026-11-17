"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Select from "@/components/ui/Select";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import Badge, { SchoolChip } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import {
  ACHIEVEMENT_TYPES, ACHIEVEMENT_TYPE_KEYS, ACHIEVEMENT_SCHOOLS, SCHOOL_LABEL, STATUS_LABEL, AFFILIATION_LABEL,
  detailPairs, formatInr, recentAcademicYears,
} from "@/lib/achievementTypes";

const STATUS_CLS = {
  SUBMITTED: "bg-warn-soft text-warn border-warn/30",
  VERIFIED: "bg-ok-soft text-ok border-ok/30",
  REJECTED: "bg-danger-soft text-danger border-danger/30",
};

const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

function Kpi({ label, value, tone }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("mt-0.5 text-2xl font-bold tabular-nums", tone || "text-ink")}>{value}</p>
    </Card>
  );
}

function ReviewActions({ a, onUpdated }) {
  const [note, setNote] = useState(a.reviewNote || "");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function act(status) {
    setBusy(status); setErr("");
    try {
      const res = await fetch(`/api/achievements/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not update.");
      onUpdated(data.achievement);
    } catch (e) { setErr(e.message); }
    finally { setBusy(""); }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-soft/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Check this entry</p>
      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note to the faculty member (needed when rejecting)"
        aria-label="Review note"
        className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted/60"
      />
      <div className="flex flex-wrap gap-2">
        {a.status !== "VERIFIED" && <Button size="sm" onClick={() => act("VERIFIED")} disabled={!!busy}>{busy === "VERIFIED" ? "Saving…" : "Verify"}</Button>}
        {a.status !== "REJECTED" && <Button size="sm" variant="danger" onClick={() => act("REJECTED")} disabled={!!busy}>{busy === "REJECTED" ? "Saving…" : "Reject"}</Button>}
        {a.status !== "SUBMITTED" && <Button size="sm" variant="outline" onClick={() => act("SUBMITTED")} disabled={!!busy}>Move back to awaiting check</Button>}
      </div>
      {err && <p className="text-xs text-danger">{err}</p>}
    </div>
  );
}

function DeleteButton({ a, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function del() {
    setBusy(true); setErr("");
    try {
      const res = await fetch(`/api/achievements/${a.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete.");
      onDeleted(a.id);
    } catch (e) { setErr(e.message); setBusy(false); }
  }
  if (!confirming) return <Button size="sm" variant="ghost" className="text-danger" onClick={() => setConfirming(true)}>Delete</Button>;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-ink">
      Delete this entry and its documents?
      <Button size="sm" variant="danger" onClick={del} disabled={busy}>{busy ? "Deleting…" : "Yes, delete"}</Button>
      <Button size="sm" variant="outline" onClick={() => setConfirming(false)} disabled={busy}>Keep</Button>
      {err && <span className="w-full text-danger">{err}</span>}
    </span>
  );
}

function Details({ a, admin, onUpdated, onDeleted }) {
  const def = ACHIEVEMENT_TYPES[a.type];
  const pairs = detailPairs(a.type, a.details);
  const slotLabel = (slot) => def?.files.find((s) => s.slot === slot)?.label || slot;
  const canDelete = admin || a.status !== "VERIFIED";
  return (
    <div className="flex flex-col gap-4 bg-soft/40 px-4 py-4 sm:px-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {pairs.map((p) => (
          <div key={p.key} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{p.label}</dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-ink">{p.key === "supporting_link" ? <a href={p.value} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">{p.value}</a> : p.value}</dd>
          </div>
        ))}
        {a.affiliation && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{def?.affiliation?.label || "Affiliated with ATLAS"}</dt>
            <dd className="mt-0.5 text-ink">{def?.affiliation?.options.find((o) => o.value === a.affiliation)?.label || AFFILIATION_LABEL[a.affiliation]}</dd>
          </div>
        )}
      </dl>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Documents</p>
        <ul className="flex flex-col gap-1.5">
          {a.files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-2 text-sm">
              <Icon name="papers" size={16} className="text-muted" />
              <a href={`/api/achievements/${a.id}/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">{f.name}</a>
              <span className="text-xs text-muted">· {slotLabel(f.slot)}</span>
            </li>
          ))}
        </ul>
      </div>

      {a.reviewNote && (
        <p className={cn("rounded-lg border px-3 py-2 text-sm", a.status === "REJECTED" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-white text-ink")}>
          <b>Note from {a.reviewerName || "the administrator"}:</b> {a.reviewNote}
        </p>
      )}

      {admin && <ReviewActions a={a} onUpdated={onUpdated} />}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>Submitted {fmtDate(String(a.createdAt).slice(0, 10))}{a.reviewedAt ? ` · checked ${fmtDate(String(a.reviewedAt).slice(0, 10))}` : ""}</span>
        {canDelete && <DeleteButton a={a} onDeleted={onDeleted} />}
      </div>
    </div>
  );
}

/**
 * Achievement table. `admin` = the Administrator's view of everyone's records
 * (filters, verify/reject, CSV export); otherwise the signed-in user's own.
 */
export default function AchievementList({ admin = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ type: "", school: "", year: "", status: "" });

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (admin) {
      p.set("scope", "all");
      for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    }
    return p.toString();
  }, [admin, f]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/achievements${query ? `?${query}` : ""}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load achievements.");
      setItems(data.achievements || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const money = items.filter((a) => a.amountInr != null).reduce((s, a) => s + a.amountInr, 0);
    return {
      total: items.length,
      verified: items.filter((a) => a.status === "VERIFIED").length,
      waiting: items.filter((a) => a.status === "SUBMITTED").length,
      money,
    };
  }, [items]);

  const years = useMemo(() => recentAcademicYears(6), []);
  const exportHref = `/api/achievements/export?${new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString()}`;
  const cols = admin ? "md:grid-cols-[2.2fr_1.3fr_0.6fr_0.9fr_0.9fr_0.9fr_auto]" : "md:grid-cols-[2.4fr_0.6fr_0.9fr_0.9fr_0.9fr_auto]";

  const update = (a) => setItems((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...a } : x)));
  const remove = (id) => { setItems((prev) => prev.filter((x) => x.id !== id)); setOpen(null); };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total" value={loading ? "…" : stats.total} />
        <Kpi label="Verified" value={loading ? "…" : stats.verified} tone="text-ok" />
        <Kpi label="Awaiting check" value={loading ? "…" : stats.waiting} tone="text-warn" />
        <Kpi label="Consultancy + grants" value={loading ? "…" : formatInr(stats.money) || "₹0"} />
      </div>

      {admin && (
        <Card className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}
              options={[{ value: "", label: "All types" }, ...ACHIEVEMENT_TYPE_KEYS.map((k) => ({ value: k, label: ACHIEVEMENT_TYPES[k].name }))]} />
            <Select label="School" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })}
              options={[{ value: "", label: "All schools" }, ...ACHIEVEMENT_SCHOOLS.map((s) => ({ value: s, label: SCHOOL_LABEL[s] }))]} />
            <Select label="Academic year (Jul–Jun)" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}
              options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: y, label: `AY ${y}` }))]} />
            <Select label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
              options={[{ value: "", label: "Any status" }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
          </div>
          <a href={exportHref} className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-soft">
            <Icon name="download" size={16} /> Export to Excel (CSV)
          </a>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className={cn("hidden border-b border-line bg-soft px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted md:grid md:gap-3", cols)}>
          <span>Achievement</span>{admin && <span>Name</span>}<span>School</span><span>Date</span><span>Amount</span><span>Status</span><span className="text-right">Details</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted"><Spinner /> Loading…</div>
        ) : error ? (
          <div className="px-5 py-10 text-center text-sm text-danger">{error}<div className="mt-3"><Button variant="outline" size="sm" onClick={load}>Retry</Button></div></div>
        ) : items.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              icon="award"
              title={admin ? "No achievements match" : "No achievements yet"}
              message={admin ? "Try different filters." : "Record your reviewer roles, awards, fellowships, consultancy and grants here, with proof attached."}
              action={!admin && <Button href="/achievements/new" size="sm"><Icon name="plus" size={14} /> Add achievement</Button>}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((a) => {
              const isOpen = open === a.id;
              return (
                <Fragment key={a.id}>
                  <li className={cn("flex flex-col gap-2 px-4 py-3.5 sm:px-5 md:grid md:items-center md:gap-3", cols)}>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink" title={a.title}>{a.title}</p>
                      <p className="text-xs font-semibold text-brand">{ACHIEVEMENT_TYPES[a.type]?.name || a.type}</p>
                    </div>
                    {admin && (
                      <div className="min-w-0 text-sm">
                        <p className="truncate text-ink">{a.ownerName}</p>
                        <p className="truncate text-xs text-muted">{a.ownerEmail}</p>
                      </div>
                    )}
                    <div><SchoolChip school={a.school} /></div>
                    <div className="text-sm tabular-nums text-muted">{fmtDate(a.achievementDate)}</div>
                    <div className="text-sm tabular-nums text-ink">{a.amountInr != null ? formatInr(a.amountInr) : <span className="text-muted">—</span>}</div>
                    <div><Badge className={STATUS_CLS[a.status]}>{STATUS_LABEL[a.status] || a.status}</Badge></div>
                    <div className="md:text-right">
                      <Button size="sm" variant="outline" onClick={() => setOpen(isOpen ? null : a.id)} aria-expanded={isOpen}>
                        {isOpen ? "Hide" : "View"}
                      </Button>
                    </div>
                  </li>
                  {isOpen && (
                    <li><Details a={a} admin={admin} onUpdated={update} onDeleted={remove} /></li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
