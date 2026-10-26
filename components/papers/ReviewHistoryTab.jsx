import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { ACTIVITY_BADGE } from "@/lib/mock";

/**
 * ReviewHistoryTab — append-only timeline of events on a paper.
 */
export default function ReviewHistoryTab({ paper }) {
  return (
    <Card className="p-4 sm:p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Review history</p>
      <ol className="relative ml-2 border-l border-line">
        {paper.history.map((h, i) => (
          <li key={i} className="mb-4 ml-5 last:mb-0">
            <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={ACTIVITY_BADGE[h.type]}>{h.type}</Badge>
              <span className="text-xs text-muted">{h.time}</span>
            </div>
            <p className="mt-1 text-sm text-ink">{h.text}</p>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">History is append-only — new reviews and decisions never overwrite earlier ones.</p>
    </Card>
  );
}
