import { redirect } from "next/navigation";
import { getSetupSession } from "@/lib/session";
import AuthCard from "@/components/auth/AuthCard";
import CreatePasswordForm from "@/components/auth/CreatePasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password — Research Publication Portal", robots: { index: false } };

/**
 * Reset Password — reachable only right after a password-reset link was
 * verified in /auth/confirm (a 30-minute RESET session bound to that user).
 * Same secure update path as Create Password (/api/set-password).
 * Outside the (auth) group so a signed-in user isn't bounced to the dashboard.
 */
export default async function ResetPasswordPage() {
  // Only the short-lived RESET session from a verified email link opens this page.
  const setup = await getSetupSession();
  if (!setup || setup.flow !== "reset") redirect("/auth/confirm?status=reset_required");
  const { user } = setup;

  return (
    <AuthCard eyebrow="Password reset" title="Reset your password">
      <p className="mt-2 text-sm text-muted">
        Choose a new password for <b className="text-ink">{user.email}</b>. You&apos;ll sign in with it afterwards.
      </p>
      <CreatePasswordForm mode="reset" />
    </AuthCard>
  );
}
