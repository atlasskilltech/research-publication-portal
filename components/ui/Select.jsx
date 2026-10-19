import { useId } from "react";
import { cn } from "@/lib/cn";
import Icon from "@/components/ui/Icon";

/**
 * Select — styled native <select> (accessible, works without JS).
 * options = [{ value, label }] or array of strings.
 */
export default function Select({
  label,
  hint,
  error,
  id,
  options = [],
  placeholder,
  className = "",
  containerClassName = "",
  ...rest
}) {
  const autoId = useId();
  const selectId = id || autoId;
  const normalised = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );

  return (
    <div className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && (
        <label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          aria-invalid={error ? "true" : undefined}
          className={cn(
            "w-full appearance-none rounded-lg border bg-white px-3.5 py-2.5 pr-10 text-sm text-ink",
            "transition-colors focus:border-brand-light",
            error ? "border-danger" : "border-line",
            className,
          )}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {normalised.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Icon name="chevron" size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
