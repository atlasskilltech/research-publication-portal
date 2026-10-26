import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Input — labelled text field with optional hint + error.
 * Works as a controlled or uncontrolled input.
 */
export default function Input({
  label,
  hint,
  error,
  id,
  className = "",
  containerClassName = "",
  required = false,
  ...rest
}) {
  const autoId = useId();
  const inputId = id || autoId;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label} {required && <span className="text-accent">*</span>}
        </label>
      )}
      <input
        id={inputId}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy}
        className={cn(
          "w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/60",
          "transition-colors focus:border-brand-light",
          error ? "border-danger" : "border-line",
          className,
        )}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-err`} className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
