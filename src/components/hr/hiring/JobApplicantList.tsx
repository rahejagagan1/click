"use client";

// Per-job applicant LIST view — the flat-table counterpart to
// KanbanBoard. Same data source (`/api/hr/hiring/candidates?openingId`)
// so HR can flip between Kanban + List with no perceived data delta.
//
// Each row opens the CandidateDrawer on click. Stage can be moved
// inline via the stage select — same backend action as the kanban
// drag-and-drop. Sortable by name, stage, applied-on, and source.

import { useCallback, useMemo, useState } from "react";
import { useUrlState } from "@/lib/hooks/useUrlState";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  Mail, Phone, Briefcase, Star, Clock, ChevronUp, ChevronDown, FileText, Users, Archive,
} from "lucide-react";
import CandidateDrawer from "./CandidateDrawer";

type Stage = { id: number; key: string; label: string; sortOrder: number; kind: string; color: string };
type Candidate = {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  experienceYears: number | null;
  currentCompany: string | null;
  resumeUrl: string | null;
  resumeFileName?: string | null;
  source: string | null;
  overallRating: number | null;
  currentStage: Stage | null;
  enteredStageAt: string | null;
  jobOpeningId: number;
  roleTitle: string | null;
  createdAt: string;
  /** Set by ArchiveCandidateModal — null until HR archives them. */
  archivedAt:    string | null;
  archiveReason: string | null;
};

// A candidate is "archived" when HR explicitly archived them OR the
// stage they sit in is terminal-rejected. Either way, the list view
// flags them with the badge so HR can see they're out of the
// pipeline at a glance.
function isArchived(c: Candidate): boolean {
  return !!c.archivedAt || c.currentStage?.kind === "rejected";
}

