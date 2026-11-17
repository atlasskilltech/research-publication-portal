"use server";

import { redirect } from "next/navigation";
import { verifyAuthorEmail } from "@/lib/authorRegistration";
import { consumeAuthorVerification, sendAuthorConfirmationById } from "@/lib/authServer";
import { startSession } from "@/lib/auth/session";

/**
 * Runs only when the Author presses "Verify my email" (a POST), so email
 * security scanners that pre-open the GET link can't consume the single-use
 * token. On success the email is marked verified, the Author is signed in and
 * sent to a FIXED destination (no user-supplied redirect). Tokens are never logged.
 */
export async function verifyAuthorEmailAction(formData) {
  const result = await verifyAuthorEmail(formData.get("token"), {
    consumeVerification: consumeAuthorVerification,
    startSession: (userId) => startSession(userId, { purpose: "APP", method: "email_link" }),
    sendConfirmation: ({ userId }) => sendAuthorConfirmationById(userId),
  });
  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  if (!result.ok) redirect(`/auth/verify-email?status=${result.reason}`);
  redirect(result.redirect);
}
