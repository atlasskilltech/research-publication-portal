import Link from "next/link";
import BrandLogo from "@/components/layout/BrandLogo";

/**
 * Header shared by every public page: / and /aidc (coming soon), /aidc/register,
 * sign-in / register, and the published research catalogue (/publications/…).
 * The Research Promotion Policy is internal (faculty & admins) and lives inside
 * the portal at /research-policy, so it is not linked here.
 */

function Arrow({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
    </svg>
  );
}

/** "Login" → /login, or "Open dashboard" for a signed-in visitor. */
export function LoginButton({ signedIn, size = "md", label, className = "" }) {
  const pad = size === "lg" ? "px-6 py-3 text-[15px]" : "px-3 py-2 text-sm sm:px-4";
  return (
    <Link
      href={signedIn ? "/dashboard" : "/login"}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white shadow-sm transition hover:bg-brand-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${pad} ${className}`}
    >
      {label || (signedIn ? "Open dashboard" : "Login")} <Arrow />
    </Link>
  );
}

/**
 * Public header: the logo only, for now (no Publications / Register / Login
 * buttons). Sign-in is at /login, which links to /register and /aidc/register.
 * Props are accepted (and ignored) so existing callers keep working.
 */
// eslint-disable-next-line no-unused-vars
export default function SiteHeader({ signedIn = false, active = null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="ATLAS Research — home"><BrandLogo /></Link>
      </div>
    </header>
  );
}
