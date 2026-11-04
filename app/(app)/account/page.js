import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/layout/PageHeader";
import Card, { CardHeader } from "@/components/ui/Card";
import CreatePasswordForm from "@/components/auth/CreatePasswordForm";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { findUserById } from "@/lib/repos/users.mjs";
import { linkedSubFor } from "@/lib/googleAuth";
import { isUniversityEmail } from "@/lib/oauthPolicy";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account settings — Research Publication Portal", robots: { index: false } };

/**
 * Account settings: how this account signs in, plus the OPTIONAL "Set password"
 * for a signed-in user who has none (typically a Google user). Read-only for
 * roles and account type — nothing here can change them.
 */
export default async function AccountPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");
  const user = await findUserById(db, me.id);
  if (!user) redirect("/login");
  const googleLinked = !!(await linkedSubFor(me.id));
  const googleCapable = isUniversityEmail(user.email);

  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Account" title="Account settings" subtitle="How you sign in to the Research Publication Portal." />

      <Card className="mb-4">
        <CardHeader eyebrow="Profile" title={user.name || user.email} />
        <dl className="grid grid-cols-1 gap-3 px-4 pb-5 pt-3 text-sm sm:grid-cols-2 sm:px-5">
          <div><dt className="text-xs text-muted">Email</dt><dd className="break-all font-semibold text-ink">{user.email}</dd></div>
          <div><dt className="text-xs text-muted">Account type</dt><dd className="font-semibold text-ink">{user.base_type === "FACULTY" ? "Faculty" : "Student"}</dd></div>
        </dl>
      </Card>

      <Card className="mb-4">
        <CardHeader eyebrow="Sign-in methods" title="How you sign in" />
        <ul className="divide-y divide-line px-4 pb-2 pt-2 text-sm sm:px-5">
          <li className="flex items-center justify-between gap-3 py-3">
            <span className="font-semibold text-ink">Google (ATLAS University account)</span>
            <span className="text-xs text-muted">
              {googleLinked ? "Linked" : googleCapable ? "Available: use “Sign in with Google”" : "Not available for this address"}
            </span>
          </li>
          <li className="flex items-center justify-between gap-3 py-3">
            <span className="font-semibold text-ink">Email and password</span>
            <span className="text-xs text-muted">{user.has_password ? "Password set" : "No password"}</span>
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader eyebrow="Optional" title={user.has_password ? "Password" : "Set a password"} />
        <div className="px-4 pb-5 sm:px-5">
          {user.has_password ? (
            <p className="mt-2 text-sm text-muted">
              Your account has a password, so you can sign in with Google or with your email and password. To change it, sign out and use{" "}
              <Link href="/auth/forgot-password" className="font-semibold text-accent hover:underline">Forgot password</Link>.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted">
                You don&apos;t need a password: you can keep signing in with Google. Add one only if you also want to sign in with your email and password.
              </p>
              <CreatePasswordForm mode="add" />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
