import Link from "next/link";
import LoginForm from "@/components/auth/LoginForm";
import FragmentScrubber from "@/components/auth/FragmentScrubber";
import { safeNextPath } from "@/lib/authFlow";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { GOOGLE_NOTICES } from "@/lib/authNotices";
import { CONFERENCE_SHORT } from "@/lib/authorRegistration";

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
  registered: { kind: "ok", text: "Your registration is successful. You can now sign in using your ATLAS University Google account." },
  link_invalid: { kind: "warn", text: "That setup link is invalid or has expired. You don't need it: sign in with your ATLAS University Google account." },
  link_expired: { kind: "warn", text: "That setup link has expired or has already been used. You don't need it: sign in with your ATLAS University Google account." },
  // Google Sign-In outcomes (set by /auth/google, /auth/callback, middleware).
  ...Object.fromEntries(Object.entries(GOOGLE_NOTICES).map(([k, text]) => [k, { kind: "warn", text }])),
};

export default async function LoginPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const notice = Object.hasOwn(NOTICES, sp.notice) ? NOTICES[sp.notice] : null;
  const next = safeNextPath(sp.callbackUrl);
  return (
    <div className="lg:grid lg:grid-cols-2">
      {/* ---- Hero (desktop) ---- */}
      <aside className="relative hidden overflow-hidden border-r border-line p-10 lg:flex lg:flex-col lg:justify-center">
        <div className="orbit left-[-120px] top-[120px] h-[520px] w-[520px]" aria-hidden="true" />
        <div className="orbit left-[-40px] top-[260px] h-[360px] w-[360px]" aria-hidden="true" />
        <span className="absolute bottom-[-40px] left-[120px] h-40 w-40 rounded-full bg-[#c7d84a]/70 blur-[1px]" aria-hidden="true" />

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
      </aside>

      {/* ---- Form ---- */}
      <section className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">

        <div className="mx-auto w-full max-w-sm">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Sign in</p>
          <h2 className="mt-1 font-display text-3xl font-bold text-ink">Back to the desk.</h2>
          <p className="mt-1 text-sm text-muted">Sign in with your Google account.</p>

          <FragmentScrubber />
          {notice && (
            <div role="status" className={`mt-4 rounded-lg border px-3 py-2 text-xs ${notice.kind === "ok" ? "border-ok/30 bg-ok-soft text-ok" : "border-warn/30 bg-warn-soft text-ink"}`}>
              {notice.text}
            </div>
          )}

          {/* ONE Google button — Students, Faculty, Admins, Editors, Reviewers. Authors are refused server-side. */}
          <div className="mt-6">
            <GoogleSignInButton next={next} prominent />
          </div>

          {/* Authors (and anyone who has set a password): email + password. */}
          <div id="author-signin" className="mt-8 scroll-mt-6 rounded-xl border border-line bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">AIDC sign-in</p>
            <p className="mt-1 text-sm text-muted">
              {CONFERENCE_SHORT} participants sign in with their registered email address and password.
            </p>
            <div className="mt-4">
              <LoginForm next={next} />
            </div>
            <p className="mt-3 text-xs text-muted">
              <Link href="/auth/forgot-password" className="font-semibold text-accent hover:underline">Forgot password?</Link>{" "}
              AIDC participants who signed in with Google before: use it to set a password.
            </p>
            <p className="mt-2 text-xs text-muted">
              Students, faculty and staff who have created a password can also sign in here.
            </p>
            <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
              Not registered for {CONFERENCE_SHORT} yet?{" "}
              <Link href="/aidc/register" className="font-semibold text-accent hover:underline">Register for AIDC →</Link>
            </p>
          </div>

          {/* Registration for the research portal (ATLAS students & faculty). */}
          <div className="mt-6 flex flex-col gap-3 rounded-xl border border-line bg-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              <b className="text-ink">New to the portal?</b> ATLAS students and faculty, create your account.
            </p>
            <Link href="/register" className="inline-flex shrink-0 items-center justify-center rounded-lg border border-brand bg-white px-4 py-2 text-sm font-semibold text-brand transition hover:bg-brand-50">
              Register →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
