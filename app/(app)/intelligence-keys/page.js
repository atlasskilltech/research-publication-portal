import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import AgentKeysAdmin from "@/components/manage/AgentKeysAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "IntelligenceOS keys — Research Publication Portal", robots: { index: false } };

/**
 * IntelligenceOS keys — administrators only. Gated here (server-side, from the
 * session) and again in /api/admin/agent-keys*; a non-admin is sent to their dashboard.
 */
export default async function IntelligenceKeysPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  return <AgentKeysAdmin apiUrl={`${site || "https://research.atlasskilltech.app"}/agent-api`} />;
}
