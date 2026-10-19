"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import AssignRoleModal from "@/components/papers/AssignRoleModal";
import { cn } from "@/lib/cn";

export default function AccessRolesTab({ paper, roleKey }) {
  const [modalOpen, setModalOpen] = useState(false);
  const canManage = roleKey === "administrator" || roleKey === "spoc";
  const total = (paper.canOpen?.length || 0) + (paper.cannotOpen?.length || 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* roles on this paper */}
      <Card className="p-4 sm:p-5 lg:col-span-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Roles on this paper</p>
        <p className="mt-0.5 mb-3 text-xs text-muted">
          Roles are assigned to {paper.id} only — they do not carry over to any other paper.
        </p>
        <ul className="divide-y divide-line">
          {paper.rolesOnPaper.map((r) => (
            <li
              key={r.role}
              className={cn(
                "flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between",
                r.open && "-mx-2 rounded-lg border border-dashed border-warn/50 bg-warn-soft/40 px-2",
              )}
            >
              <div className="min-w-0">
                <Badge className="mb-1 border-brand/20 bg-brand-50 text-brand">{r.role}</Badge>
                {r.person ? (
                  <p className="text-sm text-ink">
                    <span className="font-semibold">{r.person}</span>
                    {r.email ? <span className="text-muted"> · {r.email}</span> : null}
                  </p>
                ) : (
                  <p className="text-sm text-ink">
                    <span className="font-semibold">No one assigned</span>
                    <span className="block text-xs text-muted">Peer review R2 cannot start until assigned</span>
                  </p>
                )}
                <p className="text-xs text-muted">{r.access}</p>
              </div>
              <div className="shrink-0">
                {r.tag ? (
                  <span className="text-xs font-semibold text-muted">{r.tag}</span>
                ) : canManage ? (
                  <Button variant={r.open ? "primary" : "outline"} size="sm" onClick={() => setModalOpen(true)}>
                    {r.open ? "Assign" : "Change"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* visibility */}
      <Card className="h-fit p-4 sm:p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Visibility</p>
        <p className="mt-1 text-3xl font-bold text-ink">
          {paper.canOpen?.length}
          <span className="text-base font-normal text-muted"> / {total} people can open this paper</span>
        </p>
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ok">Can open</p>
          <p className="mt-0.5 text-sm text-ink">{paper.canOpen?.join(", ")}</p>
        </div>
        {paper.cannotOpen?.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Cannot open</p>
            <p className="mt-0.5 text-sm text-muted">{paper.cannotOpen.join(", ")}</p>
          </div>
        )}
      </Card>

      <AssignRoleModal open={modalOpen} onClose={() => setModalOpen(false)} paper={paper} />
    </div>
  );
}
