import Image from "next/image";
import { cn } from "@/lib/cn";
import { BRAND } from "@/lib/constants";

/**
 * AtlasCube — the official ATLAS SkillTech University circle mark
 * (public/brand/atlas-circle.svg, from https://atlasuniversity.edu.in/brand/).
 * Served as-is (unoptimized) so the official vector stays crisp and unaltered.
 */
export function AtlasCube({ size = 40, className = "" }) {
  return (
    <Image
      src="/brand/atlas-circle.svg"
      alt="ATLAS SkillTech University"
      width={size}
      height={size}
      className={className}
      unoptimized
    />
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
