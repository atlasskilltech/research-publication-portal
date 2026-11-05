import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import PaperStatistics from "@/components/manage/PaperStatistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Paper statistics — Research Publication Portal", robots: { index: false } };

/**
 * Paper statistics — administrators only. Gated here (server-side, from the
 * session) and again in /api/admin/stats*; a non-admin is sent to their dashboard.
 */
export default async function StatisticsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");
  return <PaperStatistics />;
}
