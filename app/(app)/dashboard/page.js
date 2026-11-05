"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/layout/PageHeader";
import KpiCard from "@/components/layout/KpiCard";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Spinner from "@/components/ui/Spinner";
import { DecisionBadge } from "@/components/decisions/DecisionBadge";
import { RevisionStatusBadge, TYPE_LABEL } from "@/components/revisions/RevisionStatusBadge";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const STATUS_CLS = {
  SUBMITTED: "bg-soft-2 text-muted border-line",
  UNDER_REVIEW: "bg-warn-soft text-warn border-warn/30",
  REVISION: "bg-warn-soft text-warn border-warn/30",
  ACCEPTED: "bg-ok-soft text-ok border-ok/30",
  REJECTED: "bg-danger-soft text-danger border-danger/30",
  PUBLISHED: "bg-ok-soft text-ok border-ok/30",
};
const ROLE_LABEL = { ADMINISTRATOR: "Administrators", SPOC: "SPOC", DESK_REVIEWER: "Desk reviewers", PEER_REVIEWER: "Peer reviewers", EDITOR: "Editors" };

function Section({ title, action, children }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Real, capability-based dashboard (data from /api/dashboard).
export default function DashboardPage() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load your dashboard.");
        setD(data);
      } catch (e) { setError(e.message); }
    })();
  }, []);

  if (error) return <Card className="px-6 py-12 text-center text-sm text-danger">{error}</Card>;
  if (!d) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Spinner /> Loading…</div>;

  const a = d.author;
  const firstName = String(d.name || "").split(/[\s@]/)[0];
  const ext = d.externalAuthor; // only for external AUTHOR accounts (AIDC 2026)

  return (
    <>
      <PageHeader eyebrow={ext ? `Author dashboard · ${ext.conference}` : `Overview · ${new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`}
        title={ext ? `Welcome, ${firstName}.` : `Hello, ${firstName}.`}
        subtitle={ext
          ? `Submit your research papers for ${ext.conference} and follow their review here.`
          : "Your submissions, reviews and editorial work at a glance."}
        action={<Button href="/submit" variant="primary" size="sm">Submit a paper</Button>} />

      {ext && <AuthorProfileSection ext={ext} name={d.name} />}

      {/* ---- Author ---- */}
      <Section title="My submissions" action={<Link href="/submissions" className="text-xs font-semibold text-accent hover:underline">View all</Link>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Submitted" value={a.counts.total} />
          <KpiCard label="In review" value={a.counts.inReview} />
          <KpiCard label="Revision" value={a.counts.revision} note={a.actionNeeded.length ? `${a.actionNeeded.length} need action` : undefined} />
          <KpiCard label="Accepted" value={a.counts.accepted} />
          <KpiCard label="Published" value={a.counts.published} />
          <KpiCard label="Rejected" value={a.counts.rejected} />
        </div>

        {a.actionNeeded.length > 0 && (
          <Card className="mt-4 border-warn/40 p-4">
            <p className="text-sm font-semibold text-ink">Action needed</p>
            <ul className="mt-2 divide-y divide-line">
              {a.actionNeeded.map((r) => (
                <li key={r.paperId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{r.title}</p>
                    <p className="text-xs text-muted">Revision {r.round} · {TYPE_LABEL[r.type]}{r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ""}</p>
                  </div>
                  <span className="flex items-center gap-2">
                    <RevisionStatusBadge status={r.status} />
                    <Button href={`/submissions/${r.paperId}/revision`} variant="primary" size="sm">Open</Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <p className="text-sm font-semibold text-ink">Recent submissions</p>
            {a.recent.length === 0 ? (
              <p className="mt-2 text-sm text-muted">You haven&apos;t submitted a paper yet. <Link href="/submit" className="font-semibold text-accent hover:underline">Submit one</Link>.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {a.recent.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/submissions/${p.id}`} className="min-w-0 truncate text-sm text-ink hover:underline">{p.title}</Link>
                    <Badge className={STATUS_CLS[p.status] || STATUS_CLS.SUBMITTED}>{p.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4">
            <p className="text-sm font-semibold text-ink">Latest decisions</p>
            {a.recentDecisions.length === 0 ? <p className="mt-2 text-sm text-muted">No editorial decisions yet.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {a.recentDecisions.map((x, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/submissions/${x.paperId}`} className="min-w-0 truncate text-sm text-ink hover:underline">{x.title}</Link>
                    <span className="flex items-center gap-2"><DecisionBadge decision={x.decision} /><span className="text-xs text-muted">{fmtDate(x.at)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      {/* ---- Reviewer ---- */}
      {d.reviewer && (
        <Section title="My reviews" action={<Link href="/reviews" className="text-xs font-semibold text-accent hover:underline">Open reviews</Link>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="To do" value={d.reviewer.counts.toDo} />
            <KpiCard label="Overdue" value={d.reviewer.counts.overdue} />
            <KpiCard label="Due soon" value={d.reviewer.counts.dueSoon} />
            <KpiCard label="Submitted" value={d.reviewer.counts.submitted} />
          </div>
          {d.reviewer.toDo.length > 0 && (
            <Card className="mt-4 p-4">
              <ul className="divide-y divide-line">
                {d.reviewer.toDo.map((r) => (
                  <li key={r.paperId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{r.title}</p>
                      <p className="text-xs text-muted">{r.round > 0 ? `Revised submission · round ${r.round + 1}` : "Original submission"}{r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ""}</p>
                    </div>
                    <span className="flex items-center gap-2">
                      {r.deadline === "overdue" && <Badge className="bg-danger-soft text-danger border-danger/30">Overdue</Badge>}
                      {r.deadline === "due_soon" && <Badge className="bg-warn-soft text-warn border-warn/30">Due soon</Badge>}
                      <Button href={`/submissions/${r.paperId}`} variant="outline" size="sm">{r.status === "DRAFT" ? "Continue" : "Start"}</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>
      )}

      {/* ---- Editorial + publication ---- */}
      {d.editorial && (
        <Section title="Editorial" action={<Link href="/editorial" className="text-xs font-semibold text-accent hover:underline">Editorial dashboard</Link>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Awaiting decision" value={d.editorial.AWAITING_DECISION} />
            <KpiCard label="Awaiting reviews" value={d.editorial.AWAITING_REVIEWS} />
            <KpiCard label="Pending reports" value={d.editorial.pendingReports} />
            <KpiCard label="Overdue reviews" value={d.editorial.overdueReviews} />
            <KpiCard label="In revision" value={d.editorial.REVISION} />
            <KpiCard label="Accepted" value={d.editorial.ACCEPTED} />
          </div>
        </Section>
      )}
      {d.publication && (
        <Section title="Publication" action={<Link href="/publications/manage" className="text-xs font-semibold text-accent hover:underline">Manage publications</Link>}>
          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Awaiting publication" value={d.publication.awaiting} />
            <KpiCard label="Scheduled" value={d.publication.scheduled} />
            <KpiCard label="Published" value={d.publication.published} />
          </div>
        </Section>
      )}

      {/* ---- People (admin) ---- */}
      {d.people && (
        <Section title="People & roles" action={<span className="flex gap-3"><Link href="/statistics" className="text-xs font-semibold text-accent hover:underline">Paper statistics</Link><Link href="/users" className="text-xs font-semibold text-accent hover:underline">Manage people</Link></span>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
            <KpiCard label="Accounts" value={d.people.total} />
            <KpiCard label="Students" value={d.people.students} />
            <KpiCard label="Faculty" value={d.people.faculty} />
            <KpiCard label="Authors (AIDC)" value={d.people.authors ?? 0} />
            {Object.entries(d.people.byRole).map(([k, v]) => <KpiCard key={k} label={ROLE_LABEL[k]} value={v} />)}
          </div>
        </Section>
      )}
    </>
  );
}

/** External author (AIDC 2026): profile + recent notifications (own papers only). */
function AuthorProfileSection({ ext, name }) {
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/activity?limit=5", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        setFeed(res.ok ? data.activity || [] : []);
      } catch { setFeed([]); }
    })();
  }, []);
  const p = ext.profile;
  const rows = [
    ["Email", ext.email], ["Phone", p?.phone], ["Organization / Institution", p?.organization],
    ["Current status", p?.currentStatus], ["Designation / Role / Course", p?.designation], ["Location", p?.location],
  ];
  return (
    <Section title="Author profile" action={<Link href="/account" className="text-xs font-semibold text-accent hover:underline">Account settings</Link>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="text-xs text-muted">External author · {ext.conference}</p>
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-xs text-muted">{k}</dt><dd className="break-words font-semibold text-ink">{v || "—"}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button href="/submit" variant="primary" size="sm">Submit paper</Button>
            <Button href="/submissions" variant="outline" size="sm">My submissions</Button>
            <Button href="/revisions" variant="outline" size="sm">Revision requests</Button>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <Link href="/activity" className="text-xs font-semibold text-accent hover:underline">View all</Link>
          </div>
          {feed === null ? <p className="mt-2 text-sm text-muted">Loading…</p> : feed.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No updates yet. You&apos;ll see submission, review, revision and decision updates for your papers here, and we&apos;ll email you too.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {feed.map((n) => (
                <li key={n.id} className="py-2">
                  <p className="text-sm text-ink">{n.label}{n.decision ? `: ${n.decision}` : ""}</p>
                  <p className="truncate text-xs text-muted">
                    {n.paperId ? <Link href={`/submissions/${n.paperId}`} className="hover:underline">{n.paperTitle || "Your paper"}</Link> : n.paperTitle}
                    {" · "}{fmtDate(n.at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Section>
  );
}
