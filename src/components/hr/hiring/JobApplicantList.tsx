"use client";

// Per-job applicant LIST view — the flat-table counterpart to
// KanbanBoard. Same data source (`/api/hr/hiring/candidates?openingId`)
// so HR can flip between Kanban + List with no perceived data delta.
//
// Each row opens the CandidateDrawer on click. Stage can be moved
// inline via the stage select — same backend action as the kanban
// drag-and-drop. Sortable by name, stage, applied-on, and source.

import { useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  Mail, Phone, Briefcase, Star, Clock, ChevronUp, ChevronDown, FileText, Users,
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
};

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

const STAGE_TONE: Record<string, string> = {
  slate:   "bg-slate-100   text-slate-700",
  blue:    "bg-blue-100    text-blue-700",
  cyan:    "bg-cyan-100    text-cyan-700",
  violet:  "bg-violet-100  text-violet-700",
  amber:   "bg-amber-100   text-amber-700",
  pink:    "bg-pink-100    text-pink-700",
  emerald: "bg-emerald-100 text-emerald-700",
  rose:    "bg-rose-100    text-rose-700",
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
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

  return (
    <>
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-slate-50 border-b border-slate-200">
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
              {sorted.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`border-b border-slate-100 last:border-b-0 hover:bg-blue-50/40 cursor-pointer transition-colors ${
                    moving.has(c.id) ? "opacity-60" : ""
                  }`}
                >
                  {/* Applicant */}
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="h-9 w-9 shrink-0 rounded-full bg-[#008CFF]/10 text-[#008CFF] flex items-center justify-center text-[11.5px] font-bold">
                        {initials(c.fullName)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate flex items-center gap-1.5">
                          {c.fullName}
                          {c.overallRating != null && (
                            <span className="inline-flex items-center gap-0.5 text-[10.5px] text-amber-600">
                              <Star size={10} fill="currentColor" />
                              {c.overallRating}
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
                  {/* Contact */}
                  <td className="px-4 py-3 align-middle">
                    <div className="space-y-0.5 text-[11.5px] text-slate-600">
                      <a
                        href={`mailto:${c.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 hover:text-[#3b82f6] hover:underline truncate"
                      >
                        <Mail size={11} className="text-slate-400" /> {c.email}
                      </a>
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 hover:text-[#3b82f6] hover:underline"
                        >
                          <Phone size={11} className="text-slate-400" /> {c.phone}
                        </a>
                      )}
                    </div>
                  </td>
                  {/* Stage select */}
                  <td className="px-4 py-3 align-middle">
                    {c.currentStage ? (
                      <select
                        value={c.currentStage.id}
                        onChange={(e) => moveStage(c.id, Number(e.target.value))}
                        onClick={(e) => e.stopPropagation()}
                        disabled={moving.has(c.id)}
                        className={`appearance-none h-7 pl-2.5 pr-7 rounded-full text-[10.5px] font-bold uppercase tracking-wider border-0 cursor-pointer bg-[length:14px] bg-no-repeat bg-[position:right_6px_center] ${
                          STAGE_TONE[c.currentStage.color] || STAGE_TONE.slate
                        }`}
                        style={{
                          backgroundImage:
                            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='currentColor'><path d='M4.5 6L8 9.5 11.5 6z'/></svg>\")",
                        }}
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[11px] text-amber-600">Unassigned</span>
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
              ))}
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
