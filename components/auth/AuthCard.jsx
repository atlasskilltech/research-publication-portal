import { AtlasCube } from "@/components/layout/BrandLogo";

/** Branded single-card layout for the verification / password-setup screens. */
export default function AuthCard({ eyebrow, title, children }) {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="flex min-h-screen flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand p-1">
              <AtlasCube size={28} />
            </span>
            <span className="text-sm font-bold text-ink">
              Research Publication Portal
              <span className="block text-[11px] font-medium text-muted">ATLAS SkillTech University</span>
            </span>
          </div>
          <div className="rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
            {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{eyebrow}</p>}
            <h1 className="mt-1 font-display text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
