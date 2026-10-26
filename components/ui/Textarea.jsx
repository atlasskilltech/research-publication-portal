import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Textarea — labelled multi-line input.
 */
export default function Textarea({ label, hint, id, className = "", containerClassName = "", rows = 3, ...rest }) {
  const autoId = useId();
  const taId = id || autoId;
  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && (
        <label htmlFor={taId} className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </label>
      )}
      <textarea
        id={taId}
        rows={rows}
        className={cn(
          "w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/60",
          "transition-colors focus:border-brand-light",
          className,
        )}
        {...rest}
      />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
