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
  Share2, ChevronLeft,
  Mail, Calendar, ChevronRight, Download, FileText,
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
  /** Plain-text version of the JD, populated by HR's inline editor.
   *  When set, we render it as styled HTML sections on the page
   *  (so candidates see real headings + bullets, not a flat PDF
   *  iframe). Fallback to the iframe preview when jdText is null. */
  jdText: string | null;
  /** Used as a cache-buster on the public JD URL so a replaced
   *  file invalidates any in-flight browser cache immediately. */
  updatedAt: Date | null;
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

// Extract plain text from a JD file on disk — used to auto-backfill
// jdText for legacy jobs so the HTML view kicks in everywhere. PDF
// goes through pdf-parse v2 (PDFParse class); .docx through mammoth.
// Returns null on failure so the caller can fall back gracefully.
async function tryExtractJdText(jdFileUrl: string): Promise<string | null> {
  try {
    // jdFileUrl is "/uploads/jds/<file>" — resolve relative to /public.
    if (!jdFileUrl.startsWith("/uploads/")) return null;
    const { readFile, realpath } = await import("node:fs/promises");
    const { resolve, extname, sep } = await import("node:path");
    // Resolve the public root through realpath() so any parent
    // symlink in the deployment doesn't fool the prefix check.
    const publicRoot = await realpath(resolve(process.cwd(), "public"));
    const candidate  = resolve(publicRoot, "." + jdFileUrl);
    // realpath() on the candidate catches two attack shapes:
    //   1. Symlink under /public/uploads pointing outside the root.
    //      Without realpath, the symlink's path lives inside public/
    //      and passes the prefix check, but readFile() follows it.
    //   2. A file that doesn't exist — realpath throws ENOENT here,
    //      we treat that the same as a denial.
    let filePath: string;
    try {
      filePath = await realpath(candidate);
    } catch {
      return null;
    }
    // Trailing path-separator on the root prevents a sibling-dir
    // bypass — e.g. "/var/www/public-attacker" would otherwise start
    // with "/var/www/public" and pass.
    const rootPrefix = publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep;
    if (filePath !== publicRoot && !filePath.startsWith(rootPrefix)) return null;
    const buf = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();

    let text = "";
    if (ext === ".pdf") {
      const mod = await import("pdf-parse") as unknown as {
        PDFParse: new (opts: { data: Uint8Array }) => {
          getText: () => Promise<{ text: string }>;
          destroy: () => Promise<void>;
        };
      };
      const parser = new mod.PDFParse({ data: new Uint8Array(buf) });
      try {
        const r = await parser.getText();
        text = String(r?.text ?? "");
      } finally {
        try { await parser.destroy(); } catch { /* noop */ }
      }
    } else if (ext === ".docx" || ext === ".doc") {
      const mammoth = (await import("mammoth")).default;
      const r = await mammoth.extractRawText({ buffer: buf });
      text = String(r?.value ?? "");
    } else if (ext === ".txt" || ext === ".rtf") {
      text = buf.toString("utf8");
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return text || null;
  } catch (e: any) {
    console.error("[jobs/[slug]] auto-backfill jdText failed:", e?.message ?? e);
    return null;
  }
}

async function loadJob(slug: string): Promise<PublicJob | null> {
  try {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange", "salaryUnit",
                description, vacancies, "publishedAt", "closesAt",
                "jdFileUrl", "jdFileName", "jdText", "updatedAt"
           FROM "JobOpening"
          WHERE "publicSlug" = $1
            AND "status" = 'published'
            AND ("closesAt" IS NULL OR "closesAt" > NOW())
          LIMIT 1`,
        slug,
      );
      const row = rows[0] ?? null;
      // Auto-backfill jdText for legacy jobs (created before the
      // inline-edit feature was added). Extract once from the
      // existing PDF, save back to the DB so subsequent renders are
      // instant and the HTML view kicks in. Failures stay silent —
      // the iframe fallback still renders the file.
      if (row && !row.jdText && row.jdFileUrl) {
        const extracted = await tryExtractJdText(row.jdFileUrl);
        if (extracted) {
          row.jdText = extracted;
          try {
            await prisma.$executeRawUnsafe(
              `UPDATE "JobOpening" SET "jdText" = $1 WHERE "id" = $2`,
              extracted, row.id,
            );
          } catch { /* non-fatal */ }
        }
      }
      return row as PublicJob | null;
    } catch (e: any) {
      const code = e?.meta?.code || e?.code;
      if (code !== "42703" && !/does not exist/i.test(String(e?.message))) throw e;
      // Legacy fallback — older DBs lack salaryUnit and/or jdFile* cols.
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, title, "publicSlug" AS slug, department, location, brand,
                "employmentType", "experienceLevel", "salaryRange",
                NULL AS "salaryUnit",
                description, vacancies, "publishedAt", "closesAt",
                NULL AS "jdFileUrl", NULL AS "jdFileName",
                NULL::text AS "jdText",
                "updatedAt"
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

  // Cache-buster for the JD URL — derived from JobOpening.updatedAt so
  // that swapping the file (HR clicks "Replace file") invalidates any
  // browser / CDN cache instantly. Without this, the iframe + open/
  // download links served the previous PDF for up to whatever the
  // intermediate cache TTL allowed.
  const jdRev = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
  const jdUrl = `/api/public/jd/${slug}?v=${jdRev}`;

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
        {/* Job description — rendered as HTML sections from the
            edited jdText. Falls back to the PDF iframe when jdText
            isn't populated (legacy rows). Same NB Media branding as
            the printed PDF: logo at top, watermark behind content.
            Sits ABOVE "About the role" because the full JD is the
            content candidates actually came to read. */}
        {(job.jdText && job.jdText.trim()) ? (
          <section id="job-description">
            <Reveal direction="up" className="w-full">
              <Card>
                <CardHeader title="Full job description" eyebrow="Read the brief" />
                <div className="px-4 sm:px-8 pb-6 sm:pb-8">
                  <JdHtmlPanel
                    text={job.jdText}
                    downloadUrl={job.jdFileUrl ? jdUrl : null}
                    downloadName={job.jdFileName}
                  />
                </div>
              </Card>
            </Reveal>
          </section>
        ) : job.jdFileUrl && /\.pdf(\?|$)/i.test(job.jdFileUrl) ? (
          <section id="job-description">
            <Reveal direction="up" className="w-full">
              <Card>
                <CardHeader title="Full job description" eyebrow="Read the brief" />
                <div className="px-4 sm:px-8 pb-6 sm:pb-8">
                  {/* Legacy fallback: jobs created before the inline-
                      edit feature have no jdText yet. Show the
                      embedded PDF iframe so candidates can still read
                      the brief. */}
                  <div className="rounded-xl sm:rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
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
                          href={jdUrl}
                          target="_blank" rel="noopener noreferrer"
                          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[12px] font-semibold transition-colors"
                        >Open</a>
                        <a
                          href={jdUrl}
                          download={job.jdFileName || undefined}
                          className="inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 h-9 px-3 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12px] font-semibold transition-colors shadow-sm shadow-blue-200"
                        ><Download size={12} /> Download</a>
                      </div>
                    </div>
                    <div className="bg-slate-50 p-1.5 sm:p-4">
                      <iframe
                        src={`${jdUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
                        title={job.jdFileName || "Job description"}
                        className="w-full block rounded-md sm:rounded-lg bg-white shadow-sm h-[60vh] min-h-[420px] sm:h-[820px]"
                        style={{ border: 0 }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </Reveal>
          </section>
        ) : null}

        {/* About the role — short summary HR enters in the wizard.
            Sits BELOW the full JD because once a candidate has read
            the brief, this section serves as a quick distilled pitch
            (and a place to surface HR's framing if the JD itself is
            light). */}
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
                  href="mailto:vanshika@nbmediaproductions.com"
                  className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-[12.5px] font-semibold transition-colors"
                >
                  <Mail size={13} /> vanshika@nbmediaproductions.com
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

// JdHtmlPanel — render HR's edited JD text as a designed document
// on the careers page. Mirrors the printed PDF's visual signature
// (NB Media logo top-right + faded watermark behind the body) so
// candidates see the same branding whether they read it inline or
// download the file. The body text is auto-classified into headings
// (lines ending with `:`), bulleted lists, numbered lists, or plain
// paragraphs — just like the PDF renderer.
function JdHtmlPanel({
  text, downloadUrl, downloadName,
}: {
  text: string;
  downloadUrl: string | null;
  downloadName: string | null;
}) {
  const blocks = parseJdBlocks(text);

  return (
    <div className="relative rounded-xl sm:rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      {/* ── Top strip: brand block on left, logo on right ──── */}
      <div className="relative flex items-start justify-between gap-4 px-5 sm:px-8 pt-5 sm:pt-7 pb-3 border-b border-slate-100 bg-gradient-to-b from-white to-slate-50/40">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#3b82f6]">
            NB Media
          </p>
          <p className="mt-1 text-[12px] sm:text-[13px] text-slate-600 leading-snug">
            YT Money Productions Pvt. Ltd.
          </p>
          <p className="text-[10.5px] sm:text-[11.5px] text-slate-400 leading-snug">
            HRD@nbmediaproductions.com · +91&nbsp;81468&nbsp;91380
          </p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="NB Media"
          className="h-10 sm:h-12 w-auto shrink-0"
        />
      </div>

      {/* ── Body wrapped over a faded watermark ──────────────── */}
      <div className="relative">
        {/* Watermark — large faded logo behind the prose. Pointer-
            events: none so candidates can still select + copy the
            body text without the image interfering. */}
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt=""
            className="w-[60%] max-w-[460px] opacity-[0.05] sm:opacity-[0.06]"
            style={{ filter: "grayscale(20%)" }}
          />
        </div>

        <div className="relative px-5 sm:px-10 py-6 sm:py-8">
          <div
            className="max-w-3xl mx-auto text-slate-800"
            style={{ fontFamily: '"Times New Roman", Georgia, serif' }}
          >
            {blocks.map((block, i) => {
              if (block.kind === "heading") {
                return (
                  <h3
                    key={i}
                    className="mt-6 first:mt-0 mb-2 text-[15.5px] sm:text-[16.5px] font-bold text-slate-900"
                  >
                    {block.text}
                  </h3>
                );
              }
              if (block.kind === "bullet-list") {
                return (
                  <ul key={i} className="my-2 pl-6 space-y-1.5 list-disc marker:text-slate-400">
                    {block.items.map((it, j) => (
                      <li key={j} className="text-[14.5px] leading-[1.7]">{it}</li>
                    ))}
                  </ul>
                );
              }
              if (block.kind === "numbered-list") {
                return (
                  <ol key={i} className="my-2 pl-6 space-y-1.5 list-decimal marker:text-slate-500 marker:font-semibold">
                    {block.items.map((it, j) => (
                      <li key={j} className="text-[14.5px] leading-[1.7]">{it}</li>
                    ))}
                  </ol>
                );
              }
              return (
                <p key={i} className="my-2 text-[14.5px] leading-[1.8] text-slate-700">
                  {block.text}
                </p>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Footer: download CTA (when a PDF is available) ──── */}
      {downloadUrl && (
        <div className="relative border-t border-slate-100 bg-slate-50/60 px-5 sm:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-slate-500">
            Prefer to read offline? Grab a copy.
          </span>
          <a
            href={downloadUrl}
            download={downloadName || undefined}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12px] font-semibold transition-colors shadow-sm shadow-blue-200"
          >
            <Download size={12} /> Download JD
          </a>
        </div>
      )}
    </div>
  );
}

// parseJdBlocks — group raw lines into renderable blocks. Consecutive
// bullet lines collapse into a single <ul>; consecutive "1. 2. 3."
// lines collapse into a single <ol>; everything else is a heading or
// paragraph. Mirrors the auto-format logic in
// src/lib/jd-doc-from-text.ts so the inline HTML and the saved PDF
// stay visually in sync.
type JdBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet-list"; items: string[] }
  | { kind: "numbered-list"; items: string[] };

function parseJdBlocks(text: string): JdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: JdBlock[] = [];
  let bulletBuf: string[]   = [];
  let numberedBuf: string[] = [];

  const flushBullets = () => {
    if (bulletBuf.length) {
      out.push({ kind: "bullet-list", items: bulletBuf });
      bulletBuf = [];
    }
  };
  const flushNumbered = () => {
    if (numberedBuf.length) {
      out.push({ kind: "numbered-list", items: numberedBuf });
      numberedBuf = [];
    }
  };
  const flushAll = () => { flushBullets(); flushNumbered(); };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushAll(); continue; }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      flushNumbered();
      bulletBuf.push(bullet[1]);
      continue;
    }
    const num = line.match(/^\d+[.)]\s+(.*)$/);
    if (num) {
      flushBullets();
      numberedBuf.push(num[1]);
      continue;
    }

    flushAll();

    // Heading heuristic: short line ending with ":" (≤60 chars).
    if (/:\s*$/.test(line) && line.length <= 60) {
      out.push({ kind: "heading", text: line.replace(/:\s*$/, "") + ":" });
      continue;
    }
    out.push({ kind: "paragraph", text: line });
  }
  flushAll();
  return out;
}

