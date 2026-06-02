"use client";

// Jobs tab — Keka-parity layout in the dashboard's blue palette.
//
// Two view modes:
//   • Grid  (default) — cards with priority star, top-line stats, and
//                       a NEW / ARCHIVED footer per Keka's layout.
//   • List           — the original table view kept for power users
//                       who want to scan many jobs at once.
//
// Filters: Status / Brand (Business Unit) / Department / Hiring
// Manager / Recruiter / Location — populated from the data so empty
// values aren't surfaced. Plus a full-width search bar matching the
// "Search for jobs by title, department, job id" treatment.
//
// Publish workflow is unchanged: status pill + Publish / Pause /
// Close transitions route through /api/hr/hiring/jobs/[id]/publish.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  Plus, Briefcase, MapPin, Users, Search,
  Share2, Send, Pause, CheckCircle2, FileEdit, MoreHorizontal,
  ExternalLink, Star, LayoutGrid, List, Calendar, Filter,
  ChevronDown, ChevronLeft, Circle, BriefcaseBusiness,
  FileText, Trash2, Settings2,
} from "lucide-react";
import Link from "next/link";
import KanbanBoard from "./KanbanBoard";
import JobApplicantList from "./JobApplicantList";
import CreateJobWizard from "./CreateJobWizard";
import JobShareDialog from "./JobShareDialog";

type JobStatus = "draft" | "published" | "on_hold" | "closed";
type ViewMode  = "grid" | "list";

type Job = {
  id: number;
  title: string;
  department: string | null;
  location: string | null;
  description: string | null;
  isOpen: boolean;
  status: JobStatus;
  publicSlug: string | null;
  publishedAt: string | null;
  vacancies: number;
  isPriority: boolean;
  brand: string | null;
  employmentType: string | null;
  experienceLevel: string | null;
  salaryRange: string | null;
  recruiterName: string | null;
  hiringManagerName: string | null;
  applicationCount: number;
  activeCount: number;
  hiredCount: number;
  rejectedCount: number;
  newCount: number;
  createdAt: string;
  closesAt: string | null;
  jdFileUrl: string | null;
  jdFileName: string | null;
};

const BRAND_OPTIONS = [
  { value: "",         label: "All brands" },
  { value: "nb_media", label: "NB Media" },
  { value: "yt_labs",  label: "YT Labs" },
];
const STATUS_OPTIONS: { value: "all" | JobStatus; label: string }[] = [
  { value: "all",       label: "All status" },
  { value: "published", label: "Published" },
  { value: "draft",     label: "Draft" },
  { value: "on_hold",   label: "On hold" },
  { value: "closed",    label: "Closed" },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  draft:     "Draft",
  published: "Published",
  on_hold:   "On hold",
  closed:    "Closed",
};
const STATUS_PILL: Record<JobStatus, string> = {
  draft:     "bg-slate-100 text-slate-600",
  published: "bg-emerald-50 text-emerald-700",
  on_hold:   "bg-amber-50 text-amber-700",
  closed:    "bg-rose-50 text-rose-700",
};
// Matching ring colours for the larger detail-header pill so the
// shape reads as a contained tag and not a smear of fill.
const STATUS_PILL_RING: Record<JobStatus, string> = {
  draft:     "ring-slate-200",
  published: "ring-emerald-200/70",
  on_hold:   "ring-amber-200/70",
  closed:    "ring-rose-200/70",
};
const STATUS_DOT: Record<JobStatus, string> = {
  draft:     "text-slate-400",
  published: "text-emerald-500",
  on_hold:   "text-amber-500",
  closed:    "text-rose-400",
};
const STATUS_DOT_LABEL: Record<JobStatus, string> = {
  draft:     "DRAFT",
  published: "ONLINE",
  on_hold:   "ON HOLD",
  closed:    "CLOSED",
};

