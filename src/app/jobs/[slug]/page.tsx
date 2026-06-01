// Public job detail page — clean, professional, content-first.
// No gimmicks (aurora shimmer, mesh blobs, 3D tilts, custom cursor)
// — just a strong typography hierarchy, generous whitespace, and
// understated motion (scroll-reveal + magnetic CTA + subtle hover
// states). Reads like Stripe / Linear / Notion careers pages.

import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import {
  MapPin, Briefcase, Clock, IndianRupee, Users, ArrowRight,
  Share2, ChevronLeft, Rocket, Heart, TrendingUp,
  Globe, Mail, Calendar, ChevronRight, Download, FileText,
  ChevronDown,
} from "lucide-react";
import JobShareButton from "./JobShareButton";
import Reveal from "./Reveal";
import Magnetic from "./Magnetic";
import ScrollProgress from "./ScrollProgress";
import WordReveal from "./WordReveal";
import PlayBadges from "./PlayBadges";

export const dynamic = "force-dynamic";

type PublicJob = {
  id: number;
  title: string;
  slug: string;
  department: string | null;
  location: string | null;
  brand: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  salaryUnit:  string | null;   // 'lpa' | 'monthly' | 'annual'
  description: string | null;
  vacancies: number;
  publishedAt: Date | null;
  closesAt: Date | null;
  jdFileUrl: string | null;
  jdFileName: string | null;
};

// Append the configured unit suffix to a free-text compensation
// figure when it doesn't already carry one. HR types "5" or "5 - 15"
// in the wizard and the public page should render "5 LPA" / "5 - 15
// LPA" / "₹50,000 monthly" depending on the unit they picked.
function fmtCompensation(range: string | null | undefined, unit: string | null | undefined): string | null {
  if (!range) return null;
  const trimmed = range.trim();
  if (!trimmed) return null;
  // Already contains a unit hint — leave it alone.
  if (/lpa|per\s*annum|annual|p\.?\s*a\.?|monthly|per\s*month|p\.?\s*m\.?|\/month|\/year|crore|cr\b|\bk\b|\$|€|£/i.test(trimmed)) {
    return trimmed;
  }
  const suffix =
    unit === "monthly" ? "monthly"
    : unit === "annual" ? "annual"
    : "LPA";   // default for both null and "lpa"
  return `${trimmed} ${suffix}`;
}

async function loadJob(slug: string): Promise<PublicJob | null> {
  try {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange", "salaryUnit",
                description, vacancies, "publishedAt", "closesAt",
                "jdFileUrl", "jdFileName"
           FROM "JobOpening"
          WHERE "publicSlug" = $1
            AND "status" = 'published'
            AND ("closesAt" IS NULL OR "closesAt" > NOW())
          LIMIT 1`,
        slug,
      );
      return (rows[0] ?? null) as PublicJob | null;
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      if (code !== "42703" && !/does not exist/i.test(String(e?.message))) throw e;
      // Legacy fallback — older DBs lack salaryUnit and/or jdFile* cols.
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange",
                NULL AS "salaryUnit",
                description, vacancies, "publishedAt", "closesAt",
                NULL AS "jdFileUrl", NULL AS "jdFileName"
           FROM "JobOpening"
          WHERE "publicSlug" = $1
            AND "status" = 'published'
            AND ("closesAt" IS NULL OR "closesAt" > NOW())
          LIMIT 1`,
        slug,
      );
      return (rows[0] ?? null) as PublicJob | null;
    }
  } catch {
    return null;
  }
}

function brandLabel(brand: string | null): string {
  return brand === "yt_labs" ? "YT Labs" : "NB Media";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const job = await loadJob(slug);
  if (!job) return { title: "Job not found" };
  const brand = brandLabel(job.brand);
  return {
    title: `${job.title} — ${brand} Careers`,
    description: job.description?.slice(0, 160) || `${job.title} role at ${brand}. Apply now.`,
    openGraph: {
      title: `${job.title} — ${brand} Careers`,
      description: job.description?.slice(0, 160) || `Open role at ${brand}. Apply now.`,
      type: "website",
    },
  };
}

