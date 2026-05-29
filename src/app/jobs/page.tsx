// Public careers landing — brand-aware (NB Media default; YT Labs
// when ?brand=yt_labs). Sober, professional design. Title is solid
// slate-900 with the brand name highlighted in brand-colour (no
// aurora shimmer). Reveal-on-scroll + magnetic Apply CTA — that's
// the entire motion budget.

import Link from "next/link";
import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import {
  MapPin, Briefcase, Clock, ArrowRight, Sparkles, Building2,
  Rocket, Heart, TrendingUp, Users, Globe, Mail, ChevronRight,
  IndianRupee, ChevronDown,
} from "lucide-react";
import Reveal       from "./[slug]/Reveal";
import Magnetic     from "./[slug]/Magnetic";
import ScrollProgress from "./[slug]/ScrollProgress";
import WordReveal     from "./[slug]/WordReveal";
import PlayBadges    from "./[slug]/PlayBadges";

export const dynamic = "force-dynamic";

type ActiveBrand = "nb_media" | "yt_labs" | "all";

const BRAND_META: Record<"nb_media" | "yt_labs", {
  label:     string;
  domain:    string;
  tagline:   string;
  about:     string;
  /** Used for body text / link colour — needs contrast against white.
   *  The primary CTA uses a LIGHTER shade (blue-400 / purple-400) —
   *  see the conditional Tailwind class on the hero button. */
  accent:    string;
  accentHover: string;
  badgeBg:   string;
  badgeText: string;
}> = {
  nb_media: {
    label:    "NB Media",
    domain:   "nbmediaproductions.com",
    tagline:  "End-to-end content studio",
    about:    "NB Media Productions is an end-to-end content studio shipping work for India's biggest creators and brands. From scripts to edits to release, every part of the pipeline runs in-house. You'll see your work go live on the channels you watch within weeks of joining.",
    accent:   "#3b82f6",
    accentHover: "#2563eb",
    badgeBg:  "bg-blue-50",
    badgeText:"text-[#1d4ed8]",
  },
  yt_labs: {
    label:    "YT Labs",
    domain:   "ytlpro.com",
    tagline:  "Strategy, research & creative engine",
    about:    "YT Labs is the strategy, research, and creative engine behind some of India's most-watched YouTube channels. We work end-to-end with creators — from idea to thumbnail to upload — and the team behind the scenes is small, sharp, and unusually obsessed with detail.",
    accent:   "#a855f7",
    accentHover: "#9333ea",
    badgeBg:  "bg-violet-50",
    badgeText:"text-violet-700",
  },
};

export const metadata: Metadata = {
  title: "Careers — NB Media",
  description: "Open roles at NB Media. Build content for India's biggest creators.",
};

type Row = {
  id: number;
  title: string;
  slug: string;
  department: string | null;
  location: string | null;
  brand: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  vacancies: number;
  publishedAt: Date | null;
};

async function loadJobs(brandFilter: string): Promise<Row[]> {
  try {
    const params: any[] = [];
    let where = `"status" = 'published' AND ("closesAt" IS NULL OR "closesAt" > NOW()) AND "publicSlug" IS NOT NULL`;
    if (brandFilter === "nb_media" || brandFilter === "yt_labs") {
      params.push(brandFilter);
      where += ` AND brand = $${params.length}`;
    }
    try {
      return await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange", vacancies, "publishedAt"
           FROM "JobOpening"
          WHERE ${where}
          ORDER BY "isPriority" DESC, "publishedAt" DESC NULLS LAST, "createdAt" DESC`,
        ...params,
      );
    } catch {
      return await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange", vacancies, "publishedAt"
           FROM "JobOpening"
          WHERE ${where}
          ORDER BY "publishedAt" DESC NULLS LAST, "createdAt" DESC`,
        ...params,
      );
    }
  } catch {
    return [];
  }
}

