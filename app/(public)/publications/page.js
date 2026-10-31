import Link from "next/link";
import { getPublishedCatalog } from "@/lib/publicCatalog";
import { matchesSearch } from "@/lib/publicationLogic";
import PublicPaperCard from "@/components/publications/PublicPaperCard";

export const dynamic = "force-dynamic";

// Public catalogue: published papers only (search by title / author / keyword,
// filter by year and issue). Server-rendered; the filter form is a plain GET.
export default async function PublicationsPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const q = String(sp.q || "").slice(0, 200);
  const year = Number(sp.year) || null;
  const issueId = String(sp.issue || "");

  let catalog;
  try {
    catalog = await getPublishedCatalog();
  } catch {
    return <p className="rounded-xl border border-line bg-white p-8 text-center text-sm text-muted">Publications are temporarily unavailable.</p>;
  }
  const { volumes, publications } = catalog;
  const years = [...new Set(volumes.map((v) => v.year))].sort((a, b) => b - a);
  const issues = volumes.filter((v) => !year || v.year === year).flatMap((v) => v.issues.map((i) => ({ ...i, label: `Vol. ${v.number} (${v.year}) · Issue ${i.number}` })));
  const results = publications.filter((p) => (!year || p.year === year) && (!issueId || p.issue.id === issueId) && matchesSearch(p, q));
  const filtered = q || year || issueId;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">
      <section>
        <h1 className="font-display text-3xl font-bold text-ink">Published research</h1>
        <form method="get" className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-line bg-white p-4 sm:grid-cols-[1fr_120px_200px_auto]">
          <label className="sr-only" htmlFor="q">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Search title, author or keyword"
            className="rounded-lg border border-line px-3 py-2 text-sm" />
          <label className="sr-only" htmlFor="year">Year</label>
          <select id="year" name="year" defaultValue={year || ""} className="rounded-lg border border-line px-3 py-2 text-sm">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <label className="sr-only" htmlFor="issue">Issue</label>
          <select id="issue" name="issue" defaultValue={issueId} className="rounded-lg border border-line px-3 py-2 text-sm">
            <option value="">All issues</option>
            {issues.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
          <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>

        <p className="mt-4 text-sm text-muted">
          {results.length} paper{results.length === 1 ? "" : "s"}{filtered ? " found" : " published"}
          {filtered && <> · <Link href="/publications" className="text-accent hover:underline">clear</Link></>}
        </p>
        <div className="mt-3 space-y-4">
          {results.length === 0
            ? <p className="rounded-xl border border-line bg-white p-8 text-center text-sm text-muted">{filtered ? "No published papers match your search." : "Nothing has been published yet."}</p>
            : results.map((p) => <PublicPaperCard key={p.id} p={p} />)}
        </div>
      </section>

      <aside>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Volumes</h2>
        {volumes.length === 0 ? <p className="mt-2 text-sm text-muted">No volumes published yet.</p> : (
          <ul className="mt-2 space-y-3">
            {volumes.map((v) => (
              <li key={v.id} className="rounded-xl border border-line bg-white p-3">
                <Link href={`/publications/volumes/${v.id}`} className="font-semibold text-ink hover:underline">Volume {v.number} ({v.year})</Link>
                <p className="text-xs text-muted">{v.title}</p>
                <ul className="mt-2 space-y-1">
                  {v.issues.map((i) => (
                    <li key={i.id}>
                      <Link href={`/publications/issues/${i.id}`} className="text-sm text-accent hover:underline">Issue {i.number}: {i.title}</Link>
                      <span className="text-xs text-muted"> · {i.paperCount}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
