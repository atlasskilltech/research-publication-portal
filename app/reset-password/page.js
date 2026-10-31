import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { verifySetupToken } from "@/lib/authFlow";
import { readSetupProof, setupSecret } from "@/lib/authServer";
import AuthCard from "@/components/auth/AuthCard";
import CreatePasswordForm from "@/components/auth/CreatePasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password — Research Publication Portal", robots: { index: false } };

/**
 * Reset Password — reachable only right after a password-reset link was
 * verified in /auth/confirm (session + signed setup proof for that user).
 * Same secure update path as Create Password (/api/set-password).
 * Outside the (auth) group so a signed-in user isn't bounced to the dashboard.
 */
export default async function ResetPasswordPage() {
  const user = await getSessionUser();
  const proof = await readSetupProof();
  if (!user || !verifySetupToken(proof, user.id, setupSecret())) redirect("/auth/confirm?status=reset_required");

  return (
    <AuthCard eyebrow="Password reset" title="Reset your password">
      <p className="mt-2 text-sm text-muted">
        Choose a new password for <b className="text-ink">{user.email}</b>. You&apos;ll sign in with it afterwards.
      </p>
      <CreatePasswordForm mode="reset" />
    </AuthCard>
  );
}
