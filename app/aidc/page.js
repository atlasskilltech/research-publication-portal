import PublicShell from "@/components/site/PublicShell";
import ComingSoon from "@/components/site/ComingSoon";
import { CONFERENCE_NAME, CONFERENCE_SHORT } from "@/lib/authorRegistration";

export const metadata = {
  title: `${CONFERENCE_SHORT} — ATLAS SkillTech University`,
  description: `${CONFERENCE_NAME} — coming soon.`,
};

/** /aidc — the AIDC landing page is coming soon. Registration is at /aidc/register. */
export default function AidcPage() {
  return (
    <PublicShell>
      <ComingSoon
        eyebrow={CONFERENCE_SHORT}
        title={CONFERENCE_NAME}
        text="The conference page is on its way."
      />
    </PublicShell>
  );
}
