// Public self-registration — Google-first (pure; every effect is injected so the
// whole flow is unit-testable without a database: scripts/test-google-first.mjs).
//
// What registration does now:
//   1. Students: the application number must be unique AND verified against the
//      university API (unchanged). Faculty never carry one (unchanged).
//   2. The account is created as before — ACTIVE, isAdmin = 0, NO roles, NO
//      password, email not yet verified. The account category (STUDENT /
//      FACULTY) comes from the registration form the user completed.
//   3. NO verification/password token is issued and NO password-creation email
//      is sent. One "registration complete — sign in with Google" email is sent
//      (best-effort: a delivery failure never fails the registration).
//   4. The user signs in with their @atlasuniversity.edu.in Google account; the
//      Google callback proves mailbox ownership and marks the email verified.
//      A password is optional and can be added later from Account settings.
//
// Nothing here reads a role, admin flag or user id from the request.

export const REGISTERED_MESSAGE =
  "Your registration is successful. You can now sign in using your ATLAS University Google account.";
export const REGISTERED_MESSAGE_NO_GOOGLE =
  "Your registration is successful. This email address can't use Google sign-in, so create a password from \"Forgot password\" on the sign-in page, then sign in with it.";
export const EXISTS_MESSAGE =
  "An account with this email already exists. Sign in with your ATLAS University Google account, or use your password if you created one.";

/**
 * data: the output of lib/validation.validateRegister — { name, email, baseType, school, applicationNo }.
 * deps:
 *   findUserByApplicationNo(no) → row | null
 *   verifyApplicationNo(no)     → { status: "exists" | "not_found" | "unavailable" }
 *   findUserByEmail(email)      → row | null
 *   createAccount({ name, email, baseType, schoolCode, applicationNo }) → userId
 *                                 (throws { duplicate: true } on a unique-key race)
 *   sendRegistrationEmail({ email, name, userId, baseType }) → { ok }
 *   isUniversityEmail(email)    → bool (Google sign-in possible?)
 * → { status, body }
 */
export async function registerAccount(data, deps) {
  const { name, email, baseType, school, applicationNo } = data;

  // ---- Student-only: duplicate guard + external verification (unchanged) ----
  if (baseType === "STUDENT") {
    if (await deps.findUserByApplicationNo(applicationNo)) {
      return { status: 409, body: { error: "This application number is already registered." } };
    }
    const check = await deps.verifyApplicationNo(applicationNo);
    if (check?.status === "not_found") {
      return {
        status: 422,
        body: { error: "We couldn't verify that application number.", issues: { applicationNo: "This application number was not found." } },
      };
    }
    if (check?.status !== "exists") {
      return { status: 503, body: { error: "Verification is temporarily unavailable. Please try again shortly." } };
    }
  }

  // ---- Existing account → no duplicate, no email -----------------------------
  const conflict = { status: 409, body: { error: EXISTS_MESSAGE, code: "exists" } };
  if (await deps.findUserByEmail(email)) return conflict;

  // ---- Create the account (no token, no password) ----------------------------
  let userId;
  try {
    userId = await deps.createAccount({
      name,
      email,
      baseType: baseType === "FACULTY" ? "FACULTY" : "STUDENT",
      schoolCode: school || null,
      applicationNo: baseType === "STUDENT" ? applicationNo : null,
    });
  } catch (e) {
    if (e?.duplicate) return conflict; // lost a race on email / application number
    throw e;
  }

  // ---- Exactly one confirmation email (best-effort) ---------------------------
  let emailSent = false;
  try {
    emailSent = !!(await deps.sendRegistrationEmail({ email, name, userId, baseType }))?.ok;
  } catch {
    emailSent = false;
  }

  const googleSignIn = deps.isUniversityEmail(email);
  return {
    status: 201,
    body: {
      ok: true,
      emailSent,
      googleSignIn,
      message: googleSignIn ? REGISTERED_MESSAGE : REGISTERED_MESSAGE_NO_GOOGLE,
    },
  };
}
