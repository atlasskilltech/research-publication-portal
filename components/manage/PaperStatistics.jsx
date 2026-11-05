"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/layout/PageHeader";
import KpiCard from "@/components/layout/KpiCard";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";

const ROLE_OPTIONS = [
  { value: "", label: "All roles" }, { value: "STUDENT", label: "Student" }, { value: "FACULTY", label: "Faculty" },
  { value: "AUTHOR", label: "Author" }, { value: "POC", label: "POC (SPOC)" }, { value: "REVIEWER", label: "Reviewer" },
  { value: "EDITOR", label: "Editor" }, { value: "ADMIN", label: "Admin" },
];
const STATUS_OPTIONS = [
  { value: "", label: "All paper statuses" }, { value: "SUBMITTED", label: "Submitted" }, { value: "UNDER_REVIEW", label: "Under review" },
  { value: "REVISION", label: "Revision" }, { value: "ACCEPTED", label: "Accepted" }, { value: "PUBLISHED", label: "Published" },
  { value: "REJECTED", label: "Rejected" }, { value: "ARCHIVED", label: "Archived" },
];
const SORT_OPTIONS = [
  { value: "total_desc", label: "Total papers (high → low)" }, { value: "total_asc", label: "Total papers (low → high)" },
  { value: "submitted_desc", label: "Submitted (high → low)" }, { value: "assigned_desc", label: "Assigned (high → low)" },
  { value: "name_asc", label: "Name (A → Z)" },
];
const STATUS_CLS = {
  SUBMITTED: "bg-soft-2 text-muted border-line", UNDER_REVIEW: "bg-warn-soft text-warn border-warn/30", REVISION: "bg-warn-soft text-warn border-warn/30",
  ACCEPTED: "bg-ok-soft text-ok border-ok/30", PUBLISHED: "bg-ok-soft text-ok border-ok/30", REJECTED: "bg-danger-soft text-danger border-danger/30",
  ARCHIVED: "bg-soft-2 text-muted border-line",
};
const PAGE_SIZE = 25;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const statusLabel = (s) => STATUS_OPTIONS.find((o) => o.value === s)?.label || s;

function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <span className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </span>
    </div>
  );
}

const Num = ({ v, strong }) => <span className={`tabular-nums ${strong ? "font-bold text-ink" : v ? "text-ink" : "text-muted"}`}>{v}</span>;

