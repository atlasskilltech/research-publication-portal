import Image from "next/image";
import { POLICY_META } from "@/lib/researchPolicy";

const LOCKUP_W = 2004; const LOCKUP_H = 1029; // public/brand/atlas-lockup-indigo.svg viewBox

/** Footer shared by every public page (landing page + published research). */
export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
        <Image src="/brand/atlas-lockup-indigo.svg" alt="ATLAS SkillTech University" width={LOCKUP_W} height={LOCKUP_H} className="h-9 w-auto" unoptimized />
        <p className="text-center text-xs text-muted">
          {POLICY_META.title} · {POLICY_META.year} · Effective from {POLICY_META.effectiveFrom} · © ATLAS SkillTech University, Mumbai
        </p>
      </div>
    </footer>
  );
}
