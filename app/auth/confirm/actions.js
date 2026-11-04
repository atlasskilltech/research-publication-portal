"use server";

import { redirect } from "next/navigation";
import { verifyLink } from "@/lib/authFlow";
import { verifyOtp, issueSetupProof } from "@/lib/authServer";

/**
 * Runs only when the user presses "Continue" on /auth/confirm (a POST), so
 * email security scanners that pre-open the GET link can't consume the
 * single-use token. The token is consumed in MySQL on the SERVER; on success a
 * 30-minute SETUP/RESET session is started, then we go to a FIXED destination
 * (no user-supplied redirect). Tokens are never logged.
 */
export async function confirmAction(formData) {
  const result = await verifyLink(
    { token_hash: formData.get("token_hash"), type: formData.get("type"), flow: formData.get("flow") },
    { verifyOtp, issueSetupProof },
  );
  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  if (!result.ok) redirect(`/auth/confirm?status=${result.reason}`);
  redirect(result.redirect);
}
