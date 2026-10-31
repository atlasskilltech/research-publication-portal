import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import ResendSetupForm from "@/components/auth/ResendSetupForm";

export const metadata = { title: "Forgot password — Research Publication Portal", robots: { index: false } };

// Public: request a password reset link (neutral response, rate-limited).
export default function ForgotPasswordPage() {
  return (
    <AuthCard eyebrow="Account access" title="Forgot your password?">
      <p className="mt-2 text-sm text-muted">
        Enter the email address you registered with. If it belongs to a portal account, we&apos;ll email you a secure link to
        choose a new password.
      </p>
      <ResendSetupForm compact purpose="reset" />
      <p className="mt-5 text-center text-sm text-muted">
        Remembered it? <Link href="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}