type SortKey = "name" | "stage" | "applied" | "source";
type SortDir = "asc" | "desc";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}
function daysSince(d: string | null): string {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Two-channel tone — the chip body (subtle bg + text) and the left
// accent dot (saturated). Gives stages a distinct visual anchor
// without screaming.
const STAGE_TONE: Record<string, { chip: string; dot: string; ring: string }> = {
  slate:   { chip: "bg-slate-50   text-slate-700",   dot: "bg-slate-400",   ring: "ring-slate-200"   },
  blue:    { chip: "bg-blue-50    text-blue-700",    dot: "bg-blue-500",    ring: "ring-blue-200"    },
  cyan:    { chip: "bg-cyan-50    text-cyan-700",    dot: "bg-cyan-500",    ring: "ring-cyan-200"    },
  violet:  { chip: "bg-violet-50  text-violet-700",  dot: "bg-violet-500",  ring: "ring-violet-200"  },
  amber:   { chip: "bg-amber-50   text-amber-700",   dot: "bg-amber-500",   ring: "ring-amber-200"   },
  pink:    { chip: "bg-pink-50    text-pink-700",    dot: "bg-pink-500",    ring: "ring-pink-200"    },
  emerald: { chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", ring: "ring-emerald-200" },
  rose:    { chip: "bg-rose-50    text-rose-700",    dot: "bg-rose-500",    ring: "ring-rose-200"    },
};

export default function JobApplicantList({ jobId }: { jobId: number }) {
  const { data: stagesData } = useSWR<{ stages: Stage[] }>("/api/hr/hiring/stages", fetcher);
  const { data: candidatesData, isLoading } = useSWR<{ candidates: Candidate[] }>(
    `/api/hr/hiring/candidates?openingId=${jobId}`,
    fetcher,
  );
  const stages     = stagesData?.stages ?? [];
  const candidates = candidatesData?.candidates ?? [];

  const [sortKey, setSortKey] = useState<SortKey>("applied");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // selectedId is URL-derived (`?candidate=<id>`) so a hard reload
  // reopens the same candidate's drawer. Stored as string in the
  // URL; we coerce to number at the React boundary.
  const [selectedIdUrl, setSelectedIdUrl] = useUrlState("candidate");
  const selectedId = selectedIdUrl ? Number(selectedIdUrl) : null;
  const setSelectedId = useCallback(
    (n: number | null) => setSelectedIdUrl(n != null ? String(n) : null),
    [setSelectedIdUrl],
  );
  const [moving, setMoving]         = useState<Set<number>>(new Set());

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...candidates].sort((a, b) => {
      switch (sortKey) {
        case "name":   return a.fullName.localeCompare(b.fullName) * dir;
        case "stage":  return ((a.currentStage?.sortOrder ?? 0) - (b.currentStage?.sortOrder ?? 0)) * dir;
        case "source": return ((a.source ?? "").localeCompare(b.source ?? "")) * dir;
        case "applied":
        default:       return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
    });
  }, [candidates, sortKey, sortDir]);

  const moveStage = async (candidateId: number, stageId: number) => {
    const curr = candidates.find((c) => c.id === candidateId);
    if (!curr || curr.currentStage?.id === stageId) return;
    setMoving((p) => new Set(p).add(candidateId));
    const targetStage = stages.find((s) => s.id === stageId) ?? null;
    // Optimistic patch.
    globalMutate(
      `/api/hr/hiring/candidates?openingId=${jobId}`,
      (prev: any) => prev
        ? {
            ...prev,
            candidates: prev.candidates.map((c: Candidate) =>
              c.id === candidateId
                ? { ...c, currentStage: targetStage, enteredStageAt: new Date().toISOString() }
                : c,
            ),
          }
        : prev,
      { revalidate: false },
    );
    try {
      await fetch(`/api/hr/hiring/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveStage", stageId }),
      });
    } finally {
      setMoving((p) => { const n = new Set(p); n.delete(candidateId); return n; });
      globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`);
    }
  };

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "applied" ? "desc" : "asc"); }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 border-b border-slate-100 bg-slate-50/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
        <Users size={28} className="mx-auto text-slate-300 mb-3" />
        <h3 className="text-[14px] font-semibold text-slate-800">No applicants yet</h3>
        <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">
          When candidates apply to this job, they&apos;ll show up here. Share the public link to start receiving applications.
        </p>
      </div>
    );
  }

  // Counts for the header strip — gives HR a glanceable "X active,
  // Y archived" without scanning every row.
  const archivedCount = candidates.filter(isArchived).length;
  const activeCount   = candidates.length - archivedCount;

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {/* Header strip — counts + an inline hint pointing at the
            stage chip so HR knows it's interactive. Removes the
            "is that a dropdown?" guesswork. */}
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[11.5px]">
            <span className="font-semibold text-slate-700">{activeCount} active</span>
            {archivedCount > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500">{archivedCount} archived</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
            <ChevronDown size={11} className="text-slate-400" />
            Click the stage chip on any row to move a candidate
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-white border-b border-slate-200">
              <tr className="text-left text-slate-500">
                <Th sortable onClick={() => toggleSort("name")} active={sortKey === "name"} dir={sortDir}>Applicant</Th>
                <Th>Contact</Th>
                <Th sortable onClick={() => toggleSort("stage")} active={sortKey === "stage"} dir={sortDir}>Stage</Th>
                <Th sortable onClick={() => toggleSort("applied")} active={sortKey === "applied"} dir={sortDir}>Applied</Th>
                <Th sortable onClick={() => toggleSort("source")} active={sortKey === "source"} dir={sortDir}>Source</Th>
                <Th className="text-right">Resume</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const archived = isArchived(c);
                return (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`border-b border-slate-100 last:border-b-0 hover:bg-blue-50/40 cursor-pointer transition-colors ${
                    moving.has(c.id) ? "opacity-60" : ""
                  } ${archived ? "bg-slate-50/60" : ""}`}
                >
                  {/* Applicant */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-[11.5px] font-bold ${
                        archived
                          ? "bg-slate-200 text-slate-500"
                          : "bg-[#008CFF]/10 text-[#008CFF]"
                      }`}>
                        {initials(c.fullName)}
                      </span>
                      <div className="min-w-0">
                        <p className={`font-semibold truncate flex items-center gap-1.5 ${
                          archived ? "text-slate-500" : "text-slate-900"
                        }`}>
                          {c.fullName}
                          {c.overallRating != null && (
                            <span className="inline-flex items-center gap-0.5 text-[10.5px] text-amber-600">
                              <Star size={10} fill="currentColor" />
                              {c.overallRating}
                            </span>
                          )}
                          {archived && (
                            <span
                              title={c.archiveReason ?? "Archived"}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-600 text-[9.5px] font-bold uppercase tracking-wider ring-1 ring-slate-300"
                            >
                              <Archive size={9} /> Archived
                            </span>
                          )}
                        </p>
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] text-slate-500">
                          {c.currentCompany && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <Briefcase size={10} /> {c.currentCompany}
                            </span>
                          )}
                          {c.experienceYears != null && (
                            <span>{c.experienceYears} yrs exp</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* Contact — stacked email + phone, icons aligned
                      in a fixed-width gutter so multi-row entries
                      line up vertically. */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-col gap-1 text-[11.5px] text-slate-600 min-w-0">
                      <a
                        href={`mailto:${c.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-2 hover:text-[#3b82f6] min-w-0 group"
                        title={c.email}
                      >
                        <Mail size={11} className="text-slate-400 shrink-0 group-hover:text-[#3b82f6]" />
                        <span className="truncate group-hover:underline underline-offset-2">{c.email}</span>
                      </a>
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2 text-slate-500 hover:text-[#3b82f6] group"
                          title={c.phone}
                        >
                          <Phone size={11} className="text-slate-400 shrink-0 group-hover:text-[#3b82f6]" />
                          <span className="font-mono tabular-nums group-hover:underline underline-offset-2">{c.phone}</span>
                        </a>
                      )}
                    </div>
                  </td>
                  {/* Stage — visible chip + chevron makes it obviously
                      clickable / interactive. Native <select> sits on
                      top invisibly so HR gets the OS picker for free
                      (works on mobile, accessible to screen readers). */}
                  <td className="px-4 py-3 align-middle">
                    {c.currentStage ? (
                      <StageDropdown
                        current={c.currentStage}
                        stages={stages}
                        disabled={moving.has(c.id)}
                        onChange={(stageId) => moveStage(c.id, stageId)}
                      />
                    ) : (
                      <span className="inline-flex items-center gap-1 h-6 px-2 rounded bg-amber-50 text-amber-700 ring-1 ring-amber-200 text-[10px] font-semibold uppercase tracking-wide">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Unassigned
                      </span>
                    )}
                  </td>
                  {/* Applied */}
                  <td className="px-4 py-3 align-middle text-slate-600 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 text-[11.5px]">
                      <Clock size={11} className="text-slate-400" /> {daysSince(c.createdAt)}
                    </span>
                  </td>
                  {/* Source */}
                  <td className="px-4 py-3 align-middle">
                    {c.source ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10.5px] font-medium">
                        {c.source}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                  {/* Resume */}
                  <td className="px-4 py-3 align-middle text-right">
                    {c.resumeUrl ? (
                      <a
                        href={c.resumeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[10.5px] font-semibold"
                        title={c.resumeFileName ?? "Open resume"}
                      >
                        <FileText size={11} /> View
                      </a>
                    ) : (
                      <span className="text-[10.5px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
        {/* Footer count */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500">
          {candidates.length} applicant{candidates.length === 1 ? "" : "s"}
        </div>
      </div>

      {selectedId != null && (
        <CandidateDrawer
          candidateId={selectedId}
          onClose={() => setSelectedId(null)}
          onChange={() => globalMutate(`/api/hr/hiring/candidates?openingId=${jobId}`)}
        />
      )}
    </>
  );
}

// StageDropdown — visible chip with a dropdown chevron + colored
// status dot. The native <select> sits on top with opacity 0 to
// preserve the OS-native picker UX (mobile-friendly + accessible)
// while we render our own styled surface underneath.
function StageDropdown({
  current, stages, disabled, onChange,
}: {
  current: Stage;
  stages: Stage[];
  disabled: boolean;
  onChange: (stageId: number) => void;
}) {
  const tone = STAGE_TONE[current.color] || STAGE_TONE.slate;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`relative inline-flex items-center gap-1 h-6 pl-1.5 pr-1 rounded ${tone.chip} ring-1 ${tone.ring} text-[10px] font-semibold uppercase tracking-wide transition-colors hover:brightness-95 ${
        disabled ? "opacity-60 pointer-events-none" : "cursor-pointer"
      }`}
      title="Click to change stage"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot} shrink-0`} />
      <span className="whitespace-nowrap leading-none">{current.label}</span>
      <ChevronDown size={11} className="opacity-70 shrink-0 -mr-0.5" />
      <select
        value={current.id}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={`Move to stage (currently ${current.label})`}
        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </div>
  );
}

function Th({
  children, sortable, active, dir, onClick, className,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  dir?: SortDir;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-wider ${
        sortable ? "cursor-pointer hover:text-slate-800 select-none" : ""
      } ${active ? "text-slate-800" : ""} ${className ?? ""}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && active && (dir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </span>
    </th>
  );
}