export default async function CareersIndexPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const { brand: brandQs } = await searchParams;
  const brandParam = (brandQs || "").toLowerCase();

  const activeBrand: ActiveBrand =
    brandParam === "yt_labs" ? "yt_labs"
    : brandParam === "all"    ? "all"
    : "nb_media";

  const isAll  = activeBrand === "all";
  const meta   = isAll ? BRAND_META.nb_media : BRAND_META[activeBrand];
  const brandLabel = isAll ? "NB Media · YT Labs" : meta.label;

  const jobs = isAll
    ? await loadJobs("")
    : await loadJobs(activeBrand);

  const nbCount = activeBrand === "nb_media" ? jobs.length : (await loadJobs("nb_media")).length;
  const ytCount = activeBrand === "yt_labs"  ? jobs.length : (await loadJobs("yt_labs")).length;
  const totalCount = isAll ? (nbCount + ytCount) : jobs.length;

  const departments = new Set<string>();
  jobs.forEach((j) => { if (j.department) departments.add(j.department); });

  const heroHighlight = isAll ? "NB Media" : meta.label;

  return (
    <div
      // Soft cool-gray off-white body for eye comfort. Cards stay pure
      // white so they pop with a crisp visual layer above the body.
      className="min-h-screen bg-[#e2e8f0] text-slate-900 antialiased"
      style={{ scrollBehavior: "smooth" }}
    >
      <ScrollProgress />
      <style>{`
        @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
        .bob { animation: bob 2s ease-in-out infinite; }
      `}</style>

      {/* ── Sticky brand nav ──────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#e2e8f0]/85 backdrop-blur supports-[backdrop-filter]:bg-[#e2e8f0]/70">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link href="/jobs" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f8fafc] ring-1 ring-slate-300/60 shadow-sm overflow-hidden transition-transform group-hover:scale-[1.04]">
              <img src="/logo.png" alt={brandLabel} className="h-7 w-7 object-contain" />
            </div>
            <div className="leading-tight">
              <p className="text-[13.5px] font-semibold text-slate-900">{brandLabel}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Careers</p>
            </div>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <a
              href="#open-roles"
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
            >Open roles</a>
            <a
              href="#why-us"
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
            >Why join</a>
            <a
              href="mailto:careers@nbmediaproductions.com"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[12.5px] font-semibold transition-colors"
            ><Mail size={13} /> Contact</a>
          </nav>
        </div>
      </header>

      {/* ── Hero (scroll-snap panel 1) ───────────────────────── */}
      <section className="relative overflow-hidden border-b border-slate-100 ">
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-blue-50/50 via-[#e2e8f0] to-[#e2e8f0]" />
        <div aria-hidden="true" className="absolute -top-32 -left-32 -z-10 h-[460px] w-[460px] rounded-full blur-[120px]" style={{ background: `${meta.accent}22` }} />
        {/* Floating YouTube play badges — content-studio identity */}
        <PlayBadges />

        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-14">
          <Reveal direction="up">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#f8fafc] ring-1 ring-slate-300/60 px-3 py-1 text-[11px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)] mb-6">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400/70 animate-ping" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-slate-700 uppercase tracking-wider">{totalCount} open role{totalCount === 1 ? "" : "s"}</span>
            </div>
          </Reveal>

          {/* Title — "Build what's next at" animates word by word,
              then the brand name renders as a single static span
              with inline gradient styles. WordReveal's nested spans
              break `background-clip: text`, so we keep the brand
              text un-split and rely on the per-word reveal of the
              preceding phrase for the entrance motion. */}
          <h1
            className="font-semibold tracking-[-0.025em] text-slate-900 leading-[1.04] max-w-4xl"
            style={{ fontSize: "clamp(2.4rem, 6vw, 3.8rem)" }}
          >
            <WordReveal text="Build what's next at" staggerMs={70} baseDelayMs={80} />
            {" "}
            {activeBrand === "yt_labs" ? (
              // Period included inside the coloured span so it
              // inherits the same brand purple.
              <span style={{ color: meta.accent }}>{heroHighlight}.</span>
            ) : (
              // NB Media: warm logo gradient (red → orange → amber).
              // Inline-block + explicit -webkit-text-fill-color for
              // cross-browser reliability. Tested visible on Chrome /
              // Edge / Firefox / Safari.
              <span
                // Brand name AND the trailing period share the same
                // gradient span so the period inherits the warm tone
                // at the end of the ramp (amber/yellow), matching the
                // logo colour family.
                style={{
                  display:                "inline-block",
                  background:             "linear-gradient(115deg, #ef4444 0%, #f97316 45%, #fbbf24 100%)",
                  WebkitBackgroundClip:   "text",
                  backgroundClip:         "text",
                  WebkitTextFillColor:    "transparent",
                  color:                  "transparent",
                }}
              >
                {heroHighlight}.
              </span>
            )}
          </h1>

          <Reveal direction="up" delay={160}>
            <p className="mt-6 text-[16px] sm:text-[17px] text-slate-600 max-w-2xl leading-[1.65]">
              We're a content-first studio shipping work for India's biggest creators — from scripts to thumbnails to release.
              Every application is reviewed by a human, usually within a week.
            </p>
          </Reveal>

          <Reveal direction="up" delay={240}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Magnetic strength={0.16}>
                <a
                  href="#open-roles"
                  className={`group inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl text-white text-[13.5px] font-semibold transition-all ${
                    activeBrand === "yt_labs"
                      ? "bg-[#c084fc] hover:bg-[#a855f7] shadow-[0_4px_14px_-2px_rgba(192,132,252,0.4)] hover:shadow-[0_8px_22px_-4px_rgba(192,132,252,0.5)]"
                      : "bg-[#60a5fa] hover:bg-[#3b82f6] shadow-[0_4px_14px_-2px_rgba(96,165,250,0.4)] hover:shadow-[0_8px_22px_-4px_rgba(96,165,250,0.5)]"
                  }`}
                >
                  See {totalCount} open role{totalCount === 1 ? "" : "s"}
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </a>
              </Magnetic>
              <a
                href="#why-us"
                className="inline-flex items-center gap-1.5 h-12 px-5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-800 text-[13px] font-semibold transition-colors"
              >
                Why join us
              </a>
            </div>
          </Reveal>

        </div>
      </section>

      {/* ── Open roles — panel 2 ──────────────────────────────── */}
      <section id="open-roles" className="relative border-t border-slate-200 bg-slate-50/50 ">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <Reveal direction="up">
            <header className="mb-8">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: meta.accent }}>Hiring now</p>
              <h2 className="text-[26px] sm:text-[32px] font-semibold text-slate-900 tracking-tight">Open roles</h2>
              <p className="mt-2 text-[14px] text-slate-500 max-w-xl">
                {isAll
                  ? "Filter by company or browse everything. Each role has its own page with the full brief and a downloadable JD."
                  : `Open positions at ${meta.label}. Each role has its own page with the full brief and a downloadable JD.`}
              </p>
            </header>
          </Reveal>

          {(nbCount > 0 && ytCount > 0) && (
            <Reveal direction="up" delay={80}>
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                <BrandTab href="/jobs"                active={activeBrand === "nb_media"} label="NB Media" count={nbCount} accent={BRAND_META.nb_media.accent} />
                <BrandTab href="/jobs?brand=yt_labs"  active={activeBrand === "yt_labs"}  label="YT Labs"  count={ytCount} accent={BRAND_META.yt_labs.accent} />
                <BrandTab href="/jobs?brand=all"      active={isAll}                       label="All"     count={nbCount + ytCount} accent="#64748b" />
              </div>
            </Reveal>
          )}

          {jobs.length === 0 ? (
            <Reveal direction="up">
              <div className="rounded-2xl border border-dashed border-slate-300 bg-[#f8fafc] px-8 py-16 text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 mb-4">
                  <Building2 size={22} />
                </div>
                <p className="text-[15px] font-semibold text-slate-800">No open roles right now</p>
                <p className="mt-1.5 text-[13px] text-slate-500 max-w-sm mx-auto">
                  We're between hiring cycles. Drop us your CV at{" "}
                  <a href="mailto:careers@nbmediaproductions.com" className="text-[#3b82f6] font-medium hover:underline">
                    careers@nbmediaproductions.com
                  </a>{" "}
                  and we'll reach out when something opens up.
                </p>
              </div>
            </Reveal>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {jobs.map((j, i) => (
                <Reveal key={j.id} direction="up" delay={i * 70}>
                  <JobListCard job={j} activeBrand={activeBrand} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Why join us — panel 3 ─────────────────────────────── */}
      <section id="why-us" className="relative border-t border-slate-300/60 ">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <Reveal direction="up">
            <header className="mb-10 max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: meta.accent }}>Why us</p>
              <h2 className="text-[26px] sm:text-[32px] font-semibold text-slate-900 tracking-tight">A place where the work goes live.</h2>
              <p className="mt-2 text-[14px] text-slate-500">Three reasons people stay long-term — and what new hires tell us in their first month.</p>
            </header>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Reveal direction="up" delay={0}>
              <ValueCard icon={Rocket} title="Real impact, fast" body="Ship work that goes live on the channels you watch. From day one your edits, scripts, and thumbnails reach millions — no holding pattern." />
            </Reveal>
            <Reveal direction="up" delay={120}>
              <ValueCard icon={Heart} title="A team that ships" body="Hybrid setup from Mohali. Async docs, regular reviews, zero busywork. People who care about the craft, not the hours." />
            </Reveal>
            <Reveal direction="up" delay={240}>
              <ValueCard icon={TrendingUp} title="Growth, honestly" body="Quarterly reviews, transparent KPI tracking, and clear paths to lead or senior — earned, not given. We tell you exactly what gets you there." />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── About brand(s) — panel 4 ──────────────────────────── */}
      <section className="relative border-t border-slate-200 bg-slate-50/50 ">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <Reveal direction="up">
            <header className="mb-10 max-w-2xl">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: meta.accent }}>Who we are</p>
              <h2 className="text-[26px] sm:text-[32px] font-semibold text-slate-900 tracking-tight">
                {isAll ? "Two studios. One team." : `About ${meta.label}.`}
              </h2>
              <p className="mt-2 text-[14px] text-slate-500">
                {isAll
                  ? "You'll be hired into one brand but work alongside both — same office, shared learnings, separate creative tracks."
                  : meta.tagline}
              </p>
            </header>
          </Reveal>

          {isAll ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Reveal direction="up" delay={0}>
                <BrandCard meta={BRAND_META.nb_media} roleCount={nbCount} brandKey="nb_media" />
              </Reveal>
              <Reveal direction="up" delay={120}>
                <BrandCard meta={BRAND_META.yt_labs} roleCount={ytCount} brandKey="yt_labs" />
              </Reveal>
            </div>
          ) : (
            <Reveal direction="up">
              <BrandCard meta={meta} roleCount={jobs.length} brandKey={activeBrand as "nb_media" | "yt_labs"} expanded />
            </Reveal>
          )}
        </div>
      </section>

      {/* ── Bottom apply banner — panel 5 ─────────────────────── */}
      <section className="relative border-t border-slate-200 ">
        <div className="w-full max-w-6xl mx-auto px-5 sm:px-8 py-12 sm:py-16">
          <Reveal direction="up">
            <div
              className="relative overflow-hidden rounded-3xl text-slate-900 ring-1 ring-slate-300/60 bg-white"
            >
              {/* Subtle slate corner glows on the white surface */}
              <div aria-hidden="true" className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-slate-300/30 blur-[110px]" />
              <div aria-hidden="true" className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-slate-300/20 blur-[110px]" />
              {/* Top accent line — brand colour ramp (warm or violet) */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[2px]"
                style={{
                  background: activeBrand === "yt_labs"
                    ? "linear-gradient(90deg, transparent 0%, #a855f7 30%, #c084fc 50%, #a855f7 70%, transparent 100%)"
                    : "linear-gradient(90deg, transparent 0%, #ef4444 25%, #f97316 50%, #fbbf24 75%, transparent 100%)",
                }}
              />
              <div className="relative px-7 sm:px-12 py-12 sm:py-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
                <div className="max-w-xl">
                  <div className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] mb-3 text-slate-500">
                    <Sparkles size={11} /> Ready when you are
                  </div>
                  <h3 className="text-[26px] sm:text-[30px] font-semibold tracking-tight leading-tight text-slate-900">
                    See yourself at{" "}
                    {activeBrand === "yt_labs" ? (
                      // YT Labs: brand word + trailing "?" both in
                      // violet so the punctuation matches the name.
                      <span style={{ color: "#7e22ce" }}>YT Labs?</span>
                    ) : (
                      // NB Media: brand word AND the "?" share the
                      // same red→orange→amber gradient so the
                      // punctuation syncs with the brand text colour.
                      <span
                        style={{
                          display:              "inline-block",
                          background:           "linear-gradient(115deg, #ef4444 0%, #f97316 45%, #fbbf24 100%)",
                          WebkitBackgroundClip: "text",
                          backgroundClip:       "text",
                          WebkitTextFillColor:  "transparent",
                          color:                "transparent",
                        }}
                      >
                        NB Media?
                      </span>
                    )}
                    {" "}Apply now.
                  </h3>
                  <p className="mt-2 text-[14.5px] text-slate-700 leading-relaxed">
                    Pick a role, upload your resume, and we'll auto-fill the form. Most candidates finish in under three minutes.
                  </p>
                </div>
                <Magnetic strength={0.18}>
                  <a
                    href="#open-roles"
                    className="group inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[13.5px] font-semibold transition-colors shadow-[0_8px_20px_-6px_rgba(15,23,42,0.4)] whitespace-nowrap"
                  >
                    See open roles
                    <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                  </a>
                </Magnetic>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="border-t border-slate-300/60">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-5 w-5 opacity-80" />
            <span className="text-[11.5px] text-slate-500">
              © {new Date().getFullYear()} {meta.label}. All rights reserved.
            </span>
          </div>
          <div className="flex items-center gap-5 text-[11.5px] text-slate-500">
            <a href="mailto:careers@nbmediaproductions.com" className="hover:text-slate-800 transition-colors inline-flex items-center gap-1.5"><Mail size={11} /> careers</a>
            <a href={`https://${meta.domain}`} target="_blank" rel="noreferrer" className="hover:text-slate-800 transition-colors inline-flex items-center gap-1.5"><Globe size={11} /> Website</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[26px] sm:text-[32px] font-semibold text-slate-900 tracking-tight tabular-nums leading-none">{value}</p>
      <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-slate-500 mt-2">{label}</p>
    </div>
  );
}

