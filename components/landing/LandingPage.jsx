import Link from "next/link";
import Image from "next/image";
import BrandLogo from "@/components/layout/BrandLogo";
import {
  POLICY_META, PREAMBLE, OBJECTIVES, INCENTIVE_NOTE, INCENTIVES, HIGHLIGHTS, CONFERENCE_INTRO, CONFERENCE_CONDITIONS,
  CONFERENCE_SUPPORT, SEED_FUNDING, SEED_USES, GUIDELINES, APPLY_STEPS, ANNEXURE_FIELDS,
} from "@/lib/researchPolicy";

/**
 * Public landing page — Research Promotion Policy, AY 2026–27.
 * Same visual language as the portal (brand indigo, accent pink, serif display
 * headings, white cards on the soft canvas, orbit rings from the sign-in hero).
 *
 * Photos: free Unsplash images (Unsplash License), hot-linked as CSS
 * backgrounds layered OVER a brand gradient, so the section still looks
 * finished if an image is slow or blocked.
 */
const LOCKUP_W = 2004; const LOCKUP_H = 1029; // public/brand/atlas-lockup-indigo.svg viewBox
const photo = (id, w = 1400) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=70`;
const PHOTOS = {
  hero: photo("photo-1532094349884-543bc11b234d"), // laboratory research
  library: photo("photo-1481627834876-b7833e8f5570", 900), // library stacks
  collaboration: photo("photo-1523240795612-9a054b0db644", 1200), // collaborative study
  conference: photo("photo-1540575467063-178a50c2df87", 1400), // conference audience
  seed: photo("photo-1434030216411-0b793f4b4173", 1200), // notes & early ideas
};

function Photo({ src, className = "", label, children }) {
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`relative overflow-hidden bg-brand bg-cover bg-center ${className}`}
      style={{ backgroundImage: `url("${src}"), linear-gradient(135deg, #2e2a6b 0%, #403b8f 55%, #e91e8c 130%)` }}
    >
      {children}
    </div>
  );
}