export default function JobsTab() {
  // ── Filters ─────────────────────────────────────────────────────
  const [brand, setBrand]    = useState("");
  const [status, setStatus]  = useState<"all" | JobStatus>("all");
  const [department, setDepartment]   = useState("");
  const [hiringManager, setHM]        = useState("");
  const [recruiter, setRecruiter]     = useState("");
  const [location, setLocation]       = useState("");
  const [search, setSearch] = useState("");
  const [showPriorityOnly, setShowPriorityOnly] = useState(false);

  // ── View state ──────────────────────────────────────────────────
  const [view, setView] = useState<ViewMode>("grid");
  // Job-detail view: per-job applicant view mode. Kanban shows the
  // visual pipeline; list shows a flat sortable table of all
  // applicants on this job — same data, different layout.
  const [pipelineView, setPipelineView] = useState<"kanban" | "list">("kanban");
  const [activeJob, setActiveJob]   = useState<Job | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [shareJob, setShareJob]     = useState<Job | null>(null);
  const [menuJobId, setMenuJobId]   = useState<number | null>(null);
  const [busyJobId, setBusyJobId]   = useState<number | null>(null);

  // ── Data ────────────────────────────────────────────────────────
  const url = `/api/hr/hiring/jobs?brand=${encodeURIComponent(brand)}${
    status === "all" ? "" : `&statusFilter=${status}`
  }`;
  const { data, isLoading } = useSWR<{ jobs: Job[] }>(url, fetcher);
  const jobs = data?.jobs ?? [];
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  // ── Filter options derived from the data ────────────────────────
  // We populate Department / HM / Recruiter / Location from what
  // actually shows up in the current result set so empty selects
  // never offer dead values.
  const departmentOpts   = useMemo(() => uniqueSorted(jobs.map(j => j.department)),       [jobs]);
  const hiringMgrOpts    = useMemo(() => uniqueSorted(jobs.map(j => j.hiringManagerName)), [jobs]);
  const recruiterOpts    = useMemo(() => uniqueSorted(jobs.map(j => j.recruiterName)),     [jobs]);
  const locationOpts     = useMemo(() => uniqueSorted(jobs.map(j => j.location)),          [jobs]);

  // ── Apply remaining client-side filters & search ────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter(j => {
      if (showPriorityOnly && !j.isPriority) return false;
      if (department   && j.department         !== department)   return false;
      if (hiringManager && j.hiringManagerName !== hiringManager) return false;
      if (recruiter    && j.recruiterName      !== recruiter)    return false;
      if (location     && j.location           !== location)     return false;
      if (!q) return true;
      return [j.title, j.department, j.location, j.recruiterName, j.hiringManagerName, String(j.id)]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
    });
  }, [jobs, search, department, hiringManager, recruiter, location, showPriorityOnly]);

  // Header count shows the count for the currently-displayed filter
  // (matches Keka's "Active Jobs (5)" treatment which updates as you
  // narrow).
  const headerLabel = status === "all" ? "All Jobs" :
                      status === "published" ? "Active Jobs" :
                      `${STATUS_LABEL[status]} Jobs`;

  // ── Status transitions ──────────────────────────────────────────
  const transition = async (job: Job, action: "publish" | "unpublish" | "hold" | "close") => {
    setBusyJobId(job.id);
    setMenuJobId(null);
    try {
      const res = await fetch(`/api/hr/hiring/jobs/${job.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "Could not update the job status.");
        return;
      }
      globalMutate(url);
      if (activeJob?.id === job.id) {
        const updated = await fetch(url).then(r => r.json()).catch(() => null);
        if (updated?.jobs) {
          const next = updated.jobs.find((j: Job) => j.id === job.id);
          if (next) setActiveJob(next);
        }
      }
    } finally {
      setBusyJobId(null);
    }
  };

  // Hard-delete with a confirm flow. First attempt (no ?force=1) lets
  // the server gate the action when applicants exist; if the server
  // returns needsForce:true, we re-prompt the user with the applicant
  // count, then retry with ?force=1 if confirmed.
  const deleteJob = async (job: Job) => {
    setMenuJobId(null);
    if (!confirm(`Delete "${job.title}"?\n\nThis is permanent. Use "Close role" if you want to keep candidate history instead.`)) return;
    setBusyJobId(job.id);
    try {
      let res = await fetch(`/api/hr/hiring/jobs/${job.id}`, { method: "DELETE" });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body?.needsForce) {
          if (!confirm(`${body.error}\n\nProceed and permanently delete the job AND all ${body.applicantCount} applicants?`)) {
            return;
          }
          res = await fetch(`/api/hr/hiring/jobs/${job.id}?force=1`, { method: "DELETE" });
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error || "Could not delete the job.");
        return;
      }
      // If we were viewing the just-deleted job, close the detail view.
      if (activeJob?.id === job.id) setActiveJob(null);
      globalMutate(url);
    } finally {
      setBusyJobId(null);
    }
  };

  const togglePriority = async (job: Job) => {
    // Optimistic update — the user wants instant feedback on a star.
    const next = !job.isPriority;
    globalMutate(url,
      (cur: { jobs: Job[] } | undefined) => cur
        ? { jobs: cur.jobs.map(x => x.id === job.id ? { ...x, isPriority: next } : x) }
        : cur,
      { revalidate: false },
    );
    try {
      const res = await fetch(`/api/hr/hiring/jobs/${job.id}/priority`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPriority: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Revert on failure
      globalMutate(url);
    }
  };

  // ── Detail view (per-job applicants — kanban OR list) ───────────
  // pipelineView is component-state, not URL-synced, because HR
  // typically wants the toggle to reset between jobs. Default to
  // kanban — the visual pipeline is the more common workflow.
  // const noop reference removes the "unused" lint when this is
  // the first state declaration in the closure.
  if (activeJob) {
    const st = (activeJob.status ?? (activeJob.isOpen ? "published" : "closed")) as JobStatus;
    return (
      <div>
        <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setActiveJob(null)}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-[12px] font-semibold transition-colors"
              title="Back to all jobs"
            ><ChevronLeft size={13} /> All jobs</button>
            <span className="text-slate-300">/</span>
            <h2 className="text-[16px] font-semibold text-slate-800 truncate">{activeJob.title}</h2>
            <span className={`inline-flex items-center gap-1.5 ml-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ${STATUS_PILL_RING[st]} ${STATUS_PILL[st]}`}>
              <span className="relative inline-flex h-1.5 w-1.5">
                {st === "published" && (
                  <span className="absolute inset-0 rounded-full bg-emerald-400/70 animate-ping" />
                )}
                <span className={`relative inline-block h-1.5 w-1.5 rounded-full ${
                  st === "published" ? "bg-emerald-500" :
                  st === "draft"     ? "bg-slate-400"   :
                  st === "on_hold"   ? "bg-amber-500"   :
                                       "bg-rose-500"
                }`} />
              </span>
              {STATUS_LABEL[st]}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/dashboard/hr/hiring/jobs/${activeJob.id}`}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-[11.5px] font-semibold text-slate-700"
              title="Open hiring setup, application form, scorecard, and more"
            ><Settings2 size={12} /> Hiring Setup</Link>
            <JdButton
              jobId={activeJob.id}
              hasJd={!!(activeJob as any).jdFileUrl}
              jdName={(activeJob as any).jdFileName as string | null}
              onChange={async () => {
                const fresh = await fetch(url).then(r => r.json()).catch(() => null);
                if (fresh?.jobs) {
                  const next = fresh.jobs.find((j: Job) => j.id === activeJob.id);
                  if (next) setActiveJob(next);
                }
                globalMutate(url);
              }}
            />
            {st === "draft" && (
              <button
                disabled={busyJobId === activeJob.id}
                onClick={() => transition(activeJob, "publish")}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold disabled:opacity-50"
              ><Send size={12} /> Publish</button>
            )}
            {st === "published" && activeJob.publicSlug && (
              <>
                <a
                  href={`/jobs/${activeJob.publicSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700"
                ><ExternalLink size={12} /> Preview</a>
                <button
                  onClick={() => setShareJob(activeJob)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[11.5px] font-semibold"
                ><Share2 size={12} /> Share &amp; embed</button>
              </>
            )}
            {st === "on_hold" && (
              <button
                disabled={busyJobId === activeJob.id}
                onClick={() => transition(activeJob, "publish")}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11.5px] font-semibold disabled:opacity-50"
              ><Send size={12} /> Resume</button>
            )}
          </div>
        </div>
        <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11.5px] text-slate-500 flex items-center gap-3 flex-wrap">
            {activeJob.department && <span className="inline-flex items-center gap-1"><Briefcase size={11} /> {activeJob.department}</span>}
            {activeJob.location   && <span className="inline-flex items-center gap-1"><MapPin   size={11} /> {activeJob.location}</span>}
            <span className="inline-flex items-center gap-1"><Users size={11} /> {activeJob.applicationCount} applicants</span>
            {activeJob.vacancies > 1 && <span>· {activeJob.vacancies} positions</span>}
          </div>
          {/* Kanban / List toggle — same data either way. */}
          <div className="inline-flex p-1 rounded-lg border border-slate-200 bg-slate-50">
            <button
              onClick={() => setPipelineView("kanban")}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] font-semibold transition-colors ${
                pipelineView === "kanban"
                  ? "bg-white text-[#3b82f6] shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <LayoutGrid size={12} /> Kanban
            </button>
            <button
              onClick={() => setPipelineView("list")}
              className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-[11.5px] font-semibold transition-colors ${
                pipelineView === "list"
                  ? "bg-white text-[#3b82f6] shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <List size={12} /> List
            </button>
          </div>
        </div>
        {pipelineView === "kanban"
          ? <KanbanBoard      jobId={activeJob.id} />
          : <JobApplicantList jobId={activeJob.id} />}
        {shareJob && (
          <JobShareDialog
            job={{ id: shareJob.id, title: shareJob.title, slug: shareJob.publicSlug, brand: shareJob.brand }}
            baseUrl={baseUrl}
            onClose={() => setShareJob(null)}
          />
        )}
      </div>
    );
  }

  // Are any filters active? Used to enable/show the Clear button + a
  // small "filtered" hint next to the count.
  const anyFilterActive = !!(brand || status !== "all" || department || hiringManager || recruiter || location || search || showPriorityOnly);

  // ── Index view ──────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Page module: header + toolbar + filters in one card ──
          Everything that controls the result set lives in a single
          elevated card so the visual hierarchy is title → toolbar →
          filters → results. Cleaner than three loose strips of UI. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Title row */}
        <div className="px-6 py-5 flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="hidden sm:flex h-11 w-11 items-center justify-center rounded-xl bg-[#3b82f6]/10 text-[#3b82f6] flex-shrink-0">
              <BriefcaseBusiness size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-[20px] font-semibold text-slate-900 tracking-tight leading-tight">{headerLabel}</h2>
                <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-full bg-slate-100 text-slate-700 text-[12px] font-semibold">
                  {filtered.length}
                </span>
                {anyFilterActive && (
                  <span className="text-[11px] font-medium text-slate-400">filtered</span>
                )}
              </div>
              <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">
                Manage every job opening — create, publish, share with your careers page, and review applicants.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Priority toggle */}
            <label className="inline-flex items-center gap-2 cursor-pointer select-none h-9 px-3 rounded-lg border border-slate-200 bg-white hover:border-slate-300 transition-colors">
              <span className="relative inline-block h-4 w-7">
                <input
                  type="checkbox"
                  checked={showPriorityOnly}
                  onChange={(e) => setShowPriorityOnly(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="absolute inset-0 rounded-full bg-slate-200 peer-checked:bg-[#3b82f6] transition-colors" />
                <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform peer-checked:translate-x-3" />
              </span>
              <span className="text-[12px] font-medium text-slate-700">Show only priority</span>
            </label>

            {/* View switcher */}
            <div className="inline-flex h-9 rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                onClick={() => setView("grid")}
                title="Grid view"
                className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                  view === "grid" ? "bg-[#3b82f6]/10 text-[#3b82f6]" : "text-slate-400 hover:text-slate-700"
                }`}
              ><LayoutGrid size={14} /></button>
              <button
                onClick={() => setView("list")}
                title="List view"
                className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
                  view === "list" ? "bg-[#3b82f6]/10 text-[#3b82f6]" : "text-slate-400 hover:text-slate-700"
                }`}
              ><List size={14} /></button>
            </div>

            {/* Split button — primary creates a new job, chevron opens
                a secondary menu with re-open / bulk-upload options. */}
            <CreateJobSplitButton
              onCreate={() => setShowCreate(true)}
              menuOpen={createMenuOpen}
              setMenuOpen={setCreateMenuOpen}
              onReopenArchived={() => {
                setCreateMenuOpen(false);
                setStatus("closed");
              }}
              onBulkUpload={() => {
                setCreateMenuOpen(false);
                alert("Bulk upload jobs — coming next. We'll accept a CSV with title, department, location, brand and create draft openings.");
              }}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-slate-100" />

        {/* Filter rail — grouped under the same card so it reads as
            "tools for this list" rather than a free-floating control. */}
        <div className="px-6 py-4 bg-slate-50/70">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">Filters</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <FilterSelect placeholder="Status"          value={status === "all" ? "" : status}
                          onChange={(v) => setStatus((v as "" | JobStatus) || "all")}
                          options={STATUS_OPTIONS.filter(o => o.value !== "all").map(o => ({ value: o.value, label: o.label }))} />
            <FilterSelect placeholder="Business Unit"  value={brand}        onChange={setBrand}     options={BRAND_OPTIONS.filter(o => o.value)} />
            <FilterSelect placeholder="Department"     value={department}   onChange={setDepartment} options={departmentOpts.map(v => ({ value: v, label: v }))} />
            <FilterSelect placeholder="Hiring Manager" value={hiringManager} onChange={setHM}        options={hiringMgrOpts.map(v => ({ value: v, label: v }))} />
            <FilterSelect placeholder="Recruiter"      value={recruiter}    onChange={setRecruiter} options={recruiterOpts.map(v => ({ value: v, label: v }))} />
            <FilterSelect placeholder="Location"       value={location}     onChange={setLocation}  options={locationOpts.map(v => ({ value: v, label: v }))} />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search for jobs by title, department, or job id"
                className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6] transition-shadow"
              />
            </div>
            {anyFilterActive && (
              <button
                onClick={() => {
                  setBrand(""); setStatus("all"); setDepartment(""); setHM(""); setRecruiter(""); setLocation(""); setSearch(""); setShowPriorityOnly(false);
                }}
                className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-slate-200 bg-white text-[12px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 transition-colors"
                title="Clear all filters"
              ><Filter size={13} /> Clear</button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="py-20 text-center">
          <div className="inline-block h-7 w-7 border-2 border-[#3b82f6] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <Briefcase size={26} className="mx-auto text-slate-300 mb-3" />
          <p className="text-[13.5px] font-semibold text-slate-700">No jobs match these filters</p>
          <p className="text-[12px] text-slate-500 mt-1">Try clearing a filter or click "New job" to add one.</p>
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              busy={busyJobId === j.id}
              menuOpen={menuJobId === j.id}
              onMenuToggle={() => setMenuJobId((c) => (c === j.id ? null : j.id))}
              onTransition={(action) => transition(j, action)}
              onShare={() => { setShareJob(j); setMenuJobId(null); }}
              onPriorityToggle={() => togglePriority(j)}
              onOpen={() => setActiveJob(j)}
              onDelete={() => deleteJob(j)}
            />
          ))}
        </div>
      ) : (
        <ListView
          jobs={filtered}
          busyJobId={busyJobId}
          menuJobId={menuJobId}
          onMenuToggle={(id) => setMenuJobId((c) => (c === id ? null : id))}
          onTransition={transition}
          onShare={(j) => { setShareJob(j); setMenuJobId(null); }}
          onPriorityToggle={togglePriority}
          onOpen={setActiveJob}
          onDelete={deleteJob}
        />
      )}

      {showCreate && (
        <CreateJobWizard
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); globalMutate(url); }}
        />
      )}
      {shareJob && (
        <JobShareDialog
          job={{ id: shareJob.id, title: shareJob.title, slug: shareJob.publicSlug, brand: shareJob.brand }}
          baseUrl={baseUrl}
          onClose={() => setShareJob(null)}
        />
      )}
    </div>
  );
}

// ── JobCard (grid view) ─────────────────────────────────────────────
// Keka-parity card. Title + dept|location + an icon stats row
// (applicants • hired/vacancies • close date) and a NEW CANDIDATES /
// ARCHIVED footer with the online status dot. Priority star tucked
// top-right.
function JobCard({
  job, busy, menuOpen, onMenuToggle, onTransition, onShare, onPriorityToggle, onOpen, onDelete,
}: {
  job: Job;
  busy: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onTransition: (action: "publish" | "unpublish" | "hold" | "close") => void;
  onShare: () => void;
  onPriorityToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const st = (job.status ?? (job.isOpen ? "published" : "closed")) as JobStatus;
  const brandName = job.brand === "yt_labs" ? "YT Labs" : "NB Media";

  // overdue close-date — render in red so HR notices unfilled requisitions.
  const overdue = job.closesAt && new Date(job.closesAt) < new Date();
  const dateLabel = job.closesAt
    ? overdue
      ? `Overdue by ${Math.floor((Date.now() - new Date(job.closesAt).getTime()) / 86400000)} days`
      : new Date(job.closesAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // Mark the green check colour only when the role is fully filled —
  // matches Keka where the check goes green once hired === vacancies.
  const fullyFilled = job.vacancies > 0 && job.hiredCount >= job.vacancies;

  // Status pill spec — coloured background + dot for each state.
  const STATUS_PILL_STYLE: Record<JobStatus, string> = {
    published: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70",
    draft:     "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    on_hold:   "bg-amber-50 text-amber-700 ring-1 ring-amber-200/70",
    closed:    "bg-rose-50 text-rose-700 ring-1 ring-rose-200/70",
  };

  // Coloured left accent strip per status — adds identity without
  // shouting like a full coloured header would.
  const ACCENT_BAR: Record<JobStatus, string> = {
    published: "bg-emerald-500",
    draft:     "bg-slate-300",
    on_hold:   "bg-amber-500",
    closed:    "bg-rose-500",
  };

  return (
    <div
      onClick={onOpen}
      className="
        group relative flex cursor-pointer overflow-hidden
        bg-white rounded-2xl border border-slate-200
        shadow-[0_1px_3px_rgba(15,23,42,0.04)]
        transition-all duration-200
        hover:-translate-y-0.5 hover:border-[#3b82f6]/60
        hover:shadow-[0_8px_24px_-6px_rgba(15,23,42,0.10)]
      "
    >
      {/* Left status accent bar — 3px coloured stripe that doubles as
          the at-a-glance status indicator. */}
      <div aria-hidden="true" className={`w-[3px] flex-shrink-0 ${ACCENT_BAR[st]}`} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Body ───────────────────────────────────────────── */}
        <div className="relative p-4 pb-3.5 flex-1">
          {/* Meta line: status text + job id, then star on the right */}
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 flex items-center gap-1.5 min-w-0">
              <span className={`${
                st === "published" ? "text-emerald-600" :
                st === "draft"     ? "text-slate-500"   :
                st === "on_hold"   ? "text-amber-600"   :
                                     "text-rose-600"
              }`}>{STATUS_DOT_LABEL[st]}</span>
              <span className="text-slate-300">·</span>
              <span className="tabular-nums">#{job.id}</span>
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); onPriorityToggle(); }}
              title={job.isPriority ? "Remove from priority" : "Mark as priority"}
              className={`flex-shrink-0 h-6 w-6 inline-flex items-center justify-center rounded-full transition-all ${
                job.isPriority
                  ? "bg-amber-400 text-white shadow-[0_2px_6px_rgba(251,191,36,0.35)] hover:bg-amber-500"
                  : "text-slate-300 hover:text-amber-500"
              }`}
            >
              <Star size={13} strokeWidth={2} className={job.isPriority ? "fill-white" : ""} />
            </button>
          </div>

          {/* Title — kept slate at rest so it reads cleanly. */}
          <h3 className="text-[16px] font-semibold text-slate-900 group-hover:text-[#3b82f6] transition-colors tracking-[-0.012em] leading-tight line-clamp-1">
            {job.title}
          </h3>
          <p className="text-[12px] text-slate-500 mt-1 truncate">
            <span className="font-medium">{job.department || brandName}</span>
            {job.location && <> <span className="text-slate-300 mx-1">·</span> <span>{job.location}</span></>}
          </p>

          {/* Stats — bare inline rows, no boxed pills. Reads like
              an info ledger rather than a chunky toolbar. */}
          <div className="mt-4 flex items-center gap-4 text-[12.5px]">
            <span className="inline-flex items-center gap-1.5 text-slate-700" title="Applicants">
              <Users size={13} className="text-slate-400" strokeWidth={2.25} />
              <span className="font-semibold tabular-nums">{job.applicationCount}</span>
            </span>
            <span className="inline-flex items-center gap-1.5" title={`${job.hiredCount} hired of ${job.vacancies} positions`}>
              <CheckCircle2 size={13} className={fullyFilled ? "text-emerald-500" : "text-slate-400"} strokeWidth={2.25} />
              <span className={`font-semibold tabular-nums ${fullyFilled ? "text-emerald-700" : "text-slate-700"}`}>
                {job.hiredCount}/{job.vacancies}
              </span>
            </span>
            {dateLabel && (
              <span className="inline-flex items-center gap-1.5" title={overdue ? "Past the close date" : "Closes on"}>
                <Calendar size={13} className={overdue ? "text-rose-500" : "text-slate-400"} strokeWidth={2.25} />
                <span className={`font-semibold tabular-nums ${overdue ? "text-rose-600" : "text-slate-700"}`}>
                  {dateLabel}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="relative border-t border-slate-100 px-4 py-2.5 flex items-center justify-between gap-2">
          <p className="text-[10.5px] font-semibold tracking-[0.04em] text-slate-500">
            <span className={`tabular-nums ${job.newCount > 0 ? "text-[#3b82f6] font-bold" : "text-slate-900"}`}>
              {job.newCount}
            </span>
            <span className="ml-1 uppercase">new</span>
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-slate-900 tabular-nums">{job.rejectedCount}</span>
            <span className="ml-1 uppercase">archived</span>
          </p>
          <p className="text-[10.5px] font-medium text-slate-400">
            {job.vacancies > 1 ? `${job.vacancies} positions` : "1 position"}
          </p>
        </div>
      </div>

      {/* Hover overflow menu — top-right, slides in on hover */}
      <div className="absolute right-2 top-9 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-200 z-10">
        <CardActionsMenu
          job={job}
          status={st}
          busy={busy}
          menuOpen={menuOpen}
          onMenuToggle={onMenuToggle}
          onTransition={onTransition}
          onShare={onShare}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

// ── List view ───────────────────────────────────────────────────────
function ListView({
  jobs, busyJobId, menuJobId, onMenuToggle, onTransition, onShare, onPriorityToggle, onOpen, onDelete,
}: {
  jobs: Job[];
  busyJobId: number | null;
  menuJobId: number | null;
  onMenuToggle: (id: number) => void;
  onTransition: (job: Job, action: "publish" | "unpublish" | "hold" | "close") => void;
  onShare: (job: Job) => void;
  onPriorityToggle: (job: Job) => void;
  onOpen: (job: Job) => void;
  onDelete: (job: Job) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-100">
          <tr>
            {["", "JOB", "BRAND", "TYPE", "RECRUITER", "HIRING MANAGER", "APPLICANTS", "STATUS", ""].map((h, i) => (
              <th key={i} className="px-3 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const st = (j.status ?? (j.isOpen ? "published" : "closed")) as JobStatus;
            return (
              <tr
                key={j.id}
                className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors"
              >
                <td className="px-3 py-3.5">
                  <button
                    onClick={() => onPriorityToggle(j)}
                    className="inline-flex items-center justify-center"
                  >
                    <Star
                      size={14}
                      className={j.isPriority ? "text-[#3b82f6] fill-[#3b82f6]" : "text-slate-300 hover:text-slate-500"}
                    />
                  </button>
                </td>
                <td className="px-3 py-3.5 cursor-pointer" onClick={() => onOpen(j)}>
                  <p className="text-[13px] font-semibold text-slate-800">{j.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {j.department && <span>{j.department}</span>}
                    {j.location && <span> · {j.location}</span>}
                  </p>
                </td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>
                  {j.brand === "yt_labs" ? "YT Labs" : "NB Media"}
                </td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>{j.employmentType || "—"}</td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>{j.recruiterName    || "—"}</td>
                <td className="px-3 py-3.5 text-[12px] text-slate-700 cursor-pointer" onClick={() => onOpen(j)}>{j.hiringManagerName || "—"}</td>
                <td className="px-3 py-3.5 cursor-pointer" onClick={() => onOpen(j)}>
                  <div className="flex items-center gap-2 text-[11.5px]">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">{j.activeCount} active</span>
                    {j.hiredCount > 0 && (<span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">{j.hiredCount} hired</span>)}
                  </div>
                </td>
                <td className="px-3 py-3.5 cursor-pointer" onClick={() => onOpen(j)}>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${STATUS_PILL[st]}`}>
                    {STATUS_LABEL[st]}
                  </span>
                </td>
                <td className="px-3 py-3.5">
                  <CardActionsMenu
                    job={j}
                    status={st}
                    busy={busyJobId === j.id}
                    menuOpen={menuJobId === j.id}
                    onMenuToggle={() => onMenuToggle(j.id)}
                    onTransition={(action) => onTransition(j, action)}
                    onShare={() => onShare(j)}
                    onDelete={() => onDelete(j)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared inline action menu (grid + list) ─────────────────────────
// The dropdown panel is portaled to document.body so it escapes the
// card's overflow-hidden (the card needs it for the rounded-corner
// status accent strip on the left). See feedback_overlays in memory:
// never rely on parent overflow-visible — always portal floating UI.
function CardActionsMenu({
  job, status, busy, menuOpen, onMenuToggle, onTransition, onShare, onDelete,
}: {
  job: Job;
  status: JobStatus;
  busy: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onTransition: (action: "publish" | "unpublish" | "hold" | "close") => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Recompute the menu position whenever it opens — anchored to the
  // trigger button's bounding rect so the panel always lands flush
  // below it, even if the user scrolls or resizes mid-open.
  useLayoutEffect(() => {
    if (!menuOpen) { setPos(null); return; }
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        top:   r.bottom + 4,            // 4-px gap below the ⋯ button
        right: window.innerWidth - r.right, // anchor to the right edge
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-1.5 justify-end relative" onClick={(e) => e.stopPropagation()}>
      {status === "draft" && (
        <button
          disabled={busy}
          onClick={() => onTransition("publish")}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50"
          title="Publish to careers page"
        ><Send size={11} /> Publish</button>
      )}
      {/* No inline primary action for already-published jobs — Share
          and the rest of the actions are reachable via the ⋯ menu so
          the card surface stays clean on hover. */}
      {status === "on_hold" && (
        <button
          disabled={busy}
          onClick={() => onTransition("publish")}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-50"
          title="Resume publishing"
        ><Send size={11} /> Resume</button>
      )}
      {status === "closed" && (
        <button
          disabled={busy}
          onClick={() => onTransition("publish")}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 hover:border-slate-300 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
          title="Reopen"
        ><Send size={11} /> Reopen</button>
      )}
      <button
        ref={triggerRef}
        onClick={onMenuToggle}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
        title="More actions"
      ><MoreHorizontal size={14} /></button>

      {/* Portaled dropdown — escapes the card's overflow-hidden. */}
      {mounted && menuOpen && pos && createPortal(
        <>
          {/* Click-outside scrim — full viewport */}
          <div
            className="fixed inset-0 z-[200]"
            onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
          />
          <div
            className="fixed z-[201] w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1.5"
            style={{ top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            {status !== "published" && (
              <MenuItem icon={Send}        label="Publish"        onClick={() => onTransition("publish")} />
            )}
            {status === "published" && (
              <>
                <MenuItem icon={Share2}    label="Share & embed"  onClick={onShare} />
                <MenuItem icon={Pause}     label="Put on hold"    onClick={() => onTransition("hold")} />
                <MenuItem icon={FileEdit}  label="Move to draft"  onClick={() => onTransition("unpublish")} />
              </>
            )}
            {status !== "closed" && (
              <MenuItem icon={CheckCircle2} label="Close role"   onClick={() => onTransition("close")} />
            )}
            {job.publicSlug && (
              <a
                href={`/jobs/${job.publicSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                onClick={(e) => e.stopPropagation()}
              ><ExternalLink size={12} className="text-slate-400" /> View role page</a>
            )}
            {/* Always show "View careers page" so HR can quickly hop
                to the public landing where this role is listed —
                useful for verifying it appears under the right brand. */}
            <a
              href="/jobs"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
              onClick={(e) => e.stopPropagation()}
            ><ExternalLink size={12} className="text-slate-400" /> View careers page</a>
            <div className="my-1 h-px bg-slate-100" />
            <MenuItem icon={Trash2} label="Delete job" onClick={onDelete} danger />
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

// ── JD attach/replace button for the active-job header ─────────────
// Opens a hidden file picker, uploads to /api/hr/hiring/jobs/[id]/jd,
// then calls onChange so the parent can refresh the active job.
function JdButton({
  jobId, hasJd, jdName, onChange,
}: {
  jobId: number;
  hasJd: boolean;
  jdName: string | null;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/hr/hiring/jobs/${jobId}/jd`, { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "JD upload failed");
        return;
      }
      onChange();
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      await fetch(`/api/hr/hiring/jobs/${jobId}/jd`, { method: "DELETE" });
      onChange();
    } finally { setBusy(false); }
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        type="file"
        accept=".pdf,.doc,.docx,.rtf,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          if (ref.current) ref.current.value = "";
        }}
      />
      {!hasJd ? (
        <button
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700 disabled:opacity-50"
          title="Attach a JD file (PDF, DOC, DOCX)"
        ><FileText size={12} /> {busy ? "Uploading…" : "Attach JD"}</button>
      ) : (
        <>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:border-slate-300 text-[11.5px] font-semibold text-slate-700 disabled:opacity-50"
            title={jdName || "Job Description attached"}
          >
            <FileText size={12} className="text-[#3b82f6]" />
            <span className="max-w-[120px] truncate">{jdName || "JD attached"}</span>
            <ChevronDown size={12} className="text-slate-400" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-[100]" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-[101] w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1.5">
                <button
                  onClick={() => { setMenuOpen(false); ref.current?.click(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50"
                ><FileText size={12} className="text-slate-400" /> Replace file</button>
                <button
                  onClick={remove}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-rose-600 hover:bg-slate-50"
                ><Trash2 size={12} className="text-rose-400" /> Remove JD</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon, label, onClick, danger,
}: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-50 ${
        danger ? "text-rose-600" : "text-slate-700"
      }`}
    ><Icon size={12} className={danger ? "text-rose-400" : "text-slate-400"} /> {label}</button>
  );
}

// ── Create job split button ─────────────────────────────────────────
// Main button creates a new job. The chevron half opens a small menu
// with Re-open archived / Bulk upload — matches the Keka pattern.
// Both ends share the same blue pill and round-cap visually as one
// unit so it doesn't look like two buttons crammed together.
function CreateJobSplitButton({
  onCreate, menuOpen, setMenuOpen, onReopenArchived, onBulkUpload,
}: {
  onCreate: () => void;
  menuOpen: boolean;
  setMenuOpen: (b: boolean) => void;
  onReopenArchived: () => void;
  onBulkUpload: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen, setMenuOpen]);

  return (
    <div ref={ref} className="relative inline-flex items-stretch">
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 h-9 pl-4 pr-3.5 rounded-l-lg bg-[#3b82f6] text-white text-[12.5px] font-semibold hover:bg-[#2563eb] transition-colors shadow-sm"
      >
        <Plus size={14} /> New job
      </button>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="h-9 w-8 inline-flex items-center justify-center rounded-r-lg bg-[#3b82f6] text-white border-l border-white/25 hover:bg-[#2563eb] transition-colors shadow-sm"
        title="More options"
        aria-label="More create options"
      >
        <ChevronDown size={13} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-60 rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_-6px_rgba(15,23,42,0.18)] py-1.5">
          <button
            onClick={onReopenArchived}
            className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium text-slate-700 hover:bg-blue-50 hover:text-[#1d4ed8]"
          >
            Re-open an archived job
          </button>
          <button
            onClick={onBulkUpload}
            className="w-full text-left px-3 py-2.5 text-[12.5px] font-medium text-slate-700 hover:bg-blue-50 hover:text-[#1d4ed8]"
          >
            Bulk upload jobs
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
function FilterSelect({
  placeholder, value, onChange, options,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full h-9 pl-3 pr-8 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

function uniqueSorted(values: (string | null)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== "")))
    .sort((a, b) => a.localeCompare(b));
}
