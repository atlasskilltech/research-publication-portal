import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { getSessionUser } from "@/lib/session";

// Public (no sign-in) layout for the published-research catalogue. Uses the
// same header and footer as the landing page (components/site/).
export const metadata = {
  title: "Publications — ATLAS SkillTech University Research Publication Portal",
  description: "Browse published research from ATLAS SkillTech University.",
};

export default async function PublicLayout({ children }) {
  // A signed-in visitor gets "Open dashboard" instead of "Login" (same as /).
  let signedIn = false;
  try { signedIn = !!(await getSessionUser()); } catch { signedIn = false; }
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader signedIn={signedIn} active="publications" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <SiteFooter />
    </div>
  );
}
