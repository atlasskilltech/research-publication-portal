"use client";

import { useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/layout/PageHeader";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Icon from "@/components/ui/Icon";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { READY_PAPERS, ACTIVE_VOLUMES, VOLUME_TARGET, VOLUME_GOAL } from "@/lib/mockManage";

const FILL_BATCH = 8;

function RRBadges() {
  return (
    <span className="flex shrink-0 gap-1">
      <Badge className="bg-ok-soft text-ok border-ok/30 px-1.5 py-0">R1</Badge>
      <Badge className="bg-ok-soft text-ok border-ok/30 px-1.5 py-0">R2</Badge>
    </span>
  );
}

function PaperCard({ p, onRemove }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Icon name="grip" size={16} className="shrink-0 text-muted" />
        <span className="font-mono text-xs text-muted">{p.id} · {p.school}</span>
        <span className="ml-auto flex items-center gap-1">
          <RRBadges />
          {onRemove && (
            <button type="button" onClick={onRemove} aria-label={`Remove ${p.id}`} className="rounded p-0.5 text-muted hover:text-danger">
              <Icon name="close" size={14} />
            </button>
          )}
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-ink">{p.title}</p>
      <p className="text-xs text-muted">{p.student}</p>
    </div>
  );
}

export default function VolumesBoard() {
  const [ready, setReady] = useState(READY_PAPERS);
  const [volumes, setVolumes] = useState(ACTIVE_VOLUMES);
  const [recipientsOpen, setRecipientsOpen] = useState(false);

  const placed = volumes.reduce((n, v) => n + v.papers.length, 0);
  const lockedCount = volumes.filter((v) => v.locked).length;

  /* move up to a batch of ready papers into a volume, respecting the per-volume target */
  const fillSmartly = (idx) => {
    setVolumes((vs) => {
      const vol = vs[idx];
      if (vol.locked) return vs;
      const space = VOLUME_TARGET - vol.papers.length;
      const take = Math.min(FILL_BATCH, space, ready.length);
      if (take <= 0) return vs;
      const moving = ready.slice(0, take);
      setReady((r) => r.slice(take));
      return vs.map((v, i) => (i === idx ? { ...v, papers: [...v.papers, ...moving] } : v));
    });
  };

  const removeFromVolume = (idx, paperId) => {
    setVolumes((vs) => {
      const vol = vs[idx];
      if (vol.locked) return vs;
      const paper = vol.papers.find((p) => p.id === paperId);
      if (paper) setReady((r) => [paper, ...r]);
      return vs.map((v, i) => (i === idx ? { ...v, papers: v.papers.filter((p) => p.id !== paperId) } : v));
    });
  };

  const toggleLock = (idx) =>
    setVolumes((vs) => vs.map((v, i) => (i === idx ? { ...v, locked: !v.locked } : v)));

  const addVolume = () =>
    setVolumes((vs) => {
      const nextNo = String(vs.reduce((m, v) => Math.max(m, Number(v.no)), 0) + 1).padStart(2, "0");
      return [...vs, { no: nextNo, title: "", papers: [], locked: false, lockedBy: null, lockedAt: null }];
    });

  return (
    <>
      <PageHeader
        eyebrow="Phase 5 · formatting & volumes"
        title="Volume categorisation"
        subtitle={`${volumes.length} active volumes · 4 archived · target ${VOLUME_TARGET} papers each`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRecipientsOpen(true)}>
              <Icon name="mail" size={16} /> Publications recipients
            </Button>
            <Button variant="primary" onClick={addVolume}>
              <Icon name="plus" size={16} /> Add volume
            </Button>
          </div>
        }
      />

      {/* stat strip */}
      <div className="mb-5 rounded-xl border border-line bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-6">
            <Stat label="Ready" value={ready.length} />
            <Stat label="Placed" value={placed} total={VOLUME_GOAL} tone="text-brand" />
            <Stat label="Locked" value={lockedCount} total={volumes.length} tone="text-ok" />
            <Stat label="Archived" value={4} />
          </div>
          <p className="text-xs text-muted">Ready → Placed → Locked → Archived</p>
        </div>
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft-2">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, (placed / VOLUME_GOAL) * 100)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>{placed}</span>
            <span>target · {VOLUME_GOAL}</span>
          </div>
        </div>
      </div>

      {/* board */}
      <div className="flex gap-4 overflow-x-auto scroll-thin pb-2">
        {/* Ready column */}
        <section className="flex w-72 shrink-0 flex-col rounded-xl border border-line bg-soft">
          <div className="flex items-center gap-2 px-4 pt-4">
            <Icon name="check" size={18} className="text-ok" />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Ready for volumes</p>
              <p className="text-xl font-bold text-ink">{ready.length}</p>
            </div>
          </div>
          <div className="flex-1 space-y-2 p-3">
            {ready.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted">All ready papers have been placed.</p>
            ) : (
              ready.map((p) => <PaperCard key={p.id} p={p} />)
            )}
          </div>
          <Link href="/papers" className="border-t border-line px-4 py-3 text-sm font-semibold text-brand hover:underline">
            View blind-review queue →
          </Link>
        </section>

        {/* Volume columns */}
        {volumes.map((v, idx) => (
          <section key={v.no} className="flex w-72 shrink-0 flex-col rounded-xl border border-line bg-white">
            <div className="flex items-start justify-between px-4 pt-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Volume</p>
                <p className="text-2xl font-bold text-ink">{v.no}</p>
              </div>
              <span className="text-xs font-semibold text-muted">{v.papers.length}/{VOLUME_TARGET}</span>
            </div>
            <div className="px-4 pt-1">
              {v.title ? (
                <p className="text-sm font-bold text-ink">{v.title}</p>
              ) : (
                <button type="button" className="text-sm font-semibold text-muted hover:text-ink">+ Add title</button>
              )}
            </div>

            <div className="flex-1 space-y-2 p-3">
              {!v.locked && v.papers.length < VOLUME_TARGET && ready.length > 0 && (
                <button
                  type="button"
                  onClick={() => fillSmartly(idx)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-brand/40 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-50/70"
                >
                  <Icon name="wand" size={16} /> Fill smartly with {Math.min(FILL_BATCH, VOLUME_TARGET - v.papers.length, ready.length)} papers
                </button>
              )}
              {v.papers.map((p) => (
                <PaperCard key={p.id} p={p} onRemove={v.locked ? null : () => removeFromVolume(idx, p.id)} />
              ))}
            </div>

            {v.locked && (
              <p className="px-4 pb-2 font-mono text-xs text-ok">
                LOCKED · {v.lockedBy || "You"} · {v.lockedAt || "today"}
              </p>
            )}
            <div className="flex gap-2 border-t border-line px-3 py-3">
              <Button variant="outline" size="sm" className="flex-1" disabled={v.locked}>Cover</Button>
              <Button variant={v.locked ? "subtle" : "outline"} size="sm" className="flex-1" onClick={() => toggleLock(idx)}>
                {v.locked ? "Unlock" : "Lock"}
              </Button>
            </div>
          </section>
        ))}

        {/* Add new volume */}
        <button
          type="button"
          onClick={addVolume}
          className="flex w-72 shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-soft/50 px-4 py-10 text-muted transition-colors hover:border-brand/40 hover:text-brand"
        >
          <Icon name="plus" size={28} />
          <span className="mt-2 text-[11px] font-semibold uppercase tracking-wider">Add new volume</span>
          <span className="text-xs text-muted">Volume {String(volumes.reduce((m, v) => Math.max(m, Number(v.no)), 0) + 1).padStart(2, "0")}</span>
        </button>
      </div>

      {/* archive footer link */}
      <Link
        href="/archive"
        className="mt-4 flex items-center justify-between rounded-xl border border-line bg-white px-4 py-3.5 text-sm hover:bg-soft sm:px-5"
      >
        <span className="flex items-center gap-2 font-semibold text-ink">
          <Icon name="archive" size={18} className="text-muted" /> Archive · sent for publishing
        </span>
        <span className="flex items-center gap-1 text-muted">4 volumes <Icon name="chevron" size={16} className="-rotate-90" /></span>
      </Link>

      <Modal
        open={recipientsOpen}
        onClose={() => setRecipientsOpen(false)}
        eyebrow="Volumes"
        title="Publications recipients"
        footer={<Button variant="outline" onClick={() => setRecipientsOpen(false)}>Close</Button>}
      >
        <p className="mb-3 text-sm text-muted">Locked volumes are emailed to these recipients when sent for publishing. (Email is mocked in this build.)</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {[
            { name: "Publications Desk", email: "publications@university.edu" },
            { name: "Ishi Srivastava", email: "editor@university.edu" },
            { name: "Dean's Office", email: "dean.office@university.edu" },
          ].map((r) => (
            <li key={r.email} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Icon name="mail" size={16} className="text-muted" />
              <span className="font-semibold text-ink">{r.name}</span>
              <span className="ml-auto text-muted">{r.email}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function Stat({ label, value, total, tone = "text-ink" }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={cn("text-xl font-bold tabular-nums", tone)}>
        {value}
        {total != null && <span className="text-sm font-semibold text-muted">/{total}</span>}
      </p>
    </div>
  );
}
