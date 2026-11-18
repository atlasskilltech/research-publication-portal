import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import PublicShell from "@/components/site/PublicShell";
import AuthorRegisterForm from "@/components/auth/AuthorRegisterForm";
import { CONFERENCE_NAME, CONFERENCE_SHORT } from "@/lib/authorRegistration";

export const dynamic = "force-dynamic";
export const metadata = {
  title: `${CONFERENCE_SHORT} Registration — ATLAS SkillTech University Research Publication Portal`,
  description: `Register for ${CONFERENCE_NAME} and submit your paper through the ATLAS SkillTech University Research Publication Portal.`,
};

/** /aidc/register — AIDC (external participant) registration form. */
export default async function AidcRegisterPage({ searchParams }) {
  // Already signed in: nothing to register — go to the portal.
  let signedIn = false;
  try { signedIn = !!(await getSessionUser()); } catch { signedIn = false; }
  if (signedIn) redirect("/dashboard");

  const sp = (await searchParams) || {};
  const notice = typeof sp.notice === "string" ? sp.notice : "";
  return (
    <PublicShell>
      <div className="orbit right-[-160px] top-[-120px] h-[520px] w-[520px]" aria-hidden="true" />
      <div className="orbit left-[-200px] bottom-[-160px] h-[440px] w-[440px]" aria-hidden="true" />
      <div className="relative mx-auto w-full max-w-xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{CONFERENCE_SHORT} · Registration</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-ink sm:text-4xl">Submit your paper</h1>
          <p className="mt-2 text-sm text-muted">
            Register for <b className="text-ink">{CONFERENCE_NAME}</b>. Open to participants from any institution or organization.
          </p>
          <AuthorRegisterForm notice={notice} />
        </div>
      </div>
    </PublicShell>
  );
}
