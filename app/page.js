import { redirect } from "next/navigation";
import { parseVerificationParams } from "@/lib/authFlow";
import PublicShell from "@/components/site/PublicShell";
import ComingSoon from "@/components/site/ComingSoon";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "ATLAS Research — Research Publication Portal",
  description: "ATLAS SkillTech University Research — coming soon.",
};

/**
 * Public home (/) — the Research landing page is coming soon.
 * AIDC: /aidc (coming soon) and /aidc/register (registration form).
 * Sign-in: /login (links to /register for ATLAS students & faculty).
 */
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
  return (
    <PublicShell>
      <ComingSoon
        eyebrow="ATLAS SkillTech University · Research"
        title="ATLAS Research"
        text="A new home for research at ATLAS SkillTech University is on its way."
      />
    </PublicShell>
  );
}
