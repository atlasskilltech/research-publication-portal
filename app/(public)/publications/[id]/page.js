import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedPublication } from "@/lib/publicCatalog";

export const dynamic = "force-dynamic";

// Public publication detail. Unpublished / scheduled / unknown ids → 404.
export default async function PublicationPage({ params }) {
  const { id } = await params;
  let p = null;
  try { p = await getPublishedPublication(id); } catch { p = null; }
  if (!p) notFound();

  return (
    <article className="mx-auto max-w-3xl rounded-xl border border-line bg-white p-6 sm:p-8">
      <p className="text-xs text-muted">
        <Link href={`/publications/volumes/${p.volume.id}`} className="hover:underline">Volume {p.volume.number} ({p.year})</Link>
        {" · "}
        <Link href={`/publications/issues/${p.issue.id}`} className="hover:underline">Issue {p.issue.number}: {p.issue.title}</Link>
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-ink">{p.title}</h1>
      <ul className="mt-3 space-y-0.5">
        {p.authors.map((a, i) => (
          <li key={i} className="text-sm text-ink">{a.name}{a.affiliation && <span className="text-muted"> — {a.affiliation}</span>}</li>
        ))}
      </ul>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-line py-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Published</dt><dd className="text-ink">{p.publicationDate || "—"}</dd></div>
        <div><dt className="text-xs text-muted">Pages</dt><dd className="text-ink">{p.pages || "—"}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-muted">DOI</dt><dd className="break-all text-ink">{p.doi || "—"}</dd></div>
      </dl>
      {p.abstract && (
        <section className="mt-5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Abstract</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{p.abstract}</p>
        </section>
      )}
      {p.keywords.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-1">
          {p.keywords.map((k) => (
            <li key={k}><Link href={`/publications?q=${encodeURIComponent(k)}`} className="rounded-full border border-line bg-soft px-2 py-0.5 text-xs text-muted hover:text-ink">{k}</Link></li>
          ))}
        </ul>
      )}
      <div className="mt-6">
        {p.manuscriptAvailable
          ? <a href={`/api/public/publications/${p.id}/manuscript`} className="inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Download full text</a>
          : <p className="text-xs text-muted">The full text is not available for download from this portal.</p>}
      </div>
    </article>
  );
}
