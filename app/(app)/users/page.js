import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import UsersAdmin from "@/components/manage/UsersAdmin";

export const dynamic = "force-dynamic";

/**
 * People & roles — administrators only. The authoritative gate is here
 * (server-side, from the session) and again in the /api/admin/users endpoints;
 * a non-admin who reaches the URL is sent back to their dashboard.
 */
export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.isAdmin) redirect("/dashboard");

  return <UsersAdmin />;
}
