import Link from "next/link";
import Image from "next/image";
import BrandLogo, { AtlasCube } from "@/components/layout/BrandLogo";
import LoginForm from "@/components/auth/LoginForm";
import FragmentScrubber from "@/components/auth/FragmentScrubber";
import { BRAND } from "@/lib/constants";
import { safeNextPath } from "@/lib/authFlow";

const STAGES = [
  ["01", "Shortlist"],
  ["02", "Desk"],
  ["03", "Peer R1"],
  ["04", "Peer R2"],
  ["05", "Volume"],
];
export const metadata = { title: "Sign in — Research Publication Portal" };

// kind: "ok" (green) | "warn" (amber). Keys arrive as ?notice=<key>.
const NOTICES = {
  password_created: { kind: "ok", text: "Your password has been created and your account is ready. Sign in with your registered email and new password." },
  password_reset: { kind: "ok", text: "Your password has been reset. Sign in with your email and new password." },
  link_invalid: { kind: "warn", text: "That setup link is invalid or has expired. Request a new setup email below." },
  link_expired: { kind: "warn", text: "That setup link has expired or has already been used. Request a new setup email below." },
};

export default async function LoginPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const notice = NOTICES[sp.notice];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* ---- Hero (desktop) ---- */}
      <aside className="relative hidden overflow-hidden border-r border-line p-10 lg:flex lg:flex-col lg:justify-between">
        <div className="orbit left-[-120px] top-[120px] h-[520px] w-[520px]" aria-hidden="true" />
        <div className="orbit left-[-40px] top-[260px] h-[360px] w-[360px]" aria-hidden="true" />
        <span className="absolute bottom-[-40px] left-[120px] h-40 w-40 rounded-full bg-[#c7d84a]/70 blur-[1px]" aria-hidden="true" />

        <div className="relative z-10">
          <BrandLogo />
        </div>

        <div className="relative z-10 max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">The 2025–26 Volume</p>
          <h1 className="mt-3 font-display text-5xl font-bold leading-[1.05] text-ink">
            Be the paper <br /> <span className="text-accent">they cite.</span>
          </h1>
          <p className="mt-5 max-w-sm text-sm text-muted">
            Five stages of scrutiny stand between your draft and the page. Track every one.
          </p>
          <ol className="mt-6 flex flex-wrap gap-2">
            {STAGES.map(([n, label]) => (
              <li key={n} className="rounded-lg border border-line bg-white px-3 py-2">
                <span className="block text-[11px] text-muted">{n}</span>
                <span className="block text-sm font-semibold text-ink">{label}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative z-10 flex items-center justify-between gap-4">
          <Image
            src="/brand/atlas-4-schools-horizontal.svg"
            alt="ATLAS SkillTech University — ISDI, ISME, uGDX and Law"
            width={1064}
            height={111}
            className="h-7 w-auto"
            unoptimized
          />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">© {BRAND.university}</p>
        </div>
      </aside>

      {/* ---- Form ---- */}
      <section className="flex min-h-screen flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
        {/* compact brand for mobile */}
        <div className="mb-8 flex items-center gap-2 lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand p-1">
            <AtlasCube size={28} />
          </span>
          <span className="leading-tight">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-muted">Research Publication</span>
            <span className="block text-sm font-bold text-ink">Portal 2025–26</span>
          </span>
        </div>

        <div className="mx-auto w-full max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Sign in</p>
          <h2 className="mt-1 font-display text-3xl font-bold text-ink">Back to the desk.</h2>
          <p className="mt-1 text-sm text-muted">Your queue is waiting.</p>

          <FragmentScrubber />
          {notice && (
            <div role="status" className={`mt-4 rounded-lg border px-3 py-2 text-xs ${notice.kind === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-warn/30 bg-warn-soft text-ink"}`}>
              {notice.text}
            </div>
          )}

          <LoginForm next={safeNextPath(sp.callbackUrl)} />

          <p className="mt-6 text-sm text-muted">
            First submission?{" "}
            <Link href="/register" className="font-semibold text-accent hover:underline">Start here →</Link>
          </p>
          <p className="mt-2 text-sm text-muted">
            <Link href="/auth/forgot-password" className="font-semibold text-accent hover:underline">Forgot password?</Link>
            {" · "}
            Registered but never set a password?{" "}
            <Link href="/auth/resend" className="font-semibold text-accent hover:underline">Resend setup email</Link>
          </p>
        </div>
      </section>
    </div>
  );
}
