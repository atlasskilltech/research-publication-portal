import { cn } from "@/lib/cn";
import { BRAND } from "@/lib/constants";

/**
 * AtlasCube — inline SVG recreation of the ATLAS isometric-cube mark.
 * Used in place of a raster asset so it stays crisp at every size.
 */
export function AtlasCube({ size = 40, className = "" }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} className={className} aria-hidden="true">
      <polygon points="24,3 45,15 24,27 3,15" fill="#2fc3d6" />
      <polygon points="3,15 24,27 24,47 3,35" fill="#3b2f86" />
      <polygon points="45,15 24,27 24,47 45,35" fill="#2aa7bd" />
      <polygon points="29,23 38,43 20,43" fill="#ffffff" />
      <polygon points="29,30 33,40 25,40" fill="#2aa7bd" />
    </svg>
  );
}

/**
 * BrandLogo — the sidebar/app brand block: cube tile + two-line wordmark.
 */
export default function BrandLogo({ className = "", onDark = false }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand p-1">
        <AtlasCube size={28} />
      </span>
      <span className="leading-tight">
        <span className={cn("block text-[10px] font-bold uppercase tracking-[0.18em]", onDark ? "text-white/70" : "text-muted")}>
          {BRAND.eyebrow}
        </span>
        <span className={cn("block text-sm font-bold", onDark ? "text-white" : "text-ink")}>
          {BRAND.short}
        </span>
      </span>
    </div>
  );
}
