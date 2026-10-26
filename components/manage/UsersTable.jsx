"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Modal from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import {
  PEOPLE_ACCOUNTS, ROLE_TAG, ROLE_TAG_ICON, ROLE_KEY, PEOPLE_FILTERS, ACCESS_RULES,
} from "@/lib/mockManage";

function RoleTag({ role, count }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold", ROLE_TAG[role] || "bg-soft-2 text-muted border-line")}>
      <Icon name={ROLE_TAG_ICON[role] || "users"} size={13} />
      {role}{count != null && <span className="opacity-70"> · {count}</span>}
    </span>
  );
}

export default function UsersTable() {
  const [filter, setFilter] = useState("ALL");
  const [manage, setManage] = useState(null); // person being managed
  const [addOpen, setAddOpen] = useState(false);

  const people = useMemo(
    () => (filter === "ALL" ? PEOPLE_ACCOUNTS : PEOPLE_ACCOUNTS.filter((p) => p.roles.some((r) => r.role === filter))),
    [filter],
  );
  const filterCount = (f) => (f === "ALL" ? PEOPLE_ACCOUNTS.length : PEOPLE_ACCOUNTS.filter((p) => p.roles.some((r) => r.role === f)).length);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="People & roles"
        subtitle={`${PEOPLE_ACCOUNTS.length} accounts · everyone starts as Submitter · roles are assigned per paper, never per person`}
        action={<Button variant="primary" onClick={() => setAddOpen(true)}><Icon name="userplus" size={16} /> Add person</Button>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        {/* table + filters */}
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap gap-2">
            <FilterChip label="ALL" count={filterCount("ALL")} active={filter === "ALL"} onClick={() => setFilter("ALL")} />
            {PEOPLE_FILTERS.map((f) => (
              <FilterChip key={f} label={f} count={filterCount(f)} active={filter === f} onClick={() => setFilter(f)} />
            ))}
          </div>

          <Card className="overflow-hidden">
            {/* header (md+) */}
            <div className="hidden border-b border-line bg-soft px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted md:grid md:grid-cols-[1.3fr_0.6fr_2fr_auto] md:gap-3">
              <span>Person</span><span>Base type</span><span>Roles · papers</span><span className="text-right">Manage</span>
            </div>

            <ul className="divide-y divide-line">
              {people.map((p) => (
                <li key={p.email} className="flex flex-col gap-3 px-4 py-3.5 sm:px-5 md:grid md:grid-cols-[1.3fr_0.6fr_2fr_auto] md:items-center md:gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{p.name}</p>
                    <p className="truncate text-xs text-muted">{p.email}</p>
                  </div>
                  <div className="text-sm text-muted">{p.base}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {p.roles.map((r) => <RoleTag key={r.role} role={r.role} count={r.count} />)}
                  </div>
                  <div className="md:text-right">
                    <Button variant="outline" size="sm" onClick={() => setManage(p)}>Manage</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* right rail */}
        <aside className="space-y-4">
          <Card className="p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Role key</p>
            <ul className="mt-3 space-y-3">
              {ROLE_KEY.map((r) => (
                <li key={r.role}>
                  <div className="flex items-center gap-2">
                    <RoleTag role={r.role} />
                    <span className="text-xs text-muted">{r.people} {r.people === 1 ? "person" : "people"}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{r.caption}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Access rules</p>
            <ul className="mt-3 space-y-2.5 text-sm text-muted">
              {ACCESS_RULES.map((rule, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      {/* Manage modal */}
      <Modal
        open={!!manage}
        onClose={() => setManage(null)}
        eyebrow="Manage person"
        title={manage?.name}
        footer={<Button variant="outline" onClick={() => setManage(null)}>Close</Button>}
      >
        {manage && (
          <>
            <p className="text-sm text-muted">{manage.email} · base type <b className="text-ink">{manage.base}</b></p>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">Roles on papers</p>
            {manage.roles.length ? (
              <ul className="mt-2 space-y-2">
                {manage.roles.map((r) => (
                  <li key={r.role} className="flex items-center justify-between rounded-lg border border-line bg-soft px-3 py-2">
                    <RoleTag role={r.role} count={r.count} />
                    <span className="text-xs text-muted">{r.count ? `${r.count} paper${r.count > 1 ? "s" : ""}` : "—"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">No per-paper roles yet.</p>
            )}
            <p className="mt-4 rounded-lg bg-soft-2 px-3 py-2 text-xs text-muted">
              Roles are granted per paper from a paper’s <b>Access &amp; roles</b> tab, never globally here. Editing people is mocked in this build.
            </p>
          </>
        )}
      </Modal>

      {/* Add person modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        eyebrow="Administration"
        title="Add person"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled>Add person</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Full name" placeholder="e.g. Aarav Nair" />
          <Input label="University email" type="email" placeholder="name@university.edu" hint="Must be a university address." />
          <Select label="Base type" options={["Student", "Faculty"]} defaultValue="Student" />
          <p className="rounded-lg bg-soft-2 px-3 py-2 text-xs text-muted">
            New accounts start as <b>Submitter</b> (own papers only). Reviewer / SPOC / Editor roles are assigned per paper later. Creating accounts is mocked in this build.
          </p>
        </div>
      </Modal>
    </>
  );
}

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-soft",
      )}
    >
      {label}
      <span className={cn(active ? "text-white/80" : "text-muted")}>· {count}</span>
    </button>
  );
}
