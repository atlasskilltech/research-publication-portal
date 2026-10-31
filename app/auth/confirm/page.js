import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import FragmentScrubber from "@/components/auth/FragmentScrubber";
import ResendSetupForm from "@/components/auth/ResendSetupForm";
import ConfirmSubmit from "@/components/auth/ConfirmSubmit";
import { parseVerificationParams, LINK_MESSAGES } from "@/lib/authFlow";
import { confirmAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your email — Research Publication Portal", robots: { index: false } };

/**
 * Landing page for the setup link in the registration / reset email:
 *   /auth/confirm?token_hash=<hash>&type=invite|recovery&flow=setup|reset
 * (links are built by the server from Supabase's generateLink() hashed_token
 * and delivered by Resend — see lib/authMailer.js)
 * Opening the link does NOT verify anything (scanner-safe). The user presses
 * Continue → server action → verifyOtp on the server → /create-password.
 * Errors come back as ?status=<reason> (never with the token).
 */
export default async function ConfirmPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const status = typeof sp.status === "string" && LINK_MESSAGES[sp.status] ? sp.status : null;
  const parsed = status ? null : parseVerificationParams(sp);
  const failure = status || (parsed && !parsed.ok ? parsed.reason : null);

  if (failure) {
    return (
      <AuthCard eyebrow="Link problem" title={failure === "unavailable" ? "Please try again shortly" : "This link can't be used"}>
        <FragmentScrubber />
        <p className="mt-2 text-sm text-muted" role="alert">{LINK_MESSAGES[failure]}</p>
        {failure !== "unavailable" && <ResendSetupForm purpose={failure === "reset_required" ? "reset" : "setup"} />}
        <p className="mt-5 text-center text-sm text-muted">
          Already set your password? <Link href="/login" className="font-semibold text-accent hover:underline">Sign in</Link>
        </p>
      </AuthCard>
    );
  }

  const isReset = parsed.flow === "reset";
  return (
    <AuthCard eyebrow={isReset ? "Password reset" : "Verify your email"} title={isReset ? "Reset your password" : "Activate your account"}>
      <FragmentScrubber stripQuery />
      <p className="mt-2 text-sm text-muted">
        {isReset
          ? "Continue to choose a new password for your Research Publication Portal account."
          : "Continue to verify your email address and create the password for your Research Publication Portal account."}
      </p>
      <form action={confirmAction} className="mt-6">
        <input type="hidden" name="token_hash" value={parsed.tokenHash} />
        <input type="hidden" name="type" value={parsed.type} />
        <input type="hidden" name="flow" value={parsed.flow} />
        <ConfirmSubmit label={isReset ? "Continue to reset your password →" : undefined} />
      </form>
      <p className="mt-4 text-xs text-muted">This secure link works once and expires. If you didn&apos;t request it, you can close this page.</p>
    </AuthCard>
  );
}
