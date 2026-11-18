import Link from "next/link";

/** Simple "coming soon" panel for public pages that aren't ready yet. */
export default function ComingSoon({ eyebrow, title, text, links = [] }) {
  return (
    <>
      <div className="orbit right-[-160px] top-[-120px] h-[520px] w-[520px]" aria-hidden="true" />
      <div className="orbit left-[-200px] bottom-[-160px] h-[440px] w-[440px]" aria-hidden="true" />
      <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-20 text-center sm:px-6 sm:py-28">
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-brand">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {eyebrow}
        </p>
        <h1 className="mt-5 font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">{title}</h1>
        <p className="mt-3 text-xl font-semibold text-accent">Coming soon</p>
        {text && <p className="mt-4 max-w-lg text-[15px] text-muted">{text}</p>}
        {links.length > 0 && (
          <p className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className="font-semibold text-accent hover:underline">{label}</Link>
            ))}
          </p>
        )}
      </div>
    </>
  );
}