function BrandTab({
  href, active, label, count, accent,
}: { href: string; active: boolean; label: string; count: number; accent: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 h-10 px-4 rounded-full text-[12.5px] font-semibold transition-colors ${
        active
          ? "text-white"
          : "bg-[#f8fafc] border border-slate-300/60 text-slate-700 hover:border-slate-400/70 hover:text-slate-900"
      }`}
      style={active ? { background: accent } : undefined}
    >
      {label}
      <span className={`text-[10.5px] tabular-nums px-1.5 py-0.5 rounded ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
        {count}
      </span>
    </Link>
  );
}

function JobListCard({ job, activeBrand }: { job: Row; activeBrand: ActiveBrand }) {
  const isYT = job.brand === "yt_labs";
  const m = isYT ? BRAND_META.yt_labs : BRAND_META.nb_media;
  const showBrandBadge = activeBrand === "all";

  return (
    <Link
      href={`/jobs/${job.slug}`}
      className="group relative flex flex-col bg-[#f8fafc] rounded-2xl border border-slate-300/60 hover:border-slate-400/70 hover:shadow-[0_8px_28px_-6px_rgba(15,23,42,0.10)] hover:-translate-y-0.5 transition-all overflow-hidden"
    >
      <div aria-hidden="true" className="h-1 w-full" style={{ background: m.accent }} />
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          {showBrandBadge && (
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${m.badgeBg} ${m.badgeText} ring-1 ring-slate-100`}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.accent }} />
              {m.label}
            </span>
          )}
          {job.department && (
            <span className="text-[11px] font-medium text-slate-500">{job.department}</span>
          )}
        </div>

        <h3 className="text-[17px] font-semibold text-slate-900 group-hover:text-[#3b82f6] transition-colors tracking-tight leading-snug">
          {job.title}
        </h3>

        <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12px] text-slate-600">
          {job.location        && <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" /> {job.location}</span>}
          {job.employmentType  && <span className="inline-flex items-center gap-1.5"><Briefcase size={12} className="text-slate-400" /> {job.employmentType}</span>}
          {job.experienceLevel && <span className="inline-flex items-center gap-1.5"><Clock size={12} className="text-slate-400" /> {job.experienceLevel}</span>}
          {job.salaryRange     && <span className="inline-flex items-center gap-1.5"><IndianRupee size={12} className="text-slate-400" /> {job.salaryRange}</span>}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-[12px]">
          <span className="inline-flex items-center gap-1.5 text-slate-500">
            <Users size={12} />
            {job.vacancies > 1 ? `${job.vacancies} positions open` : "1 position"}
          </span>
          <span className="inline-flex items-center gap-1 font-semibold group-hover:gap-1.5 transition-all" style={{ color: m.accent }}>
            View role <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

type ValueTone = "orange" | "rose" | "emerald";

const VALUE_TONE: Record<ValueTone, { bg: string; shadow: string }> = {
  orange:  {
    bg:     "linear-gradient(135deg, #fb923c 0%, #f97316 50%, #ea580c 100%)",
    shadow: "0 8px 22px -6px rgba(249,115,22,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  rose: {
    bg:     "linear-gradient(135deg, #fb7185 0%, #f43f5e 50%, #e11d48 100%)",
    shadow: "0 8px 22px -6px rgba(244,63,94,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  emerald: {
    bg:     "linear-gradient(135deg, #34d399 0%, #10b981 50%, #059669 100%)",
    shadow: "0 8px 22px -6px rgba(16,185,129,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
};

function ValueCard({
  icon: Icon, title, body, tone = "orange",
}: { icon: any; title: string; body: string; tone?: ValueTone }) {
  const t = VALUE_TONE[tone];
  return (
    <div className="group relative rounded-2xl bg-[#f8fafc] border border-slate-300/60 p-6 hover:border-slate-400/70 hover:shadow-[0_4px_22px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 transition-all">
      <div
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-white mb-4 group-hover:scale-[1.06] transition-transform"
        style={{ background: t.bg, boxShadow: t.shadow }}
      >
        <Icon size={18} />
      </div>
      <p className="text-[15.5px] font-semibold text-slate-900 tracking-tight">{title}</p>
      <p className="text-[13.5px] text-slate-600 mt-2 leading-[1.65]">{body}</p>
    </div>
  );
}

function BrandCard({
  meta, roleCount, brandKey, expanded,
}: {
  meta: typeof BRAND_META["nb_media"];
  roleCount: number;
  brandKey: "nb_media" | "yt_labs";
  expanded?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#f8fafc] border border-slate-300/60 hover:border-slate-400/70 transition-colors">
      <div aria-hidden="true" className="absolute -top-16 -right-16 h-44 w-44 rounded-full blur-3xl" style={{ background: `${meta.accent}14` }} />
      <div className={`relative ${expanded ? "p-8 sm:p-10" : "p-7"}`}>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-[0.08em] mb-3 ring-1 ring-slate-100 ${meta.badgeBg} ${meta.badgeText}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.accent }} />
          {meta.label}
        </span>
        <h3 className={`${expanded ? "text-[22px]" : "text-[20px]"} font-semibold text-slate-900 tracking-tight`}>{meta.tagline}</h3>
        <p className={`mt-2.5 ${expanded ? "text-[15px]" : "text-[14px]"} text-slate-600 leading-[1.7] max-w-3xl`}>{meta.about}</p>
        <div className="mt-5 flex items-center gap-4 flex-wrap">
          <Link
            href={`/jobs?brand=${brandKey}`}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors hover:opacity-80"
            style={{ color: meta.accentHover }}
          >
            {roleCount} open role{roleCount === 1 ? "" : "s"} at {meta.label}
            <ChevronRight size={13} />
          </Link>
          <a
            href={`https://${meta.domain}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            <Globe size={11} /> {meta.domain}
          </a>
        </div>
      </div>
    </div>
  );
}
