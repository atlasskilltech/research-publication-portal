import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import FragmentScrubber from "@/components/auth/FragmentScrubber";
import ResendSetupForm from "@/components/auth/ResendSetupForm";
import ConfirmSubmit from "@/components/auth/ConfirmSubmit";
import { AUTHOR_VERIFY_MESSAGES } from "@/lib/authorRegistration";
import { verifyAuthorEmailAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your email — Research Publication Portal", robots: { index: false } };

/**
 * External Author (AIDC 2026) email verification:
 *   /auth/verify-email?token=<64 hex>   (link from the verification email)
 * Opening the link verifies nothing (scanner-safe). The Author presses
 * "Verify my email" → server action → token consumed in MySQL → signed in →
 * /dashboard. Errors come back as ?status=<reason> (never with the token).
 */
export default async function VerifyEmailPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const token = typeof sp.token === "string" ? sp.token.trim() : "";
  let failure = typeof sp.status === "string" && Object.hasOwn(AUTHOR_VERIFY_MESSAGES, sp.status) ? sp.status : null;
  if (!failure && !token) failure = "missing";
  if (!failure && !/^[a-f0-9]{64}$/i.test(token)) failure = "invalid";

  if (failure) {
    return (
      <AuthCard eyebrow="Email verification" title={failure === "unavailable" ? "Please try again shortly" : "This link can't be used"}>
        <FragmentScrubber />
        <p className="mt-2 text-sm text-muted" role="alert">{AUTHOR_VERIFY_MESSAGES[failure]}</p>
        {failure !== "unavailable" && <ResendSetupForm purpose="author-verify" />}
        <p className="mt-5 text-center text-sm text-muted">
          <Link href="/login" className="font-semibold text-accent hover:underline">Go to sign in</Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard eyebrow="Author registration" title="Verify your email">
      <FragmentScrubber stripQuery />
      <p className="mt-2 text-sm text-muted">
        Press the button below to confirm your email address. Your Author account will be activated and you&apos;ll be signed in.
      </p>
      <form action={verifyAuthorEmailAction} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <ConfirmSubmit label="Verify my email →" />
      </form>
      <p className="mt-4 text-xs text-muted">This secure link works once and expires after 24 hours. If you didn&apos;t register, you can close this page.</p>
    </AuthCard>
  );
}
