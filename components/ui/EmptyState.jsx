import Icon from "@/components/ui/Icon";
import { cn } from "@/lib/cn";

/**
 * EmptyState — shown when a list or view has no data.
 */
export default function EmptyState({
  title = "Nothing here yet",
  message = "There's nothing to show right now.",
  icon = "inbox",
  action,
  className = "",
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-white px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted">
        <Icon name={icon} size={24} />
      </span>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
