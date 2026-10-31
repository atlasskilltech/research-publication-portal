import Link from "next/link";

/** Server-safe card for a PUBLIC (already-shaped) publication. */
export default function PublicPaperCard({ p, showIssue = true }) {
  return (
    <article className="rounded-xl border border-line bg-white p-5">
      <h3 className="font-display text-lg font-bold leading-snug text-ink">
        <Link href={`/publications/${p.id}`} className="hover:underline">{p.title}</Link>
      </h3>
      <p className="mt-1 text-sm text-ink">{p.authors.map((a) => a.name).join(", ")}</p>
      <p className="mt-1 text-xs text-muted">
        {showIssue && <>Vol. {p.volume.number}, Issue {p.issue.number} ({p.year})</>}
        {p.pages && <> · pp. {p.pages}</>}
        {p.publicationDate && <> · {p.publicationDate}</>}
        {p.doi && <> · DOI {p.doi}</>}
      </p>
      {p.abstract && <p className="mt-2 line-clamp-3 text-sm text-muted">{p.abstract}</p>}
      {p.keywords.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {p.keywords.slice(0, 8).map((k) => <li key={k} className="rounded-full border border-line bg-soft px-2 py-0.5 text-[11px] text-muted">{k}</li>)}
        </ul>
      )}
    </article>
  );
}
