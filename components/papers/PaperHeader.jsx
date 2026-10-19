import Link from "next/link";
import Icon from "@/components/ui/Icon";
import Badge from "@/components/ui/Badge";

/**
 * PaperHeader — breadcrumb, title, byline, final-status badge and manuscript link.
 */
export default function PaperHeader({ paper, openSlot }) {
  return (
    <div className="mb-6">
      <Link href="/papers" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <Icon name="chevron" size={16} className="rotate-90" /> Back to papers
      </Link>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
            {paper.school} · {paper.editor?.phase || paper.phase}
          </p>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{paper.id}</p>
          <h1 className="mt-1 text-2xl font-bold text-ink sm:text-3xl">{paper.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {paper.author}
            {paper.guide && paper.guide !== "—" ? ` · Guide: ${paper.guide}` : ""}
          </p>
          {openSlot && (
            <Badge className="mt-2 bg-warn-soft text-warn border-warn/30">1 role slot open · {openSlot}</Badge>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {paper.finalBadge && (
            <Badge className="bg-ok-soft text-ok border-ok/30">{paper.finalBadge}</Badge>
          )}
          <a href="#" onClick={(e) => e.preventDefault()} className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
            Open manuscript <Icon name="external" size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