export default async function PublicJobDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await loadJob(slug);
  if (!job) notFound();

  const brand = brandLabel(job.brand);
  const publishedLabel = job.publishedAt
    ? new Date(job.publishedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const closesLabel = job.closesAt
    ? new Date(job.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
  const applyHref = `/jobs/apply?role=${job.id}`;
  const showDeptInBreadcrumb = job.department && job.department.toLowerCase() !== job.title.toLowerCase();

  return (
    <div
      // Soft cool-gray off-white. Easier on the eyes than pure white
      // under long reading; cards stay #ffffff so they pop with a
      // crisp visual layer above the body.
      className="min-h-screen bg-[#e2e8f0] text-slate-900 antialiased"
      style={{ scrollBehavior: "smooth" }}
    >
      <ScrollProgress />
      <style>{`
        @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(6px); } }
        .bob { animation: bob 2s ease-in-out infinite; }
      `}</style>

      {/* ── Top nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#e2e8f0]/85 backdrop-blur supports-[backdrop-filter]:bg-[#e2e8f0]/70">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-2">
          <Link href="/jobs" className="flex items-center gap-2.5 group min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f8fafc] ring-1 ring-slate-300/60 shadow-sm overflow-hidden transition-transform group-hover:scale-[1.04] shrink-0">
              <img src="/logo.png" alt={`${brand} logo`} className="h-7 w-7 object-contain" />
            </div>
            <div className="leading-tight min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-900 truncate">{brand}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Careers</p>
            </div>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/jobs"
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 text-[12.5px] font-medium text-slate-600 hover:text-slate-900 rounded-lg transition-colors"
            ><ChevronLeft size={14} /> All openings</Link>
            <Link
              href={applyHref}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[12.5px] font-semibold transition-colors"
            >
              Apply
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero — sized to natural content, not forced fullscreen */}
      <section className="relative overflow-hidden border-b border-slate-100">
        {/* Layered gradient backdrop — mobile gets a richer, more
            saturated wash so the page feels intentional even without
            the desktop's floating social badges. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-b from-blue-50/60 via-white to-[#e2e8f0]" />
        <div aria-hidden="true" className="absolute -top-32 -left-32 -z-10 h-[460px] w-[460px] rounded-full bg-[#3b82f6]/[0.12] blur-[110px]" />
        <div aria-hidden="true" className="absolute -top-20 -right-24 -z-10 h-[360px] w-[360px] rounded-full bg-[#a855f7]/[0.07] blur-[100px] sm:hidden" />
        {/* Floating social-platform badges — desktop only (component
            self-hides on phones because they fight the title/chips). */}
        <PlayBadges />

        <div className="w-full max-w-5xl mx-auto px-5 sm:px-8 pt-8 sm:pt-20 pb-10 sm:pb-24">
          <Reveal direction="up">
            <nav className="flex items-center gap-1.5 text-[11.5px] sm:text-[12px] text-slate-500 mb-5 sm:mb-7 overflow-x-auto whitespace-nowrap">
              <Link href="/jobs" className="hover:text-slate-900 transition-colors font-medium shrink-0">Careers</Link>
              {showDeptInBreadcrumb && (<>
                <span className="text-slate-300 shrink-0">/</span>
                <span className="shrink-0">{job.department}</span>
              </>)}
              <span className="text-slate-300 shrink-0">/</span>
              <span className="text-slate-900 font-medium truncate max-w-[180px] sm:max-w-[260px]">{job.title}</span>
            </nav>

            {/* OPEN-ROLE chip — a single tight pill on mobile so it
                doesn't break to two lines. */}
            <div className="inline-flex items-center gap-2 rounded-full bg-white/90 ring-1 ring-slate-200/80 px-3 py-1 text-[10.5px] sm:text-[11px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)] mb-5 sm:mb-6 backdrop-blur">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-emerald-400/70 animate-ping" />
                <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-slate-700 uppercase tracking-wider">{brand}</span>
              <span className="text-slate-300">·</span>
              <span className="text-emerald-600 uppercase tracking-wider">Open role</span>
            </div>
          </Reveal>

          {/* Title — word-by-word reveal. Plain slate-900 so the
              animation is the focus, not a gradient. Mobile floor
              tightened to 1.75rem so 2 long words still fit on one
              line on most 360px+ devices. */}
          <h1
            className="font-bold tracking-[-0.028em] text-slate-900 leading-[1.06] sm:leading-[1.04] break-words"
            style={{ fontSize: "clamp(1.75rem, 6vw, 3.8rem)" }}
          >
            <WordReveal text={job.title} staggerMs={70} baseDelayMs={120} />
          </h1>
          {job.department && (
            <Reveal direction="up" delay={120 + job.title.split(/\s+/).length * 70}>
              <p className="mt-3 sm:mt-4 text-[14px] sm:text-[16px] text-slate-500">
                on the <span className="font-semibold text-slate-800">{job.department}</span> team
              </p>
            </Reveal>
          )}

          {/* Meta chips — on mobile we display them as a 2-column
              grid (tight, easy to scan) instead of a free-wrap that
              creates uneven row heights. */}
          <Reveal direction="up" delay={160}>
            <div className="mt-6 sm:mt-7 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              {job.location        && <Chip icon={MapPin}     label={job.location} />}
              {job.employmentType  && <Chip icon={Briefcase}  label={job.employmentType} />}
              {job.experienceLevel && <Chip icon={Clock}      label={job.experienceLevel} />}
              {fmtCompensation(job.salaryRange, job.salaryUnit) && <Chip icon={IndianRupee} label={fmtCompensation(job.salaryRange, job.salaryUnit)!} />}
              {job.vacancies > 1   && <Chip icon={Users}      label={`${job.vacancies} positions`} />}
            </div>
          </Reveal>

          {/* Primary CTAs — apply is full-width-feel on mobile (h-12,
              big tap target, gradient + glow), View-JD sits next to
              it as the secondary. Share + Posted move into their own
              tertiary row on mobile so the primary actions own the
              eye-line. */}
          <Reveal direction="up" delay={240}>
            <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 sm:gap-3">
              <Magnetic strength={0.16}>
                <Link
                  href={applyHref}
                  className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 sm:h-11 px-6 rounded-xl bg-gradient-to-r from-[#3b82f6] via-[#60a5fa] to-[#3b82f6] bg-[length:200%_100%] hover:bg-right !text-white text-[14px] sm:text-[13.5px] font-semibold transition-all shadow-[0_6px_18px_-4px_rgba(59,130,246,0.55)] hover:shadow-[0_10px_24px_-4px_rgba(59,130,246,0.6)] [&_svg]:text-white"
                  style={{ color: "#fff", transition: "background-position 0.5s ease, box-shadow 0.3s ease" }}
                >
                  Apply for this role
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Magnetic>
              {job.jdFileUrl && (
                /\.pdf(\?|$)/i.test(job.jdFileUrl) ? (
                  <a
                    href="#job-description"
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 sm:h-11 px-5 rounded-xl border border-slate-300/70 bg-white hover:border-[#3b82f6]/60 hover:bg-[#3b82f6]/[0.04] text-slate-800 text-[13.5px] sm:text-[13px] font-semibold transition-colors"
                    title={job.jdFileName || "Read the job description below"}
                  >
                    <FileText size={14} /> View JD
                  </a>
                ) : (
                  <a
                    href={job.jdFileUrl}
                    download={job.jdFileName || undefined}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-12 sm:h-11 px-5 rounded-xl border border-slate-300/70 bg-white hover:border-[#3b82f6]/60 hover:bg-[#3b82f6]/[0.04] text-slate-800 text-[13.5px] sm:text-[13px] font-semibold transition-colors"
                    title={job.jdFileName || "Download the job description"}
                  >
                    <Download size={14} /> Download JD
                  </a>
                )
              )}
            </div>

            {/* Tertiary row — Share + Posted date. On mobile this is
                a separate row beneath the primary CTAs; on desktop it
                inlines with them. */}
            <div className="mt-3 sm:mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
              <JobShareButton
                title={job.title}
                brand={brand}
                className="inline-flex items-center justify-center gap-2 h-10 sm:h-11 px-4 sm:px-5 rounded-xl border border-slate-200 bg-white/80 hover:bg-slate-50 text-slate-700 text-[12.5px] sm:text-[13px] font-medium transition-colors backdrop-blur"
              >
                <Share2 size={13} /> Share
              </JobShareButton>
              {publishedLabel && (
                <span className="text-[11.5px] sm:text-[12px] text-slate-500 inline-flex items-center gap-1.5">
                  <Calendar size={12} /> Posted {publishedLabel}
                  {closesLabel && <span className="hidden sm:inline"> · Closes {closesLabel}</span>}
                </span>
              )}
            </div>
          </Reveal>

        </div>
      </section>

      {/* ── Body ────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-4 sm:px-8 py-10 sm:py-16 space-y-6 sm:space-y-8">
        {/* At a glance — Each Fact cell staggers in. */}
        <section className="">
          <Reveal direction="up" className="w-full">
            <Card>
              <CardHeader title="At a glance" eyebrow="Quick summary" />
              <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100 border-t border-slate-100">
                {(() => {
                  // "Posted" intentionally NOT in the Quick Summary —
                  // the candidate already sees it under the hero CTAs.
                  // No need to duplicate it in the at-a-glance card.
                  const facts: Array<[string, string]> = [];
                  if (job.department)      facts.push(["Department",     job.department]);
                  if (job.location)        facts.push(["Location",        job.location]);
                  if (job.employmentType)  facts.push(["Employment",      job.employmentType]);
                  if (job.experienceLevel) facts.push(["Experience",      job.experienceLevel]);
                  const comp = fmtCompensation(job.salaryRange, job.salaryUnit);
                  if (comp)                facts.push(["Compensation",    comp]);
                  if (job.vacancies > 1)   facts.push(["Openings",        `${job.vacancies} positions`]);
                  if (closesLabel)         facts.push(["Closes",          closesLabel]);
                  return facts.map(([label, value], i) => (
                    <Reveal key={label} direction="up" delay={80 * i}>
                      <Fact label={label} value={value} />
                    </Reveal>
                  ));
                })()}
              </dl>
              {job.jdFileUrl && (
                <div className="border-t border-slate-100 px-5 sm:px-8 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100 text-[#3b82f6] flex-shrink-0">
                      <FileText size={15} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#3b82f6]">Job description PDF</p>
                      <p className="text-[12.5px] font-medium text-slate-700 truncate">{job.jdFileName || "Job description"}</p>
                    </div>
                  </div>
                  <a
                    href={job.jdFileUrl}
                    download={job.jdFileName || undefined}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[#60a5fa] hover:bg-[#3b82f6] text-white text-[12px] font-semibold transition-colors w-full sm:w-auto"
                  ><Download size={12} /> Download JD</a>
                </div>
              )}
            </Card>
          </Reveal>
        </section>

        {/* About the role — panel 3 */}
        <section className="">
          <Reveal direction="up" className="w-full">
            <Card>
              <CardHeader title="About the role" eyebrow="The opportunity" />
              <div className="px-5 sm:px-10 pb-7 sm:pb-10">
                {job.description && job.description.trim() ? (
                  <div className="text-[14px] sm:text-[15px] text-slate-700 leading-[1.8] whitespace-pre-wrap max-w-3xl break-words">
                    {job.description}
                  </div>
                ) : (
                  <div className="text-[13.5px] sm:text-[14px] text-slate-600 leading-[1.75] rounded-xl bg-slate-50 border border-slate-100 px-4 sm:px-5 py-4 max-w-3xl">
                    Full role description is shared at the interview stage. If this opportunity excites you, apply and we'll send the brief along.
                  </div>
                )}
              </div>
            </Card>
          </Reveal>
        </section>

        {/* Job description PDF — embedded preview so applicants can
            read the full brief without downloading. PDFs render via
            <object>; if the browser can't display it, the same
            element falls back to a "Open in new tab" card. */}
        {job.jdFileUrl && /\.pdf(\?|$)/i.test(job.jdFileUrl) && (
          <section id="job-description">
            <Reveal direction="up" className="w-full">
              <Card>
                <CardHeader title="Full job description" eyebrow="Read the brief" />
                <div className="px-4 sm:px-8 pb-6 sm:pb-8">
                  {/* Branded document frame — looks like a polished
                      preview card instead of the raw browser PDF
                      viewer. The PDF itself is rendered chromeless
                      (toolbar=0) and our own header strip lives above
                      it so the page's design owns the visuals end-to-
                      end. */}
                  <div className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
                    {/* Top action strip — stacks vertically on phones
                        so the title and CTAs each get a full row,
                        side-by-side on tablet/desktop. */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-3 sm:px-5 py-3 bg-gradient-to-r from-[#eff6ff] via-white to-white border-b border-slate-200/80">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#3b82f6] text-white shadow-sm shadow-blue-200 flex-shrink-0">
                          <FileText size={16} strokeWidth={2.2} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[#3b82f6]">
                            Job description · PDF preview
                          </p>
                          <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight mt-0.5">
                            {job.jdFileName || "Job description"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <a
                          href={`/api/public/jd/${slug}`}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[12px] font-semibold transition-colors"
                        >Open</a>
                        <a
                          href={`/api/public/jd/${slug}`}
                          download={job.jdFileName || undefined}
                          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12px] font-semibold transition-colors shadow-sm shadow-blue-200"
                        ><Download size={12} /> Download</a>
                      </div>
                    </div>

                    {/* PDF surface — responsive height: ~60vh on
                        phones, 820px on tablets+ so the document
                        feels like a previewable card rather than a
                        forced 820px column. */}
                    <div
                      className="bg-slate-50 p-1.5 sm:p-4"
                      style={{ boxShadow: "inset 0 1px 0 rgba(15,23,42,0.03)" }}
                    >
                      <iframe
                        src={`/api/public/jd/${slug}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                        title={job.jdFileName || "Job description"}
                        className="w-full block rounded-md sm:rounded-lg bg-white shadow-sm h-[60vh] min-h-[420px] sm:h-[820px]"
                        style={{ border: 0 }}
                      />
                    </div>
                  </div>

                  <p className="mt-3 text-[10.5px] text-slate-400 text-center px-2">
                    Trouble viewing?{" "}
                    <a href={`/api/public/jd/${slug}`} target="_blank" rel="noopener noreferrer" className="text-[#3b82f6] hover:underline font-medium">
                      Open the PDF in a new tab
                    </a>
                    {" "}or{" "}
                    <a href={`/api/public/jd/${slug}`} download={job.jdFileName || undefined} className="text-[#3b82f6] hover:underline font-medium">
                      download it
                    </a>.
                  </p>
                </div>
              </Card>
            </Reveal>
          </section>
        )}

        {/* Why join — panel 4 */}
        <section className="">
          <Reveal direction="up" className="w-full">
            <Card>
              <CardHeader title={`Why join ${brand}`} eyebrow="Why us" />
              <div className="px-6 sm:px-8 pb-7 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Reveal direction="up" delay={120}>
                  <PerkCard tone="orange"  icon={Rocket}     title="Real impact, fast" body="Ship work that goes live on channels you watch. Your output is visible from week one — no holding pattern." />
                </Reveal>
                <Reveal direction="up" delay={240}>
                  <PerkCard tone="rose"    icon={Heart}      title="A team that ships" body="Hybrid from Mohali. Async docs, regular reviews, zero busywork. People who care about the craft." />
                </Reveal>
                <Reveal direction="up" delay={360}>
                  <PerkCard tone="emerald" icon={TrendingUp} title="Growth, honestly" body="Quarterly reviews, transparent KPI tracking, and clear paths to lead or senior — earned, not given." />
                </Reveal>
              </div>
            </Card>
          </Reveal>
        </section>

        {/* About company — panel 5 */}
        <section className="">
          <Reveal direction="up" className="w-full">
            <Card className="relative overflow-hidden">
              <div aria-hidden="true" className="absolute -top-12 -right-12 h-44 w-44 rounded-full bg-[#3b82f6]/[0.06] blur-3xl pointer-events-none" />
              <div className="relative">
                <CardHeader title={`About ${brand}`} eyebrow="Who we are" />
                <div className="px-5 sm:px-10 pb-7 sm:pb-10">
                  <p className="text-[14px] sm:text-[15px] text-slate-700 leading-[1.8] max-w-3xl">
                    {brand === "YT Labs"
                      ? "YT Labs is the strategy, research, and creative engine behind some of India's most-watched YouTube channels. We work end-to-end with creators — from idea to thumbnail to upload — and the team behind the scenes is small, sharp, and unusually obsessed with detail."
                      : "NB Media Productions is an end-to-end content studio shipping work for India's biggest creators and brands. From scripts to edits to release, every part of the pipeline runs in-house. You'll see your work go live on the channels you watch within weeks of joining."}
                  </p>
                  <a
                    href="https://nbmediaproductions.com"
                    target="_blank" rel="noreferrer"
                    className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-900 hover:text-[#3b82f6] transition-colors group"
                  >
                    <Globe size={13} /> nbmediaproductions.com
                    <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                  </a>
                </div>
              </div>
            </Card>
          </Reveal>
        </section>

        {/* Bottom CTA — panel 6 */}
        <section className="">
          <Reveal direction="up" className="w-full">
            <Card>
              <div className="px-6 sm:px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-semibold text-slate-900">Questions about this role?</p>
                  <p className="text-[12.5px] text-slate-500 mt-0.5">We usually reply within a working day.</p>
                </div>
                <a
                  href="mailto:careers@nbmediaproductions.com"
                  className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-[12.5px] font-semibold transition-colors"
                >
                  <Mail size={13} /> careers@nbmediaproductions.com
                </a>
              </div>
            </Card>

            <div
              className="mt-5 relative rounded-3xl overflow-hidden text-slate-900 ring-1 ring-slate-300/60 bg-white"
            >
              {/* Subtle slate wash near the corners gives the white
                  panel just enough depth without losing the clean
                  look. */}
              <div aria-hidden="true" className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-slate-300/30 blur-[100px]" />
              <div aria-hidden="true" className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-slate-300/20 blur-[100px]" />
              {/* Thin red→orange→yellow accent at the top edge —
                  matches the NB Media logo colour ramp. Kept warm
                  because it's the only branded touch on the panel. */}
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[2px]"
                style={{ background: "linear-gradient(90deg, transparent 0%, #ef4444 25%, #f97316 50%, #fbbf24 75%, transparent 100%)" }}
              />
            <div className="relative px-5 sm:px-10 py-8 sm:py-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 sm:gap-6">
              <div className="max-w-xl">
                <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-slate-500 mb-3">Ready when you are</p>
                <h2 className="text-[22px] sm:text-[28px] font-semibold tracking-tight leading-tight text-slate-900">
                  Join{" "}
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
                    {brand}.
                  </span>
                </h2>
                <p className="mt-2 text-[14px] text-slate-700 leading-relaxed">
                  Upload a resume — we'll auto-fill the form. Most applicants finish in under three minutes.
                </p>
              </div>
              <Magnetic strength={0.16}>
                <Link
                  href={applyHref}
                  className="group inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-slate-900 hover:bg-slate-800 !text-white text-[13.5px] font-semibold transition-colors shadow-[0_8px_20px_-6px_rgba(15,23,42,0.4)] whitespace-nowrap w-full sm:w-auto [&_svg]:text-white"
                  style={{ color: "#fff" }}
                >
                  Apply for this role
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Magnetic>
            </div>
          </div>
          </Reveal>
        </section>

        {/* Footer */}
        <footer className="pt-6 pb-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11.5px] text-slate-400">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="" className="h-5 w-5 opacity-70" />
            <span>© {new Date().getFullYear()} {brand}. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/jobs" className="hover:text-slate-700 transition-colors">All openings</Link>
            <a href="mailto:careers@nbmediaproductions.com" className="hover:text-slate-700 transition-colors inline-flex items-center gap-1"><Mail size={11} /> careers</a>
            <a href="https://nbmediaproductions.com" target="_blank" rel="noreferrer" className="hover:text-slate-700 transition-colors inline-flex items-center gap-1"><Globe size={11} /> Website</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  // Card surface uses #f8fafc (slate-50) — one shade lighter than the
  // page bg (#e2e8f0 slate-200) so cards stay visibly elevated while
  // remaining in the same colour family. Border + shadow finish the
  // "raised plaque on a soft surface" look.
  return (
    <div className={`bg-[#f8fafc] rounded-2xl ring-1 ring-slate-300/60 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <div className="px-5 sm:px-10 pt-7 sm:pt-9 pb-5 sm:pb-6">
      <p className="text-[10.5px] sm:text-[11px] font-bold uppercase tracking-[0.16em] text-[#3b82f6] mb-2">{eyebrow}</p>
      <h2 className="text-[20px] sm:text-[28px] font-semibold text-slate-900 tracking-tight">{title}</h2>
    </div>
  );
}

function Chip({ icon: Icon, label }: { icon: any; label: string }) {
  // On mobile we render the chips inside a 2-column grid (see hero
  // above). `inline-flex` would collapse to content-width and look
  // staggered, so we let the chip stretch to its grid cell on mobile
  // and revert to inline-flex pill on tablet+.
  return (
    <span className="flex sm:inline-flex items-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-full bg-white ring-1 ring-slate-200 text-slate-700 text-[12px] sm:text-[12.5px] font-medium shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur min-w-0">
      <Icon size={13} className="text-[#3b82f6] shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

type PerkTone = "orange" | "rose" | "emerald";

const PERK_TONE: Record<PerkTone, { bg: string; shadow: string }> = {
  orange:  {
    bg:     "linear-gradient(135deg, #fb923c 0%, #f97316 50%, #ea580c 100%)",
    shadow: "0 6px 20px -6px rgba(249,115,22,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  rose: {
    bg:     "linear-gradient(135deg, #fb7185 0%, #f43f5e 50%, #e11d48 100%)",
    shadow: "0 6px 20px -6px rgba(244,63,94,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
  emerald: {
    bg:     "linear-gradient(135deg, #34d399 0%, #10b981 50%, #059669 100%)",
    shadow: "0 6px 20px -6px rgba(16,185,129,0.55), inset 0 1px 0 rgba(255,255,255,0.35)",
  },
};

function PerkCard({
  icon: Icon, title, body, tone = "orange",
}: { icon: any; title: string; body: string; tone?: PerkTone }) {
  const t = PERK_TONE[tone];
  return (
    <div className="group relative rounded-xl bg-[#eef2f7] border border-slate-200/70 p-5 hover:bg-[#f8fafc] hover:border-slate-300 hover:shadow-[0_4px_18px_rgba(15,23,42,0.05)] hover:-translate-y-0.5 transition-all">
      <div
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white mb-3 group-hover:scale-[1.06] transition-transform"
        style={{ background: t.bg, boxShadow: t.shadow }}
      >
        <Icon size={17} />
      </div>
      <p className="text-[14.5px] font-semibold text-slate-900 tracking-tight">{title}</p>
      <p className="text-[13px] text-slate-600 mt-1.5 leading-[1.65]">{body}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1.5 text-[13.5px] font-semibold text-slate-900 break-words">{value}</p>
    </div>
  );
}
