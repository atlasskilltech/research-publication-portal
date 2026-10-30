import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

/**
 * Layout for the signed-out routes (/login, /register).
 *
 * If a valid Supabase session already exists, send the user straight to the
 * dashboard instead of showing the auth forms. This is what makes the browser
 * Back button behave: after signing in and landing on /dashboard, pressing Back
 * returns to /login, and without this check the sign-in form would reappear —
 * looking as if the user had been logged out even though the session is intact.
 * Reading the session here also marks these routes dynamic, so the check runs on
 * every visit (including client-side Back navigations) rather than being served
 * from a static prerender.
 */
export default async function AuthLayout({ children }) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return <div className="min-h-screen bg-white">{children}</div>;
}
