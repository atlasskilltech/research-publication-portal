import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublishedIssue } from "@/lib/publicCatalog";
import PublicPaperCard from "@/components/publications/PublicPaperCard";

export const dynamic = "force-dynamic";

// Public issue page: its published papers.
export default async function IssuePage({ params }) {
  const { issueId } = await params;
  let data = null;
  try { data = await getPublishedIssue(issueId); } catch { data = null; }
  if (!data) notFound();
  const { volume, issue, publications } = data;

  return (
    <div>
      <p className="text-xs text-muted">
        <Link href="/publications" className="hover:underline">Publications</Link> /{" "}
        <Link href={`/publications/volumes/${volume.id}`} className="hover:underline">Volume {volume.number} ({volume.year})</Link> / Issue {issue.number}
      </p>
      <h1 className="mt-1 font-display text-3xl font-bold text-ink">Issue {issue.number}: {issue.title}</h1>
      {issue.publicationDate && <p className="text-sm text-muted">Published {issue.publicationDate}</p>}
      {issue.description && <p className="mt-2 max-w-3xl text-sm text-muted">{issue.description}</p>}
      <div className="mt-6 space-y-3">
        {publications.length === 0 ? <p className="text-sm text-muted">No papers in this issue yet.</p> : publications.map((p) => <PublicPaperCard key={p.id} p={p} showIssue={false} />)}
      </div>
    </div>
  );
}
