import Badge from "@/components/ui/Badge";

export const TYPE_LABEL = { MINOR: "Minor revision", MAJOR: "Major revision" };

const META = {
  REVISION_REQUESTED: { label: "Revision requested", cls: "bg-warn-soft text-warn border-warn/30" },
  REVISION_IN_PROGRESS: { label: "In progress", cls: "bg-soft-2 text-ink border-line" },
  REVISION_SUBMITTED: { label: "Revision submitted", cls: "bg-ok-soft text-ok border-ok/30" },
  REVISION_UNDER_REVIEW: { label: "Under re-review", cls: "bg-brand text-white border-brand" },
  REVISION_OVERDUE: { label: "Overdue", cls: "bg-danger-soft text-danger border-danger/30" },
};

export function RevisionStatusBadge({ status }) {
  const m = META[status] || { label: status, cls: "bg-soft-2 text-muted border-line" };
  return <Badge className={m.cls}>{m.label}</Badge>;
}
