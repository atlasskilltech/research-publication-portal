import Image from "next/image";
import { POLICY_META } from "@/lib/researchPolicy";

const LOGO_W = 1064; const LOGO_H = 111; // public/brand/atlas-4-schools-horizontal.svg viewBox

/** Footer shared by every public page (landing page + published research). */
export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
        <Image src="/brand/atlas-4-schools-horizontal.svg" alt="ATLAS SkillTech University — ISDI, ISME, uGDX and Law" width={LOGO_W} height={LOGO_H} className="h-7 w-auto max-w-full shrink-0" unoptimized />
        <p className="text-center text-xs text-muted">
          {POLICY_META.title} · {POLICY_META.year} · Effective from {POLICY_META.effectiveFrom} · © ATLAS SkillTech University, Mumbai
        </p>
      </div>
    </footer>
  );
}