const ICONS = {
  patent: <><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8l5.5-.8z" /></>,
  journal: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h6" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2z" /><path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
  cap: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c3 2 9 2 12 0v-5" /></>,
  check: <><path d="M5 12l5 5L20 7" /></>,
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M18 20a6 6 0 0 0-3-5" /></>,
  seed: <><path d="M12 21V11" /><path d="M12 11c0-4 3-7 8-7 0 5-3 7-8 7z" /><path d="M12 14c0-3-2.5-5-7-5 0 4 2.5 5 7 5z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};
function Ico({ name, size = 20, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const NAV = [
  ["#policy", "Policy"],
  ["#incentives", "Incentives"],
  ["#conferences", "Conference support"],
  ["#seed-funding", "Seed funding"],
  ["#guidelines", "Guidelines"],
];

function SectionHead({ eyebrow, title, intro, center = false }) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-bold leading-tight text-ink sm:text-4xl">{title}</h2>
      {intro && <p className="mt-3 text-[15px] text-muted">{intro}</p>}
    </div>
  );
}

function LoginButton({ signedIn, size = "md", className = "" }) {
  const pad = size === "lg" ? "px-6 py-3 text-[15px]" : "px-4 py-2 text-sm";
  return (
    <Link
      href={signedIn ? "/dashboard" : "/login"}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-brand font-semibold text-white shadow-sm transition hover:bg-brand-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${pad} ${className}`}
    >
      {signedIn ? "Open dashboard" : "Login"} <Ico name="arrow" size={16} />
    </Link>
  );
}

export default function LandingPage({ signedIn = false }) {
  const year = POLICY_META.year.replace("Academic Year ", "AY ");
  return (
    <div className="min-h-screen bg-canvas">
      {/* ================= Header ================= */}
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="ATLAS Research — home"><BrandLogo /></Link>
          <nav className="hidden items-center gap-6 text-sm lg:flex" aria-label="Sections">
            {NAV.map(([href, label]) => (
              <a key={href} href={href} className="font-medium text-muted transition hover:text-ink">{label}</a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/publications" className="hidden text-sm font-medium text-muted hover:text-ink sm:inline">Publications</Link>
            <LoginButton signedIn={signedIn} />
          </div>
        </div>
      </header>

      <main>
        {/* ================= Hero ================= */}
        <section className="relative overflow-hidden border-b border-line bg-white">
          <div className="orbit right-[-160px] top-[-120px] h-[520px] w-[520px]" aria-hidden="true" />
          <div className="orbit right-[-60px] top-[40px] h-[340px] w-[340px]" aria-hidden="true" />
          <span className="absolute bottom-[-60px] left-[-40px] h-44 w-44 rounded-full bg-[#c7d84a]/60" aria-hidden="true" />

          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:py-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line bg-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-brand">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> {POLICY_META.title} · {year}
              </p>
              <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] text-ink sm:text-5xl lg:text-6xl">
                Research that is <span className="text-accent">recognised,</span> rewarded and celebrated.
              </h1>
              <p className="mt-5 max-w-xl text-base text-muted">
                Whether you publish in globally recognised journals, file intellectual property, present at international
                conferences, develop online courses or lead funded projects, every substantive contribution is acknowledged,
                rewarded and celebrated at ATLAS SkillTech University.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <LoginButton signedIn={signedIn} size="lg" />
                <a href="#incentives" className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-6 py-3 text-[15px] font-semibold text-ink transition hover:border-brand/40 hover:bg-soft">
                  View incentives
                </a>
              </div>
              <dl className="mt-9 grid gap-3 sm:grid-cols-3">
                {[
                  ["calendar", "Effective from", POLICY_META.effectiveFrom],
                  ["shield", "Approved by", "URC & Academic Council"],
                  ["people", "Applicable to", "Full-time faculty"],
                ].map(([icon, k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-white p-3">
                    <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted"><Ico name={icon} size={14} className="text-accent" />{k}</dt>
                    <dd className="mt-1 text-sm font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="relative">
              <Photo src={PHOTOS.hero} label="Researchers at work in a laboratory" className="aspect-[4/5] w-full rounded-2xl shadow-xl sm:aspect-[5/4] lg:aspect-[4/5]">
                <div className="absolute inset-0 bg-gradient-to-t from-brand-dark/80 via-brand/10 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">Top journal reward</p>
                  <p className="mt-1 font-display text-3xl font-bold">₹2,00,000</p>
                  <p className="text-sm text-white/85">per Q1 / ABDC A* Scopus or WOS paper</p>
                </div>
              </Photo>
              <Photo src={PHOTOS.library} className="absolute -left-6 -top-6 hidden h-32 w-32 rounded-2xl border-4 border-white shadow-lg sm:block" />
            </div>
          </div>
        </section>

        {/* ================= Highlights ================= */}
        <section className="bg-brand">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
            {HIGHLIGHTS.map((h) => (
              <div key={h.label} className="px-2 py-7 text-center sm:px-4">
                <p className="font-display text-2xl font-bold text-white sm:text-3xl">{h.value}</p>
                <p className="mt-1 text-sm font-semibold text-white/90">{h.label}</p>
                <p className="mt-0.5 text-xs text-white/60">{h.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ================= Preamble ================= */}
        <section id="policy" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
            <Photo src={PHOTOS.collaboration} label="Faculty and scholars collaborating" className="aspect-[4/3] w-full rounded-2xl shadow-lg" />
            <div>
              <SectionHead eyebrow="Preamble" title="A dynamic hub of innovation, creativity and knowledge creation." />
              <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-muted">
                {PREAMBLE.map((p, i) => <p key={i}>{p}</p>)}
              </div>
            </div>
          </div>
        </section>

        {/* ================= Objectives ================= */}
        <section className="border-y border-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHead eyebrow="Objectives" title="What the policy sets out to do" intro={`The key objectives of this Research Promotion Policy for ${year}.`} />
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <li className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-brand p-5 text-white" aria-hidden="true">
                <div className="orbit right-[-70px] top-[-70px] h-48 w-48 !border-white/20" />
                <p className="font-display text-5xl font-bold">7</p>
                <p className="mt-6 text-sm text-white/85">objectives, one goal: a fair, transparent and outcomes-driven research culture.</p>
              </li>
              {OBJECTIVES.map((o, i) => (
                <li key={o.title} className="rounded-xl border border-line bg-canvas p-5 transition hover:border-brand/30 hover:bg-white hover:shadow-sm">
                  <span className="font-display text-sm font-bold text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-1 text-base font-bold text-ink">{o.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{o.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ================= Incentives ================= */}
        <section id="incentives" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHead eyebrow={`Faculty Rewards and Research Incentives · ${year}`} title="Rewards for every research outcome" intro="Reward amount in ₹ per unit." />
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-brand/20 bg-brand-50 px-4 py-3 text-sm text-ink">
              <Ico name="info" size={18} className="mt-0.5 shrink-0 text-brand" />
              <p><b>Note:</b> {INCENTIVE_NOTE}</p>
            </div>

            <div className="mt-8 gap-5 lg:columns-2">
              {INCENTIVES.map((cat) => (
                <article key={cat.key} className="mb-5 break-inside-avoid overflow-hidden rounded-xl border border-line bg-white">
                  <header className="flex items-center gap-3 border-b border-line bg-soft px-5 py-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white"><Ico name={cat.icon} size={18} /></span>
                    <h3 className="text-base font-bold text-ink">{cat.title}</h3>
                  </header>
                  <ul className="divide-y divide-line">
                    {cat.items.map(([desc, amount]) => (
                      <li key={desc} className="flex items-start justify-between gap-4 px-5 py-3.5">
                        <span className="text-sm text-ink">{desc}</span>
                        <span className="shrink-0 rounded-md bg-accent-soft px-2 py-1 text-sm font-bold text-accent">{amount}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ================= Conference support ================= */}
        <section id="conferences" className="scroll-mt-20 border-y border-line bg-white">
          <Photo src={PHOTOS.conference} label="Audience at an academic conference" className="h-56 w-full sm:h-72">
            <div className="absolute inset-0 bg-gradient-to-r from-brand-dark/90 via-brand/70 to-brand/30" />
            <div className="relative mx-auto flex h-full max-w-6xl flex-col justify-end px-4 pb-8 sm:px-6">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">{year}</p>
              <h2 className="mt-1 max-w-2xl font-display text-3xl font-bold leading-tight text-white sm:text-4xl">Financial support to attend conferences, FDPs and workshops</h2>
            </div>
          </Photo>
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
            <p className="max-w-3xl text-[15px] text-muted">{CONFERENCE_INTRO} The following conditions apply:</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {CONFERENCE_CONDITIONS.map((c) => (
                <li key={c} className="flex items-start gap-2.5 text-sm text-ink">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok"><Ico name="check" size={13} /></span>{c}
                </li>
              ))}
            </ul>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CONFERENCE_SUPPORT.map((s) => (
                <article key={s.description} className="flex flex-col rounded-xl border border-line bg-canvas p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">{s.scope}</p>
                  <p className="mt-2 font-display text-3xl font-bold text-brand">{s.amount}</p>
                  <p className="text-xs font-medium text-muted">amount up to · duty leave not more than {s.leave.toLowerCase()}</p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-ink">{s.description}</p>
                  <p className="mt-4 border-t border-line pt-3 text-xs text-muted">Apply using Annexure and attach relevant documents</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ================= Seed funding ================= */}
        <section id="seed-funding" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
            <div className="order-2 lg:order-1">
              <SectionHead eyebrow="Seed Funding Support" title="Room to test bold, early-stage ideas" />
              <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-muted">
                {SEED_FUNDING.map((p, i) => <p key={i}>{p}</p>)}
              </div>
              <p className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">Seed funding can support</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {SEED_USES.map((u) => (
                  <li key={u} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink">
                    <Ico name="seed" size={14} className="text-ok" />{u}
                  </li>
                ))}
              </ul>
            </div>
            <Photo src={PHOTOS.seed} label="Early-stage research notes" className="order-1 aspect-[4/3] w-full rounded-2xl shadow-lg lg:order-2" />
          </div>
        </section>

        {/* ================= How to apply ================= */}
        <section className="border-y border-line bg-white">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHead eyebrow="Annexure – I" title="How to apply for support" intro="Application for support to attend / present in conferences, FDPs, workshops etc. (attach program details)." />
            <ol className="mt-10 grid gap-4 md:grid-cols-4">
              {APPLY_STEPS.map((s, i) => (
                <li key={s.title} className="relative rounded-xl border border-line bg-canvas p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand font-display text-sm font-bold text-white">{i + 1}</span>
                  <h3 className="mt-3 text-base font-bold text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 rounded-xl border border-dashed border-brand/30 bg-brand-50/60 p-5">
              <p className="text-sm font-semibold text-ink">Details asked for in the Annexure I application</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {ANNEXURE_FIELDS.map((f) => <li key={f} className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-line">{f}</li>)}
              </ul>
              <p className="mt-4 text-xs text-muted">
                The applicant certifies that their academic work will not suffer (arrangements approved by the Dean / HOD) and that no financial
                assistance for the same purpose is received from any other source.
              </p>
            </div>
          </div>
        </section>

        {/* ================= Guidelines ================= */}
        <section id="guidelines" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <SectionHead eyebrow="Guidelines" title="Guidelines to avail academic support and research incentives" />
            <ul className="mt-8 grid gap-x-8 gap-y-3 md:grid-cols-2">
              {GUIDELINES.map((g) => (
                <li key={g} className="flex items-start gap-3 rounded-lg px-1 py-1.5 text-sm leading-relaxed text-ink">
                  <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"><Ico name="check" size={13} /></span>{g}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ================= CTA ================= */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="relative overflow-hidden rounded-2xl bg-brand px-6 py-12 text-center sm:px-12">
            <div className="orbit left-[-120px] top-[-160px] h-[420px] w-[420px] !border-white/15" aria-hidden="true" />
            <div className="orbit right-[-100px] bottom-[-200px] h-[420px] w-[420px] !border-accent/40" aria-hidden="true" />
            <p className="relative text-[11px] font-semibold uppercase tracking-widest text-white/70">Research Publication Portal</p>
            <h2 className="relative mx-auto mt-2 max-w-2xl font-display text-3xl font-bold leading-tight text-white sm:text-4xl">
              Submit your research and track every stage.
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-[15px] text-white/80">
              Sign in to submit papers, follow reviews and decisions, and manage your publications.
            </p>
            <Link
              href={signedIn ? "/dashboard" : "/login"}
              className="relative mt-7 inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-[15px] font-semibold text-brand shadow-sm transition hover:bg-brand-50"
            >
              {signedIn ? "Open dashboard" : "Login to the portal"} <Ico name="arrow" size={16} />
            </Link>
          </div>
        </section>
      </main>

      {/* ================= Footer ================= */}
      <footer className="border-t border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
          <Image src="/brand/atlas-lockup-indigo.svg" alt="ATLAS SkillTech University" width={LOCKUP_W} height={LOCKUP_H} className="h-9 w-auto" unoptimized />
          <p className="text-center text-xs text-muted">
            {POLICY_META.title} · {POLICY_META.year} · Effective from {POLICY_META.effectiveFrom} · © ATLAS SkillTech University, Mumbai
          </p>
        </div>
      </footer>
    </div>
  );
}
