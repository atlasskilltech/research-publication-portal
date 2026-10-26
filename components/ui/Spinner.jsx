import { cn } from "@/lib/cn";

/**
 * Spinner — accessible loading indicator.
 */
export default function Spinner({ size = 20, className = "", label = "Loading" }) {
  return (
    <span role="status" aria-label={label} className={cn("inline-flex", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin text-brand-light"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/**
 * Skeleton — grey placeholder block for loading states.
 */
export function Skeleton({ className = "" }) {
  return <div className={cn("animate-pulse rounded-md bg-soft-2", className)} />;
}

/**
 * LoadingBlock — centered spinner with a message, for page-level loading.
 */
export function LoadingBlock({ message = "Loading…", className = "" }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-line bg-white px-6 py-12 text-center", className)}>
      <Spinner size={28} />
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
