import { cn } from "@/lib/cn";
import { STATUS_META, PHASE_LABEL, SCHOOL_CHIP } from "@/lib/constants";

/**
 * Badge — generic small pill. Pass `className` for custom colours,
 * or use the specialised helpers below.
 */
export default function Badge({ children, className = "" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.none;
  return <Badge className={meta.cls}>{meta.label}</Badge>;
}

export function PhaseBadge({ phase }) {
  return <Badge className="bg-brand-50 text-brand border-brand/20">{PHASE_LABEL[phase] || phase}</Badge>;
}

export function SchoolChip({ school }) {
  return (
    <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-bold text-white", SCHOOL_CHIP[school] || "bg-muted")}>
      {school}
    </span>
  );
}
