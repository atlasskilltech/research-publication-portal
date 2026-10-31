import Link from "next/link";

// Public (no sign-in) layout for the published-research catalogue.
export const metadata = {
  title: "Publications — ATLAS SkillTech University Research Publication Portal",
  description: "Browse published research from ATLAS SkillTech University.",
};

export default function PublicLayout({ children }) {
  return (
    <div className="min-h-screen bg-soft">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/publications" className="font-display text-lg font-bold text-brand">ATLAS Research Publications</Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/publications" className="font-semibold text-ink hover:underline">Browse</Link>
            <Link href="/login" className="text-muted hover:text-ink">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="border-t border-line bg-white py-6 text-center text-xs text-muted">
        ATLAS SkillTech University · Research Publication Portal
      </footer>
    </div>
  );
}
