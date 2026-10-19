"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import EmptyState from "@/components/ui/EmptyState";
import { cn } from "@/lib/cn";
import { ARCHIVE_VOLUMES, ARCHIVE_YEARS } from "@/lib/mockManage";

/** VolumeCover — the dark double-bordered cover tile. */
function VolumeCover({ no }) {
  return (
    <div className="flex aspect-[4/3] items-center justify-center bg-ink p-3">
      <div className="flex h-full w-full items-center justify-center border-2 border-white/80">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-white">Vol {no}</span>
      </div>
    </div>
  );
}

function ArchiveCard({ v }) {
  return (
    <Card className="overflow-hidden">
      <VolumeCover no={v.no} />
      <div className="p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <Icon name="archive" size={14} /> Archived
          </span>
          <Badge className="bg-soft-2 text-muted border-line">{v.year}</Badge>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <h3 className="text-xl font-bold text-ink">Volume {v.no}</h3>
          <span className="shrink-0 text-xs text-muted">{v.count} papers</span>
        </div>
        <p className="text-sm font-semibold text-ink">{v.title}</p>

        {v.papers.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            {v.papers.map((p) => (
              <li key={p.id} className="flex gap-2">
                <span className="w-16 shrink-0 font-mono text-xs font-semibold text-ink">{p.id}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{p.title}</span>
              </li>
            ))}
            {v.more > 0 && <li className="text-xs font-semibold text-muted">+ {v.more} more</li>}
          </ul>
        )}

        <div className="mt-3 border-t border-line pt-3 font-mono text-xs text-muted">
          <p>LOCKED · {v.lockedBy} · {v.lockedAt}</p>
          <p>SENT · {v.sentBy} · {v.sentAt}</p>
        </div>

        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm">
            <Icon name="download" size={15} /> Download PDF
          </Button>
          <Button variant="outline" size="sm" className="text-warn border-warn/40 hover:bg-warn-soft">Restore</Button>
        </div>
      </div>
    </Card>
  );
}

export default function ArchiveList() {
  const [year, setYear] = useState("all");
  const [q, setQ] = useState("");

  const byYear = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matches = (v) =>
      !query ||
      v.title.toLowerCase().includes(query) ||
      v.no.includes(query) ||
      v.papers.some((p) => p.id.toLowerCase().includes(query) || p.title.toLowerCase().includes(query));

    return ARCHIVE_YEARS.map((y) => ({
      year: y,
      volumes: ARCHIVE_VOLUMES.filter((v) => v.year === y && (year === "all" || year === y) && matches(v)),
    })).filter((g) => g.volumes.length > 0);
  }, [year, q]);

  const yearCount = (y) => ARCHIVE_VOLUMES.filter((v) => v.year === y).length;
  const totalShown = byYear.reduce((n, g) => n + g.volumes.length, 0);

  return (
    <>
      <Link href="/volumes" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <Icon name="chevron" size={16} className="rotate-90" /> Back to active volumes
      </Link>

      <PageHeader
        eyebrow="Archive · sent for publishing"
        title="Publication archive"
        subtitle="4 volumes across 3 academic years. Read-only — restore only if genuinely needed."
        action={
          <div className="w-full sm:w-80">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, paper id, student, school…" aria-label="Search archive" />
          </div>
        }
      />

      {/* year filter */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
          <Icon name="calendar" size={14} /> Academic year
        </span>
        <YearChip label="All years" count={ARCHIVE_VOLUMES.length} active={year === "all"} onClick={() => setYear("all")} />
        {ARCHIVE_YEARS.map((y) => (
          <YearChip key={y} label={y} count={yearCount(y)} active={year === y} onClick={() => setYear(y)} />
        ))}
      </div>

      {totalShown === 0 ? (
        <EmptyState icon="archive" title="No volumes found" message="No archived volumes match your search in the selected academic year." />
      ) : (
        <div className="space-y-8">
          {byYear.map((g) => (
            <section key={g.year}>
              <div className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
                <h2 className="text-lg font-bold text-ink">{g.year}</h2>
                <span className="text-xs text-muted">{g.volumes.length} volume{g.volumes.length > 1 ? "s" : ""}</span>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {g.volumes.map((v) => <ArchiveCard key={v.no} v={v} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function YearChip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors",
        active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-soft",
      )}
    >
      {label}
      <span className={cn("text-xs", active ? "text-white/80" : "text-muted")}>{count}</span>
    </button>
  );
}
