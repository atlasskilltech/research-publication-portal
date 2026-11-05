// Google Sign-In user-facing messages, keyed by the ?notice= value on /login
// and /register?type=author. Plain data (no imports) so client components can
// use it without bundling the server-side token verification in oauthPolicy.js.
export const GOOGLE_NOTICES = Object.freeze({
  // ATLAS addresses must come from the ATLAS Google Workspace (hd); also used
  // when a Google account is linked to a different portal account.
  google_domain:
    "This Google account can't be used for this portal account. For an @atlasuniversity.edu.in address, sign in with your ATLAS University Google account.",
  google_unverified:
    "Your Google account email is not verified. Please use a Google account with a verified email address.",
  google_not_registered:
    "There is no portal account for this Google email. ATLAS students and faculty: register first. External authors (AIDC – ATLAS International Design Conference 2026): complete the Author registration form first, then sign in with Google.",
  google_disabled: "This account is not active. Please contact the portal administrator.",
  google_failed: "Google sign-in could not be completed or has expired. Please try again.",
  google_unavailable: "Google sign-in is temporarily unavailable. Please try again shortly, or use your email and password if you have created one.",
  author_email_mismatch:
    "The Google account you chose does not match the email address on your Author registration. Sign in with Google using exactly the same email address you registered with.",
  author_registration_expired:
    "Your Author registration has expired or was already used. Please fill in the Author registration form again.",
  // Kept so links from before the single-button change still show a message.
  google_external_unverified:
    "Your Google account email is not verified. Please use a Google account with a verified email address.",
  google_external_not_registered:
    "There is no portal account for this Google email. External authors must first complete the Author registration form, then sign in with Google.",
});
