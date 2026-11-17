import { redirect } from "next/navigation";
import { parseVerificationParams } from "@/lib/authFlow";
import { getSessionUser } from "@/lib/session";
import LandingPage from "@/components/landing/LandingPage";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Research Promotion Policy 2026–27 — ATLAS SkillTech University",
  description:
    "ATLAS SkillTech University Research Promotion Policy, Academic Year 2026–27: faculty rewards for publications, patents, books, consultancy and MOOCs, conference support, seed funding and guidelines.",
};

export default async function Home({ searchParams }) {
  // Safety net: if a setup link ever arrives at the bare site URL as
  // /?token_hash=…&type=… (e.g. a mis-built link), forward ONLY those two
  // validated parameters to the verification page (nothing is verified here; no
  // other input is forwarded).
  const sp = (await searchParams) || {};
  const parsed = parseVerificationParams(sp);
  if (parsed.ok) {
    redirect(`/auth/confirm?token_hash=${encodeURIComponent(parsed.tokenHash)}&type=${encodeURIComponent(parsed.type)}`);
  }
  // Public landing page (Research Promotion Policy). "Login" → /login; a
  // signed-in visitor gets "Open dashboard" instead.
  let signedIn = false;
  try { signedIn = !!(await getSessionUser()); } catch { signedIn = false; }
  return <LandingPage signedIn={signedIn} />;
}
