"use client";

import PageHeader from "@/components/layout/PageHeader";
import ScopeBanner from "@/components/layout/ScopeBanner";
import KpiCard from "@/components/layout/KpiCard";
import PhaseTimeline from "@/components/layout/PhaseTimeline";
import Card, { CardHeader } from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import PapersTable from "@/components/papers/PapersTable";
import EmptyState from "@/components/ui/EmptyState";
import { useRole } from "@/components/layout/RoleContext";
import { MOCK_KPIS, KPI_CARDS, MOCK_PHASE_COUNTS, MOCK_PAPERS } from "@/lib/mock";

const ROLE_CARDS = [
  { label: "Submitter", value: "11", note: "people · default role" },
  { label: "SPOC", value: "1", note: "person · on 4 papers" },
  { label: "Desk Reviewer", value: "1", note: "person · on 1 paper" },
  { label: "Peer Reviewer", value: "3", note: "people · on 5 reviews" },
  { label: "Editor", value: "1", note: "person · on 6 papers" },
  { label: "Admin", value: "1", note: "person · all papers" },
];

export default function DashboardPage() {
  const { roleKey, user } = useRole();
  const kpis = MOCK_KPIS[roleKey] || MOCK_KPIS.administrator;
  const firstName = user.name.split(" ")[0];
  const isSubmitter = roleKey === "student" || roleKey === "faculty";
  const isAdmin = roleKey === "administrator";
  const phaseCounts = kpis.total === 0 ? {} : isAdmin ? MOCK_PHASE_COUNTS : { P5: kpis.accepted };
  const recent = isSubmitter ? [] : MOCK_PAPERS.slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="Overview · 01 Oct 2026"
        title={`Hello, ${firstName}.`}
        subtitle={
          isSubmitter
            ? "Upload once. Track your paper through Desk Review → Blind Peer Review → Volume categorisation."
            : "Publication pipeline — from 1,000 submissions to 8 volumes of 10."
        }
      />

      <ScopeBanner />

      {/* KPI row */}
      <section aria-label="Key metrics" className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {KPI_CARDS.map((c) => (
          <KpiCard key={c.key} label={c.label} value={kpis[c.key]} note={c.note} />
        ))}
      </section>

      {/* Roles & access (admin only) */}
      {isAdmin && (
        <section className="mb-7">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
            Roles &amp; access · who can do what
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {ROLE_CARDS.map((r) => (
              <Card key={r.label} className="p-3">
                <p className="text-xs font-semibold text-ink">{r.label}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{r.value}</p>
                <p className="mt-0.5 text-[11px] text-muted">{r.note}</p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Phase timeline */}
      <div className="mb-7">
        <PhaseTimeline counts={phaseCounts} />
      </div>

      {/* Recent papers */}
      <Card>
        <CardHeader
          eyebrow="Publication pipeline"
          title={isSubmitter ? "My papers" : "Recent papers"}
          action={
            isSubmitter ? (
              <Button href="/submit" size="sm" variant="primary">+ Submit new paper</Button>
            ) : (
              <Button href="/papers" size="sm" variant="outline">View all</Button>
            )
          }
        />
        <div className="p-4 sm:p-5">
          <PapersTable
            rows={recent}
            empty={
              <EmptyState
                icon="submissions"
                title="No papers in your view"
                message="You haven't submitted a paper yet. Start your first submission for the 2025–26 cycle."
                action={<Button href="/submit" size="sm">+ Submit new paper</Button>}
              />
            }
          />
        </div>
      </Card>
    </>
  );
}
