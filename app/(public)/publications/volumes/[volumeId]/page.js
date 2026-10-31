import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedVolume } from "@/lib/publicCatalog";
import PublicPaperCard from "@/components/publications/PublicPaperCard";

export const dynamic = "force-dynamic";

// Public volume page: published issues and their published papers.
export default async function VolumePage({ params }) {
  const { volumeId } = await params;
  let data = null;
  try { data = await getPublishedVolume(volumeId); } catch { data = null; }
  if (!data) notFound();
  const { volume, publications } = data;

  return (
    <div>
      <p className="text-xs text-muted"><Link href="/publications" className="hover:underline">Publications</Link> / Volume {volume.number}</p>
      <h1 className="mt-1 font-display text-3xl font-bold text-ink">Volume {volume.number} ({volume.year})</h1>
      <p className="text-ink">{volume.title}</p>
      {volume.description && <p className="mt-2 max-w-3xl text-sm text-muted">{volume.description}</p>}

      {volume.issues.length === 0 && <p className="mt-6 text-sm text-muted">No issues published in this volume yet.</p>}
      {volume.issues.map((i) => {
        const papers = publications.filter((p) => p.issue.id === i.id);
        return (
          <section key={i.id} className="mt-8">
            <h2 className="font-display text-xl font-bold text-ink">
              <Link href={`/publications/issues/${i.id}`} className="hover:underline">Issue {i.number}: {i.title}</Link>
            </h2>
            {i.publicationDate && <p className="text-xs text-muted">Published {i.publicationDate}</p>}
            <div className="mt-3 space-y-3">
              {papers.length === 0 ? <p className="text-sm text-muted">No papers in this issue yet.</p> : papers.map((p) => <PublicPaperCard key={p.id} p={p} showIssue={false} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
