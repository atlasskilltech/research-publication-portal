import { cn } from "@/lib/cn";

/** Paper reference ID chip (e.g. ISDI-2026-0001). Renders nothing when the paper has none. */
export default function RefId({ value, className = "" }) {
  if (!value) return null;
  return (
    <span
      className={cn("inline-flex items-center rounded border border-line bg-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-ink whitespace-nowrap", className)}
      title="Paper reference ID"
    >
      {value}
    </span>
  );
}
