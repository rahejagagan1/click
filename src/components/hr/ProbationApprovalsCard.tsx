"use client";

// HR-facing probation surface.
//  • Home dashboard (standalone=false): a compact card of PENDING recommendations
//    (Approve / Send back). Hidden when nothing is pending.
//  • Admin "Probation Reviews" tab (standalone=true): Pending + History tabs.
//    History lists decided reviews and lets HR REVERT a confirmed/ended
//    employee back to probation (un-confirm / reactivate + a new end date).

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { DateField } from "@/components/ui/date-field";
import { CalendarClock, UserCheck, UserX, Check, X, RotateCcw } from "lucide-react";

type HrReview = {
  id: number;
  employeeUserId: number;
  employeeName: string;
  employeeId: string | null;
  designation: string | null;
  managerName: string | null;
  recommendation: "extend" | "confirm" | "end";
  extendMonths: number | null;
  proposedEndDate: string | null;
  probationEndDate: string | null;
  daysRemaining: number | null;
  feedback: string;
};
type HrHistory = HrReview & { status: "approved" | "rejected"; decidedAt: string | null; deciderName: string | null; isConfirmed: boolean; employeeActive: boolean; hrNote: string | null };

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

function recLabel(r: { recommendation: string; extendMonths: number | null; proposedEndDate: string | null }) {
  if (r.recommendation === "extend") return `Extend ${r.proposedEndDate ? `→ ${fmtDate(r.proposedEndDate)}` : r.extendMonths ? `+${r.extendMonths} mo` : ""}`.trim();
  if (r.recommendation === "confirm") return "Hire full-time";
  return "End employment";
}
function recBadge(r: HrReview) {
  if (r.recommendation === "extend") return { cls: "bg-blue-50 text-blue-700 ring-blue-200", Icon: CalendarClock };
  if (r.recommendation === "confirm") return { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", Icon: UserCheck };
  return { cls: "bg-rose-50 text-rose-700 ring-rose-200", Icon: UserX };
}

export default function ProbationApprovalsCard({ standalone = false }: { standalone?: boolean }) {
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const { data, mutate } = useSWR<{ reviews: HrReview[] }>("/api/hr/probation-reviews?scope=hr", fetcher, { refreshInterval: 60_000 });
  const reviews = data?.reviews ?? [];
  const { data: histData, mutate: mutateHist } = useSWR<{ reviews: HrHistory[] }>(standalone && tab === "history" ? "/api/hr/probation-reviews?scope=hr-history" : null, fetcher);
  const history = histData?.reviews ?? [];
  const [busy, setBusy] = useState<number | null>(null);
  const [revertFor, setRevertFor] = useState<number | null>(null);
  const [revertDate, setRevertDate] = useState("");

  // Home dashboard: hide entirely when nothing pending.
  if (!standalone && reviews.length === 0) return null;

  const decide = async (r: HrReview, decision: "approve" | "reject") => {
    let hrNote: string | null = null;
    if (decision === "reject") hrNote = (prompt(`Send ${r.employeeName}'s review back to ${r.managerName || "the manager"} — optional note:`) ?? "").trim() || null;
    if (decision === "approve" && r.recommendation === "end" && !confirm(`Approve ENDING ${r.employeeName}'s employment? This deactivates their account.`)) return;
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/probation-reviews/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, hrNote }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Failed"); }
      mutate();
    } catch (e: any) { alert(e?.message || "Failed"); } finally { setBusy(null); }
  };

  const openRevert = (empId: number) => {
    const d = new Date(); d.setMonth(d.getMonth() + 3);
    setRevertFor(empId); setRevertDate(d.toISOString().slice(0, 10));
  };
  const doRevert = async (empId: number) => {
    if (!revertDate) { alert("Pick a new probation end date."); return; }
    setBusy(empId);
    try {
      const res = await fetch("/api/hr/probation-reviews/revert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeUserId: empId, newEndDate: revertDate }) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j?.error || "Failed"); }
      setRevertFor(null); mutate(); mutateHist?.();
    } catch (e: any) { alert(e?.message || "Failed"); } finally { setBusy(null); }
  };

  const pendingList = reviews.length === 0 ? (
    <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[12.5px] text-slate-500 ring-1 ring-slate-100">Nothing awaiting approval.</p>
  ) : (
    <div className="space-y-2.5">
      {reviews.map((r) => {
        const b = recBadge(r);
        return (
          <div key={r.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/dashboard/hr/people/${r.employeeUserId}`} className="block truncate text-[12.5px] font-semibold text-slate-800 hover:text-[#008CFF] hover:underline">{r.employeeName}</Link>
                <p className="truncate text-[11px] text-slate-500">{r.designation || "—"} · mgr {r.managerName || "—"}</p>
                <p className="text-[10.5px] text-slate-400">Probation ends {fmtDate(r.probationEndDate)}</p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${b.cls}`}><b.Icon size={11} /> {recLabel(r)}</span>
            </div>
            <p className="mt-1.5 text-[12px] italic text-slate-600">“{r.feedback}”</p>
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, "approve")} className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-3 text-[11.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Check size={12} /> Approve</button>
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, "reject")} className="inline-flex h-7 items-center gap-1 rounded-md bg-white px-3 text-[11.5px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"><X size={12} /> Send back</button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const historyList = history.length === 0 ? (
    <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-[12.5px] text-slate-500 ring-1 ring-slate-100">No decided reviews yet.</p>
  ) : (
    <div className="space-y-2.5">
      {history.map((h) => {
        const canRevert = h.isConfirmed || h.employeeActive === false; // confirmed → un-confirm; ended → reactivate
        return (
          <div key={h.id} className="rounded-lg border border-slate-100 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/dashboard/hr/people/${h.employeeUserId}`} className="block truncate text-[12.5px] font-semibold text-slate-800 hover:text-[#008CFF] hover:underline">{h.employeeName}</Link>
                <p className="truncate text-[11px] text-slate-500">{h.designation || "—"} · mgr {h.managerName || "—"}</p>
              </div>
              <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${h.status === "approved" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>{h.status === "approved" ? "Approved" : "Sent back"}</span>
            </div>
            <p className="mt-1.5 text-[12px] text-slate-600">{recLabel(h)}{h.decidedAt ? <span className="text-slate-400"> · {fmtDate(h.decidedAt)}{h.deciderName ? ` by ${h.deciderName}` : ""}</span> : null}</p>
            <p className="mt-1 text-[12px] italic text-slate-500">“{h.feedback}”</p>
            {canRevert && (
              revertFor === h.employeeUserId ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-100">
                  <span className="text-[11px] font-semibold text-slate-600">New probation end:</span>
                  <div className="w-[150px]"><DateField value={revertDate} onChange={setRevertDate} /></div>
                  <button type="button" disabled={busy === h.employeeUserId} onClick={() => doRevert(h.employeeUserId)} className="inline-flex h-7 items-center gap-1 rounded-md bg-[#008CFF] px-3 text-[11.5px] font-semibold text-white hover:bg-[#0070cc] disabled:opacity-50"><RotateCcw size={12} /> Confirm revert</button>
                  <button type="button" onClick={() => setRevertFor(null)} className="h-7 px-2 text-[11.5px] font-medium text-slate-500 hover:text-slate-800">Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => openRevert(h.employeeUserId)} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#008CFF] hover:underline">
                  <RotateCcw size={12} /> Revert to probation
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );

  // Admin tab — Pending / History tabs.
  if (standalone) {
    return (
      <div>
        <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-0.5 text-[12px] font-medium">
          <button type="button" onClick={() => setTab("pending")} className={`rounded-md px-3.5 py-1.5 transition-colors ${tab === "pending" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Pending{reviews.length ? ` (${reviews.length})` : ""}</button>
          <button type="button" onClick={() => setTab("history")} className={`rounded-md px-3.5 py-1.5 transition-colors ${tab === "history" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>History</button>
        </div>
        {tab === "pending" ? pendingList : historyList}
      </div>
    );
  }

  // Home dashboard card — pending only.
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-semibold text-slate-900">Probation Approvals</p>
        <span className="min-w-[20px] rounded-full bg-[#008CFF] px-1.5 py-0.5 text-center text-[10px] font-bold text-white tabular-nums">{reviews.length}</span>
      </div>
      {pendingList}
    </div>
  );
}
