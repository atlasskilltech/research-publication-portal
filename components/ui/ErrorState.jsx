import Icon from "@/components/ui/Icon";
import Button from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * ErrorState — friendly error panel with an optional retry action.
 */
export default function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this content. Please try again.",
  onRetry,
  className = "",
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-danger/30 bg-danger-soft px-6 py-12 text-center",
        className,
      )}
      role="alert"
    >
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-danger">
        <Icon name="alert" size={24} />
      </span>
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {onRetry && (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
        </div>
      )}
    </div>
  );
}
