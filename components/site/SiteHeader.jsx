import Link from "next/link";
import BrandLogo from "@/components/layout/BrandLogo";

/**
 * Header shared by every public page: the landing page (/) and the published
 * research catalogue (/publications/…). Section links point at the landing
 * page (/#policy …) so they work from any public page.
 */
export const SITE_NAV = [
  ["/#policy", "Policy"],
  ["/#incentives", "Incentives"],
  ["/#conferences", "Conference support"],
  ["/#seed-funding", "Seed funding"],
  ["/#guidelines", "Guidelines"],
];

function Arrow({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}

/** "Login" → /login, or "Open dashboard" for a signed-in visitor. */
export function LoginButton({ signedIn, size = "md", label, className = "" }) {
  const pad = size === "lg" ? "px-6 py-3 text-[15px]" : "px-4 py-2 text-sm";
  return (
    <Link
      href={signedIn ? "/dashboard" : "/login"}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white shadow-sm transition hover:bg-brand-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${pad} ${className}`}
    >
      {label || (signedIn ? "Open dashboard" : "Login")} <Arrow />
    </Link>
  );
}

/** `active` = "publications" highlights the Publications link. */
export default function SiteHeader({ signedIn = false, active = null }) {
  const pubActive = active === "publications";
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="ATLAS Research — home"><BrandLogo /></Link>
        <nav className="hidden items-center gap-6 text-sm lg:flex" aria-label="Sections">
          {SITE_NAV.map(([href, label]) => (
            <a key={href} href={href} className="font-medium text-muted transition hover:text-ink">{label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/publications"
            aria-current={pubActive ? "page" : undefined}
            className={`text-sm font-medium hover:text-ink ${pubActive ? "inline text-ink" : "hidden text-muted sm:inline"}`}
          >
            Publications
          </Link>
          <LoginButton signedIn={signedIn} />
        </div>
      </div>
    </header>
  );
}
