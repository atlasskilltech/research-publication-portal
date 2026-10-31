import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import ResendSetupForm from "@/components/auth/ResendSetupForm";

export const metadata = { title: "Resend setup email — Research Publication Portal", robots: { index: false } };

// Public page: request a new setup / password-creation email.
export default function ResendPage() {
  return (
    <AuthCard eyebrow="Account setup" title="Resend setup email">
      <p className="mt-2 text-sm text-muted">
        Enter the email you registered with. If your link expired, was already used, or you verified your email but
        never created a password, we&apos;ll send you a new secure link.
      </p>
      <ResendSetupForm compact />
      <p className="mt-5 text-center text-sm text-muted">
        <Link href="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}
