import Badge from "@/components/ui/Badge";

const META = {
  ACCEPT: { label: "Accept", cls: "bg-ok-soft text-ok border-ok/30" },
  MINOR_REVISION: { label: "Minor revision", cls: "bg-warn-soft text-warn border-warn/30" },
  MAJOR_REVISION: { label: "Major revision", cls: "bg-warn-soft text-warn border-warn/30" },
  REJECT: { label: "Reject", cls: "bg-danger-soft text-danger border-danger/30" },
};

export function DecisionBadge({ decision }) {
  const m = META[decision] || { label: decision, cls: "bg-soft-2 text-muted border-line" };
  return <Badge className={m.cls}>{m.label}</Badge>;
}
