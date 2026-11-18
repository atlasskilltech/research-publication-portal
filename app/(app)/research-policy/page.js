import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import LandingPage from "@/components/landing/LandingPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Research Promotion Policy 2026–27 — Research Publication Portal" };

/**
 * Research Promotion Policy (AY 2026–27) — INTERNAL: faculty, administrators
 * and staff only. Students and external AIDC accounts are sent to their
 * dashboard (the sidebar doesn't show them the link either).
 */
function canViewResearchPolicy(u) {
  return !!u && u.baseType !== "AUTHOR" && (u.isAdmin || u.baseType === "FACULTY");
}

export default async function ResearchPolicyPage() {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  if (!canViewResearchPolicy(u)) redirect("/dashboard");
  // Bleed edge-to-edge inside the portal shell (cancels <main>'s padding).
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8">
      <LandingPage embedded signedIn />
    </div>
  );
}
