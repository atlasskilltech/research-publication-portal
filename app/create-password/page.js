import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { verifySetupToken } from "@/lib/authFlow";
import { readSetupProof, setupSecret } from "@/lib/authServer";
import AuthCard from "@/components/auth/AuthCard";
import CreatePasswordForm from "@/components/auth/CreatePasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your password — Research Publication Portal", robots: { index: false } };

/**
 * Create Password — reachable only right after a setup link was verified in
 * /auth/confirm: needs a valid session AND the signed setup proof for that same
 * user (30-minute window). Otherwise the user is sent to request a new link.
 * Lives OUTSIDE the (auth) group, whose layout bounces signed-in users to the
 * dashboard.
 */
export default async function CreatePasswordPage() {
  const user = await getSessionUser();
  const proof = await readSetupProof();
  if (!user || !verifySetupToken(proof, user.id, setupSecret())) redirect("/auth/confirm?status=setup_required");

  return (
    <AuthCard eyebrow="Account verified" title="Create your password">
      <p className="mt-2 text-sm text-muted">
        Your email <b className="text-ink">{user.email}</b> is verified. Set a password to activate your account — you&apos;ll use it with this email address to sign in.
      </p>
      <CreatePasswordForm />
    </AuthCard>
  );
}
