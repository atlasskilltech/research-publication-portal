import { redirect } from "next/navigation";
import { getSetupSession } from "@/lib/session";
import AuthCard from "@/components/auth/AuthCard";
import CreatePasswordForm from "@/components/auth/CreatePasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your password — Research Publication Portal", robots: { index: false } };

/**
 * Create Password — reachable only right after a setup link was verified in
 * /auth/confirm: needs the 30-minute SETUP session that the verified link
 * started (bound to that user server-side). Otherwise the user is sent to request a new link.
 * Lives OUTSIDE the (auth) group, whose layout bounces signed-in users to the
 * dashboard.
 */
export default async function CreatePasswordPage() {
  // Only the short-lived SETUP session from a verified email link opens this page.
  const setup = await getSetupSession();
  if (!setup || setup.flow !== "setup") redirect("/auth/confirm?status=setup_required");
  const { user } = setup;

  return (
    <AuthCard eyebrow="Account verified" title="Create your password">
      <p className="mt-2 text-sm text-muted">
        Your email <b className="text-ink">{user.email}</b> is verified. Set a password to activate your account — you&apos;ll use it with this email address to sign in.
      </p>
      <CreatePasswordForm />
    </AuthCard>
  );
}
