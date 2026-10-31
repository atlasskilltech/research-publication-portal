"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import Badge from "@/components/ui/Badge";
import { useRole } from "@/components/layout/RoleContext";

const STATUS_CLS = {
  SUBMITTED: "bg-soft-2 text-muted border-line",
  UNDER_REVIEW: "bg-warn-soft text-warn border-warn/30",
  REVISION: "bg-warn-soft text-warn border-warn/30",
  ACCEPTED: "bg-ok-soft text-ok border-ok/30",
  REJECTED: "bg-danger-soft text-danger border-danger/30",
  PUBLISHED: "bg-ok-soft text-ok border-ok/30",
  ARCHIVED: "bg-soft-2 text-muted border-line",
};

export default function SubmissionsPage() {
  const { realRole } = useRole();
  const isAdmin = realRole === "administrator";
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/papers", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load submissions.");
      setPapers(data.papers || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return papers;
    return papers.filter((p) => p.title.toLowerCase().includes(s) || (p.correspondingAuthor || "").toLowerCase().includes(s));
  }, [papers, q]);

  return (
    <>
      <PageHeader
        eyebrow={isAdmin ? "Administration" : "Your submissions"}
        title={isAdmin ? "All submissions" : "My papers"}
        subtitle={loading ? "Loading…" : `${papers.length} paper${papers.length === 1 ? "" : "s"}`}
        action={<Button href="/submit"><Icon name="plus" size={16} /> Submit new paper</Button>}
      />

      <Card className="mb-5 p-4">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input placeholder="Search title or corresponding author…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search submissions" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="hidden border-b border-line bg-soft px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted md:grid md:grid-cols-[2fr_1fr_0.8fr_0.8fr_auto] md:gap-3">
          <span>Title</span><span>Corresponding author</span><span>Status</span><span>Submitted</span><span className="text-right">Open</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted"><Spinner /> Loading…</div>
        ) : error ? (
          <div className="px-5 py-10 text-center text-sm text-danger">{error}<div className="mt-3"><Button variant="outline" size="sm" onClick={load}>Retry</Button></div></div>
        ) : shown.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState icon="submissions" title={q ? "No matches" : "No papers yet"}
              message={q ? "Try a different search." : "Your submitted papers will appear here."}
              action={!q && <Button href="/submit" size="sm"><Icon name="plus" size={14} /> Submit new paper</Button>} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 px-4 py-3.5 sm:px-5 md:grid md:grid-cols-[2fr_1fr_0.8fr_0.8fr_auto] md:items-center md:gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{p.title}</p>
                  <p className="text-xs text-muted">{p.authorCount} author{p.authorCount === 1 ? "" : "s"}</p>
                </div>
                <div className="truncate text-sm text-muted">{p.correspondingAuthor || "—"}</div>
                <div><Badge className={STATUS_CLS[p.status] || STATUS_CLS.SUBMITTED}>{p.status}</Badge></div>
                <div className="text-xs text-muted">{new Date(p.createdAt).toLocaleDateString()}</div>
                <div className="md:text-right"><Button href={`/submissions/${p.id}`} variant="outline" size="sm">Open</Button></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
