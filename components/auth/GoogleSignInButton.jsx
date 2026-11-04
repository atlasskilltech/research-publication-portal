"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** Official multicolour Google "G" mark (Google Sign-In branding). */
function GoogleLogo({ className }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" className={className}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * "Sign in with Google" — a plain form POST to /auth/google (works without JS;
 * JS only adds the loading state). The server starts the PKCE flow; the
 * university-domain rule is enforced server-side, never here.
 */
export default function GoogleSignInButton({ next = "/dashboard", disabled = false }) {
  const [pending, setPending] = useState(false);

  // Coming back with the browser Back button (bfcache) must not leave the
  // button stuck in its loading state.
  useEffect(() => {
    const reset = (e) => {
      if (e.persisted) setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const isDisabled = disabled || pending;

  return (
    <form
      method="post"
      action="/auth/google"
      onSubmit={(e) => {
        if (isDisabled) {
          e.preventDefault();
          return;
        }
        setPending(true);
      }}
    >
      <input type="hidden" name="next" value={next} />
      <button
        type="submit"
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={pending}
        className={cn(
          "inline-flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-white px-5 py-3",
          "text-base font-semibold text-ink transition-colors select-none hover:bg-soft",
          "focus-visible:outline-2 focus-visible:outline-brand-light",
          isDisabled && "cursor-not-allowed opacity-60",
        )}
      >
        {pending ? (
          <span
            className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand"
            aria-hidden="true"
          />
        ) : (
          <GoogleLogo className="h-5 w-5 shrink-0" />
        )}
        <span>{pending ? "Redirecting to Google…" : "Sign in with Google"}</span>
      </button>
      <p className="mt-2 text-center text-xs text-muted">Use your @atlasuniversity.edu.in account.</p>
    </form>
  );
}
