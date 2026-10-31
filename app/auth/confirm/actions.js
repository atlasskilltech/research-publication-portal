"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyLink } from "@/lib/authFlow";
import { issueSetupProof } from "@/lib/authServer";

/**
 * Runs only when the user presses "Continue" on /auth/confirm (a POST), so
 * email security scanners that pre-open the GET link can't consume the
 * single-use token. verifyOtp runs on the SERVER; on success Supabase's
 * session cookies and our setup proof are set, then we go to a FIXED
 * destination (no user-supplied redirect). Tokens are never logged.
 */
export async function confirmAction(formData) {
  const supabase = await createClient();
  const result = await verifyLink(
    { token_hash: formData.get("token_hash"), type: formData.get("type"), flow: formData.get("flow") },
    {
      verifyOtp: (args) => supabase.auth.verifyOtp(args),
      issueSetupProof,
    },
  );
  // redirect() throws NEXT_REDIRECT — keep it outside any try/catch.
  if (!result.ok) redirect(`/auth/confirm?status=${result.reason}`);
  redirect(result.redirect);
}
