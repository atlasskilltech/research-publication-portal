import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { AtlasCube } from "@/components/layout/BrandLogo";
import CreatePasswordForm from "@/components/auth/CreatePasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your password — Research Publication Portal" };

/**
 * Create Password page, reached only after the email-verification link has
 * established a session in /auth/confirm. The session IS the proof of
 * verification: with none, the link was never clicked / has expired, so we send
 * the user back to sign in. This page deliberately lives OUTSIDE the (auth)
 * route group, whose layout would otherwise bounce an authenticated user to the
 * dashboard before they could set a password.
 */
export default async function CreatePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?notice=link_invalid");

  return (
    <div className="min-h-screen bg-white">
      <div className="flex min-h-screen flex-col justify-center px-6 py-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand p-1">
              <AtlasCube size={28} />
            </span>
            <span className="text-sm font-bold text-ink">Portal 2025–26</span>
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Almost there</p>
          <h1 className="mt-1 font-display text-3xl font-bold text-ink">Create your password</h1>
          <p className="mt-1 text-sm text-muted">
            Your email <b className="text-ink">{user.email}</b> is verified. Choose a password to finish setting up your account.
          </p>

          <CreatePasswordForm />
        </div>
      </div>
    </div>
  );
}