/** Admin-only "Paper statistics": summary cards, user-wise table, per-user paper list. */
export default function PaperStatistics() {
  const [filters, setFilters] = useState({ search: "", role: "", status: "", sort: "total_desc", includeZero: true });
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailUser, setDetailUser] = useState(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError("");
    const qs = new URLSearchParams({ ...filters, includeZero: filters.includeZero ? "1" : "0", page: String(page), pageSize: String(PAGE_SIZE) });
    try {
      const res = await fetch(`/api/admin/stats?${qs}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (!res.ok) throw new Error(body.error || "Could not load paper statistics.");
      setData(body);
    } catch (e) {
      if (my === seq.current) setError(e.message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const s = data?.summary;
  const statusNote = filters.status ? `Counting only ${statusLabel(filters.status).toLowerCase()} papers` : "All paper statuses";

  return (
    <>
      <PageHeader eyebrow="Administration" title="Paper statistics"
        subtitle="How many papers each person is associated with, as author, POC, reviewer or editor. Counts come straight from the database."
        action={<Button variant="outline" onClick={load} disabled={loading}>Refresh</Button>} />

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="Summary">
        <KpiCard label="Total papers" value={s ? s.totalPapers : "—"} />
        <KpiCard label="Total authors" value={s ? s.authorAccounts : "—"} note={s ? `Author accounts · ${s.usersWithPapers} users have authored papers` : undefined} />
        <KpiCard label="Total reviewers" value={s ? s.reviewers : "—"} note="Desk + peer reviewer role" />
        <KpiCard label="Total POCs" value={s ? s.pocs : "—"} note="SPOC role" />
        <KpiCard label="Under review" value={s ? s.underReview : "—"} />
        <KpiCard label="Accepted papers" value={s ? s.accepted : "—"} note="Accepted + published" />
      </section>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1.2fr_auto] xl:items-end">
        <Input label="Search" placeholder="Name or email…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} aria-label="Search users" />
        <Select label="Role" options={ROLE_OPTIONS} value={filters.role} onChange={(e) => setFilter("role", e.target.value)} />
        <Select label="Paper status" options={STATUS_OPTIONS} value={filters.status} onChange={(e) => setFilter("status", e.target.value)} />
        <Select label="Sort" options={SORT_OPTIONS} value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)} />
        <label className="flex items-center gap-2 pb-2.5 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4" checked={filters.includeZero} onChange={(e) => setFilter("includeZero", e.target.checked)} />
          Show users with 0 papers
        </label>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold text-ink">User-wise paper overview</p>
          <p className="text-xs text-muted">{statusNote}{data ? ` · ${data.total} user${data.total === 1 ? "" : "s"}` : ""}</p>
        </div>
        {error ? (
          <div className="px-5 py-10 text-center text-sm text-danger">{error}<div className="mt-3"><Button variant="outline" size="sm" onClick={load}>Retry</Button></div></div>
        ) : !data && loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted"><Spinner /> Loading…</div>
        ) : data.users.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted">No users match these filters.</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-soft text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <th className="px-4 py-2.5">User</th><th className="px-3 py-2.5">Role</th>
                    {["Total papers", "Submitted", "Assigned", "Under review", "Accepted", "Rejected"].map((h) => <th key={h} className="px-3 py-2.5 text-right">{h}</th>)}
                  </tr>
                </thead>
                <tbody className={`divide-y divide-line ${loading ? "opacity-60" : ""}`}>
                  {data.users.map((u) => (
                    <tr key={u.id} className="cursor-pointer hover:bg-soft" onClick={() => setDetailUser(u)}>
                      <td className="px-4 py-3">
                        <button type="button" className="text-left font-semibold text-ink hover:underline" onClick={(e) => { e.stopPropagation(); setDetailUser(u); }}>{u.name}</button>
                        <p className="break-all text-xs text-muted">{u.email}</p>
                      </td>
                      <td className="px-3 py-3"><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} className="bg-soft-2 text-ink border-line">{r}</Badge>)}</div></td>
                      <td className="px-3 py-3 text-right"><Num v={u.total} strong /></td>
                      <td className="px-3 py-3 text-right"><Num v={u.submitted} /></td>
                      <td className="px-3 py-3 text-right"><Num v={u.assigned} /></td>
                      <td className="px-3 py-3 text-right"><Num v={u.underReview} /></td>
                      <td className="px-3 py-3 text-right"><Num v={u.accepted} /></td>
                      <td className="px-3 py-3 text-right"><Num v={u.rejected} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul className={`divide-y divide-line md:hidden ${loading ? "opacity-60" : ""}`}>
              {data.users.map((u) => (
                <li key={u.id}>
                  <button type="button" className="w-full px-4 py-3 text-left" onClick={() => setDetailUser(u)}>
                    <p className="font-semibold text-ink">{u.name}</p>
                    <p className="break-all text-xs text-muted">{u.email}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} className="bg-soft-2 text-ink border-line">{r}</Badge>)}</div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      {[["Total", u.total], ["Submitted", u.submitted], ["Assigned", u.assigned], ["Under review", u.underReview], ["Accepted", u.accepted], ["Rejected", u.rejected]].map(([k, v]) => (
                        <div key={k}><dt className="text-muted">{k}</dt><dd className="font-semibold tabular-nums text-ink">{v}</dd></div>
                      ))}
                    </dl>
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-muted">
        Submitted = papers the person submitted or is listed on as an author (matched by email). Assigned = papers assigned to them as POC, reviewer or editor.
        Each paper is counted once per person, however many author rows or assignments link them. Accepted includes published papers.
      </p>

      <UserPapersModal user={detailUser} status={filters.status} onClose={() => setDetailUser(null)} />
    </>
  );
}

function UserPapersModal({ user, status, onClose }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { setPage(1); setData(null); setError(""); }, [user?.id, status]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const qs = new URLSearchParams({ status: status || "", page: String(page), pageSize: String(PAGE_SIZE) });
        const res = await fetch(`/api/admin/stats/users/${encodeURIComponent(user.id)}?${qs}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) throw new Error(body.error || "Could not load papers.");
        setData(body);
      } catch (e) { if (alive) setError(e.message); }
    })();
    return () => { alive = false; };
  }, [user, status, page]);

  return (
    <Modal open={!!user} onClose={onClose} size="lg" eyebrow="Associated papers" title={user ? `${user.name}` : ""}>
      {user && (
        <div>
          <p className="break-all text-xs text-muted">{user.email} · {user.roles.join(", ") || "—"}{status ? ` · only ${statusLabel(status).toLowerCase()} papers` : ""}</p>
          {error ? <p className="mt-4 text-sm text-danger">{error}</p> : !data ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted"><Spinner /> Loading…</div>
          ) : data.papers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No papers associated with this user{status ? " in this status" : ""}.</p>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-line">
                {data.papers.map((p) => (
                  <li key={p.id} className="py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/submissions/${p.id}`} className="font-semibold text-ink hover:underline">{p.title}</Link>
                        <p className="text-xs text-muted" title={p.id}>ID {p.id.slice(0, 8)} · Submitted {fmtDate(p.submittedAt)} · Updated {fmtDate(p.updatedAt)}</p>
                      </div>
                      <Badge className={STATUS_CLS[p.status] || STATUS_CLS.SUBMITTED}>{statusLabel(p.status)}</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {p.relationshipLabels.map((r) => <Badge key={r} className="bg-brand/5 text-brand border-brand/20">{r}</Badge>)}
                      <Link href={`/submissions/${p.id}`} className="ml-auto text-xs font-semibold text-accent hover:underline">Open paper →</Link>
                    </div>
                  </li>
                ))}
              </ul>
              {data.total > data.pageSize && (
                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span>{(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}</span>
                  <span className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
