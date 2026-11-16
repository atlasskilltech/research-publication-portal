import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import ApprovalsBoard from "@/components/approvals/ApprovalsBoard";

export const dynamic = "force-dynamic";

/**
 * Final Approvals — the Program Chair (PROGRAM_CHAIR role + allowlisted email)
 * and, as backup, administrators. The authoritative gate is here (server-side,
 * from the session) and again in /api/approvals and inside the approval
 * transaction; anyone else is sent back to their dashboard.
 */
export default async function ApprovalsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.isAdmin && !user.isProgramChair) redirect("/dashboard");
  return <ApprovalsBoard asChair={!!user.isProgramChair} />;
}
