// Google Sign-In user-facing messages, keyed by the ?notice= value on /login
// and /register?type=author. Plain data (no imports) so client components can
// use it without bundling the server-side token verification in oauthPolicy.js.
export const GOOGLE_NOTICES = Object.freeze({
  google_domain: "Please sign in using your ATLAS University email account.",
  google_unverified:
    "Your Google account email is not verified. Please sign in using your verified ATLAS University email account.",
  google_not_registered:
    "There is no portal account for this ATLAS University email yet. Register first, then sign in with Google.",
  google_disabled: "This account is not active. Please contact the portal administrator.",
  google_failed: "Google sign-in could not be completed or has expired. Please try again.",
  google_unavailable: "Google sign-in is temporarily unavailable. Please try again shortly, or use your email and password if you have created one.",
  // External authors (AIDC 2026)
  google_external_unverified:
    "Your Google account email is not verified. Please use a Google account with a verified email address.",
  google_external_not_registered:
    "There is no portal account for this Google email. External authors for AIDC – ATLAS International Design Conference 2026 must first complete the Author registration form, then continue with Google. ATLAS students and faculty: sign in with your ATLAS University email account.",
  author_email_mismatch:
    "The Google account you chose does not match the email address on your Author registration. Continue with Google using exactly the same email address you registered with.",
  author_registration_expired:
    "Your Author registration has expired or was already used. Please fill in the Author registration form again.",
});
