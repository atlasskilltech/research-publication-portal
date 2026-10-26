import { redirect } from "next/navigation";
import { auth } from "@/auth";
import AppShell from "@/components/layout/AppShell";

/**
 * Authenticated layout. Server-side gate: no valid session -> /login.
 * The real identity (never localStorage) is passed down to the shell.
 */
export default async function AppLayout({ children }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const u = session.user;
  const sessionUser = {
    name: u.name || u.email,
    email: u.email,
    isAdmin: !!u.isAdmin,
    baseType: u.baseType || null,
  };

  return <AppShell sessionUser={sessionUser}>{children}</AppShell>;
}
