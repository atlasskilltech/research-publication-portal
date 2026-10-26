import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import AppShell from "@/components/layout/AppShell";

/**
 * Authenticated layout. Server-side gate: no valid session -> /login.
 * The real identity (never localStorage) is passed down to the shell.
 */
export default async function AppLayout({ children }) {
  const u = await getSessionUser();
  if (!u) redirect("/login");

  const sessionUser = {
    name: u.name || u.email,
    email: u.email,
    isAdmin: !!u.isAdmin,
    baseType: u.baseType || null,
  };

  return <AppShell sessionUser={sessionUser}>{children}</AppShell>;
}
