import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import ResendSetupForm from "@/components/auth/ResendSetupForm";

import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

export const metadata = { title: "How to sign in — Research Publication Portal", robots: { index: false } };

// Public page (Google-first): registered users sign in with Google — there is
// no setup link to resend any more. They can ask for the instructions by email.
export default function ResendPage() {
  return (
    <AuthCard eyebrow="Account access" title="Sign in with Google">
      <p className="mt-2 text-sm text-muted">
        You don&apos;t need a setup link or a password. If you registered with your ATLAS University email, sign in with
        that Google account.
      </p>
      <div className="mt-5"><GoogleSignInButton prominent /></div>
      <p className="mt-6 text-sm text-muted">
        Prefer the instructions by email? Enter the address you registered with.
      </p>
      <ResendSetupForm compact />
      <p className="mt-5 text-center text-sm text-muted">
        <Link href="/login" className="font-semibold text-accent hover:underline">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}
