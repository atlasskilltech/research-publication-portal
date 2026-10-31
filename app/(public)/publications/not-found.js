import Link from "next/link";

// Public 404 for unknown / unpublished papers, volumes and issues. Keeps
// anonymous visitors on the public site (the root 404 links to the dashboard,
// which would send them to sign in). Says nothing about whether an unpublished
// item exists.
export default function PublicNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-20 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="text-xl font-bold text-ink">Publication not found</h1>
      <p className="max-w-sm text-sm text-muted">This publication doesn&apos;t exist or isn&apos;t published.</p>
      <Link href="/publications" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
        Browse publications
      </Link>
    </div>
  );
}
