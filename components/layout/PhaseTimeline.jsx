import Card from "@/components/ui/Card";
import { PHASES } from "@/lib/constants";

const DOTS = ["bg-brand", "bg-brand-light", "bg-[#5a51a8]", "bg-[#8a7bd8]", "bg-teal"];

/**
 * PhaseTimeline — the five-phase pipeline strip. Horizontal scroll on
 * small screens, 5-up grid on large screens.
 */
export default function PhaseTimeline({ counts = {} }) {
  return (
    <section aria-label="Phase timeline">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Phase Timeline · 2025</h2>
      <div className="flex gap-3 overflow-x-auto scroll-thin pb-2 lg:grid lg:grid-cols-5 lg:overflow-visible lg:pb-0">
        {PHASES.map((phase, i) => (
          <Card key={phase.key} className="min-w-[220px] flex-1 p-4 lg:min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Phase 0{i + 1}</span>
              <span className={`h-3 w-3 rounded-sm ${DOTS[i]}`} />
            </div>
            <h3 className="mt-2 text-sm font-bold leading-snug text-ink">{phase.label}</h3>
            <p className="mt-1 text-[11px] text-muted">{phase.dates}</p>
            <p className="mt-3 text-2xl font-bold tabular-nums text-ink">
              {counts[phase.key] ?? 0}
              <span className="ml-1 text-xs font-normal text-muted">papers</span>
            </p>
            <p className="mt-2 text-xs text-muted">{phase.caption}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}
