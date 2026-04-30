"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import FilterDropdown from "@/components/hr/FilterDropdown";
import {
  deriveEntity,
  deriveDepartment,
  deriveLocation,
  departmentOptions,
  entityOptions,
  locationOptions,
} from "@/lib/hr-taxonomy";
import { getUserRoleLabel } from "@/lib/user-role-options";

type TabKey =
  | "leave"
  | "leave_encashment"
  | "comp_off"
  | "regularize"
  | "wfh"
  | "half_day"
  | "shift_weekly_off";
const TABS: { key: TabKey; label: string }[] = [
  { key: "leave",              label: "Leave"             },
  { key: "leave_encashment",   label: "Leave Encashment"  },
  { key: "comp_off",           label: "Comp Offs"         },
  { key: "regularize",         label: "Regularizations"   },
  { key: "wfh",                label: "WFH / OD"          },
  { key: "half_day",           label: "Half Day"          },
  { key: "shift_weekly_off",   label: "Shift & Weekly off"},
];

// Compact "Applied · L1 · L2" timeline shown under the leave-type cell.
// Uses the data already returned by /api/hr/approvals?tab=leave — appliedAt,
// approver/approvedAt for L1, finalApprover/finalApprovedAt for L2.
function fmtDt(d: any): string {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    + ", "
    + dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// Per-stage approver cell. Shows the outcome of a stage (Approved /
// Rejected / Awaiting / —) and, for the actively-awaiting stage that the
// current user can decide on, inline approve/reject buttons.
//
//   L1: row.approver / row.approvedAt / row.approvalNote
//   L2: row.finalApprover / row.finalApprovedAt / row.finalApprovalNote
//
// Status → cell state mapping:
//   pending             → L1 = Awaiting,  L2 = —
//   partially_approved  → L1 = Approved,  L2 = Awaiting
//   approved            → L1 = Approved,  L2 = Approved
//   rejected (no L2 ts) → L1 = Rejected,  L2 = —
//   rejected (L2 ts)    → L1 = Approved,  L2 = Rejected
//
// Action visibility:
//   L1 buttons → status==="pending" AND user is row's L1 approver
//                (manager / HR-admin / CEO / developer — the API only
//                returns rows the viewer is allowed to action).
//   L2 buttons → status==="partially_approved" AND user is final approver
//                (HR-admin / CEO / developer).
function ApprovalCell({
  stage, row, canAct, onApprove, onReject, actioning,
}: {
  stage: "L1" | "L2";
  row: any;
  canAct: boolean;
  onApprove: () => void;
  onReject: () => void;
  actioning: boolean;
}) {
  const status: string = row.status;
  const l2Ts = row.finalApprovedAt || null;

  let outcome: "approved" | "rejected" | "awaiting" | "na" = "na";
  let actor: { name?: string } | null = null;
  let ts: any = null;
  let note: string | null = null;

  if (stage === "L1") {
    actor = row.approver || null;
    ts    = row.approvedAt || null;
    note  = row.approvalNote || null;
    if (status === "pending")                                     outcome = "awaiting";
    else if (status === "rejected" && !l2Ts)                      outcome = "rejected";
    else                                                          outcome = "approved";
  } else {
    actor = row.finalApprover || null;
    ts    = l2Ts;
    note  = row.finalApprovalNote || row.approvalNote || null;
    if (status === "pending")                                     outcome = "na";
    else if (status === "rejected" && !l2Ts)                      outcome = "na";
    else if (status === "partially_approved")                     outcome = "awaiting";
    else if (status === "approved")                               outcome = "approved";
    else if (status === "rejected" && l2Ts)                       outcome = "rejected";
  }

  if (outcome === "na") {
    return <span className="text-[12px] text-slate-300">—</span>;
  }

  const tone =
    outcome === "approved" ? "text-emerald-600 dark:text-emerald-300"
    : outcome === "rejected" ? "text-rose-600 dark:text-rose-300"
    : "text-amber-600 dark:text-amber-300";
  const dotBg =
    outcome === "approved" ? "bg-emerald-500"
    : outcome === "rejected" ? "bg-rose-500"
    : "bg-amber-500";
  const label =
    outcome === "approved" ? "Approved"
    : outcome === "rejected" ? "Rejected"
    : "Awaiting";

  return (
    <div className="min-w-[160px]">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`} />
        <span className={`text-[12px] font-semibold ${tone}`}>{label}</span>
      </div>
      {outcome === "awaiting" ? (
        canAct ? (
          <div className="flex items-center gap-1.5 mt-1.5">
            <button
              type="button"
              onClick={onApprove}
              disabled={actioning}
              title={`Approve at ${stage}`}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Check size={13} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={actioning}
              title={`Reject at ${stage}`}
              className="w-7 h-7 rounded-full flex items-center justify-center bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </div>
        ) : null
      ) : (
        <>
          <p className="text-[11.5px] text-slate-700 dark:text-slate-200 mt-0.5 truncate" title={actor?.name || ""}>
            {actor?.name || "—"}
          </p>
          <p className="text-[10.5px] text-slate-400">{fmtDt(ts) || "—"}</p>
          {note && outcome === "rejected" ? (
            <p className="text-[10.5px] text-rose-500/80 mt-0.5 truncate max-w-[180px]" title={note}>
              {note}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  // Two-stage approval flow:
  //   pending             → L1 (manager) hasn't acted yet  → "Pending L1"
  //   partially_approved  → L1 approved, L2 (HR/CEO) hasn't acted → "Pending L2"
  //   approved            → both stages cleared
  //   rejected/cancelled  → terminal
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending:             { bg: "bg-amber-100 dark:bg-amber-500/15",   text: "text-amber-700 dark:text-amber-300",     label: "Pending L1"  },
    partially_approved:  { bg: "bg-[#008CFF]/10 dark:bg-[#008CFF]/15", text: "text-[#008CFF]",                          label: "Pending L2"  },
    approved:            { bg: "bg-emerald-100 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", label: "Approved"    },
    rejected:            { bg: "bg-rose-100 dark:bg-rose-500/15",     text: "text-rose-700 dark:text-rose-300",        label: "Rejected"    },
    cancelled:           { bg: "bg-slate-100 dark:bg-white/[0.05]",   text: "text-slate-500",                          label: "Cancelled"   },
  };
  const m = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg} ${m.text}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}

function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return url ? (
    <img src={url} alt={name} style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-full bg-[#008CFF] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
      {initials}
    </div>
  );
}

/**
 * Shared approvals UI. Renders the 7 top tabs (Leave / Leave Encashment /
 * Comp Offs / Regularizations / WFH OD / Half Day / Shift & Weekly off) and
 * the filter + table for the active one.
 *
 * Used by:
 *   • /dashboard/hr/approvals           (standalone page wrapper, embedded=false)
 *   • /dashboard/hr/admin "Approvals" tab (embedded=true — drops the full-screen wash)
 */
export default function ApprovalsPanel({ embedded = false }: { embedded?: boolean }) {
  const { data: session } = useSession();
  const me = session?.user as any;
  const isFinalApprover = me?.orgLevel === "ceo" || me?.isDeveloper || me?.orgLevel === "hr_manager";

  const searchParams = useSearchParams();
  const router       = useRouter();
  const urlTab       = searchParams.get("tab") as TabKey | null;
  const validTab     = (v: string | null): TabKey => TABS.some((t) => t.key === v) ? (v as TabKey) : "leave";
  const [tab, setTab]         = useState<TabKey>(validTab(urlTab));
  useEffect(() => { setTab(validTab(urlTab)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [urlTab]);
  const [search, setSearch]   = useState("");
  const [picked, setPicked]   = useState<Set<number>>(new Set());
  const [actioning, setActioning] = useState(false);

  const [fBU,        setFBU]        = useState<Set<string>>(new Set());
  const [fDept,      setFDept]      = useState<Set<string>>(new Set());
  const [fLoc,       setFLoc]       = useState<Set<string>>(new Set());
  const [fCost,      setFCost]      = useState<Set<string>>(new Set());
  const [fLegal,     setFLegal]     = useState<Set<string>>(new Set());
  const [fStatus,    setFStatus]    = useState<Set<string>>(new Set());

  const { data: summary } = useSWR<{ byTab: Record<string, number>; total: number }>(
    `/api/hr/approvals/summary`,
    fetcher,
    { refreshInterval: 30_000 }
  );
  const [scope, setScope] = useState<"pending" | "all">("pending");
  const { data: tabData, isLoading, error } = useSWR(
    `/api/hr/approvals?tab=${tab}&scope=${scope}`,
    fetcher,
  );

  const rows: any[] = tabData?.items || [];

  const { buOpts, deptOpts, locOpts, legalOpts, statusOpts } = useMemo(() => {
    const users = rows.map((r) => r.user).filter(Boolean);
    const ents = entityOptions(users);
    const statusSet = new Set<string>();
    rows.forEach((r) => {
      if (r.status) statusSet.add(r.status);
    });
    return {
      buOpts:    ents,
      legalOpts: ents,
      deptOpts:  departmentOptions(users),
      locOpts:   locationOptions(users),
      statusOpts: Array.from(statusSet).sort().map((v) => ({
        // Match the StatusBadge wording so the filter shows "Pending L1" /
        // "Pending L2" instead of confusing raw enum values.
        // (legacy `partially_approved` → "Pending L2"; `pending` → "Pending L1".)
        // Falls through to title-case for terminal statuses.
        value: v,
        label: v === "partially_approved" ? "Pending L2"
              : v === "pending"            ? "Pending L1"
              : v.charAt(0).toUpperCase() + v.slice(1),
      })),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const matches = (selected: Set<string>, v: string) =>
      selected.size === 0 || (!!v && selected.has(v));
    return rows.filter((r: any) => {
      const u = r.user || {};
      const en = deriveEntity(u);
      const dp = deriveDepartment(u);
      const lc = deriveLocation(u);
      if (!matches(fBU,    en))               return false;
      if (!matches(fLegal, en))               return false;
      if (!matches(fCost,  en))               return false;
      if (!matches(fDept,  dp))               return false;
      if (!matches(fLoc,   lc))               return false;
      if (!matches(fStatus,    r.status ?? ""))          return false;
      if (search && !(
        (u.name  || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.employeeProfile?.employeeId || "").toLowerCase().includes(search.toLowerCase())
      )) return false;
      return true;
    });
  }, [rows, fBU, fDept, fLoc, fCost, fLegal, fStatus, search]);

  const anyFilter = fBU.size || fDept.size || fLoc.size || fCost.size || fLegal.size || fStatus.size;
  const clearFilters = () => {
    setFBU(new Set()); setFDept(new Set()); setFLoc(new Set()); setFCost(new Set());
    setFLegal(new Set()); setFStatus(new Set());
  };

  const toggleRow = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllVisible = () => {
    const allIds = filtered.map((r) => r.id);
    const allPicked = allIds.every((i) => picked.has(i));
    setPicked(allPicked ? new Set() : new Set(allIds));
  };

  const canActOn = (r: any) => {
    if (r.status === "pending")             return true;
    if (r.status === "partially_approved")  return isFinalApprover;
    return false;
  };

  // Each tab hits its own approve/reject endpoint. Leave uses the
  // per-id /api/hr/leaves/[id] route; the others take { id, action } in the body.
  const actOnIds = async (ids: number[], action: "approve" | "reject", note?: string) => {
    if (ids.length === 0 || actioning) return;
    setActioning(true);

    let doOne: (id: number) => Promise<Response>;
    if (tab === "leave") {
      doOne = (id) => fetch(`/api/hr/leaves/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action, approvalNote: note || null }),
      });
    } else if (tab === "regularize") {
      doOne = (id) => fetch(`/api/hr/attendance/regularize`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id, action, approvalNote: note || null }),
      });
    } else if (tab === "wfh") {
      // "WFH / OD" tab combines both; items carry _kind so we hit the right route.
      doOne = async (id) => {
        const row = rows.find((r: any) => r.id === id);
        const isOd = row?._kind === "on_duty";
        return fetch(isOd ? `/api/hr/attendance/on-duty` : `/api/hr/attendance/wfh`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ id, action, approvalNote: note || null }),
        });
      };
    } else if (tab === "comp_off") {
      doOne = (id) => fetch(`/api/hr/leaves/comp-off`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id, action, approvalNote: note || null }),
      });
    } else {
      // Tabs without an approve endpoint yet (half_day, etc.)
      setActioning(false);
      return;
    }

    await Promise.all(ids.map((id) => doOne(id)));
    mutate((k: any) =>
      typeof k === "string" && (
        k.startsWith("/api/hr/approvals") ||
        k === "/api/hr/approvals/summary" ||
        k.startsWith("/api/hr/leaves") ||
        k.startsWith("/api/hr/attendance/regularize") ||
        k.startsWith("/api/hr/attendance/wfh") ||
        k.startsWith("/api/hr/attendance/on-duty") ||
        k.startsWith("/api/hr/notifications")
      )
    );
    setPicked(new Set());
    setActioning(false);
  };

  // When the user picks Reject (single-row or bulk) we open a modal that
  // collects the reason. `pending` holds the ids to reject + a friendly
  // label so the modal can preview what's about to happen.
  const [rejectPending, setRejectPending] = useState<{ ids: number[]; label: string } | null>(null);

  const actOne = (id: number, action: "approve" | "reject") => {
    if (action === "reject") {
      setRejectPending({ ids: [id], label: "this request" });
      return;
    }
    actOnIds([id], action);
  };

  // When embedded in the HR Dashboard, drop the full-screen wash + the
  // page-level URL replace so we don't fight with the host page's tab rail.
  const updateUrl = (t: TabKey) => {
    if (embedded) return; // tab state stays local
    router.replace(`/dashboard/hr/approvals?tab=${t}`, { scroll: false });
  };

  const body = (
    <>
      {/* Approval module tabs */}
      <div className={embedded
        ? "bg-white border-b border-slate-200 dark:border-white/[0.06]"
        : "bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6"}>
        <div className={`flex items-center gap-0 overflow-x-auto ${embedded ? "px-0" : ""}`}>
          {TABS.map((t) => {
            const active = t.key === tab;
            const count = summary?.byTab?.[t.key] ?? 0;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setPicked(new Set()); updateUrl(t.key); }}
                className={`relative px-4 py-3 text-[12px] font-bold tracking-wider whitespace-nowrap transition-colors border-b-2 ${
                  active ? "border-[#008CFF] text-[#008CFF]"
                         : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                }`}
              >
                {t.label.toUpperCase()}
                {count > 0 && (
                  <span className={`ml-2 inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full text-[10px] font-bold align-top ${
                    active ? "bg-[#008CFF] text-white" : "bg-[#008CFF]/15 text-[#008CFF]"
                  }`}>
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={embedded ? "py-5" : "px-6 py-5"}>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h1 className="text-[17px] font-semibold text-slate-800 dark:text-white">
            {scope === "all" ? "History — " : "Pending "}
            {tab === "leave"      ? "leave approvals"             :
             tab === "regularize" ? "regularization requests"     :
             tab === "wfh"        ? "WFH / On-Duty requests"      :
             tab === "comp_off"   ? "comp-off requests"           :
                                    "requests"}
          </h1>
          {/* Pending vs History toggle — lets approvers see past decisions. */}
          {(tab === "leave" || tab === "regularize" || tab === "wfh" || tab === "comp_off") && (
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-white/[0.08] overflow-hidden text-[12px] font-semibold">
              <button type="button" onClick={() => setScope("pending")}
                className={`h-8 px-3 transition-colors ${
                  scope === "pending"
                    ? "bg-[#008CFF] text-white"
                    : "bg-white dark:bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5"
                }`}>Pending</button>
              <button type="button" onClick={() => setScope("all")}
                className={`h-8 px-3 border-l border-slate-200 dark:border-white/[0.08] transition-colors ${
                  scope === "all"
                    ? "bg-[#008CFF] text-white border-[#008CFF]"
                    : "bg-white dark:bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5"
                }`}>All history</button>
            </div>
          )}
        </div>

        {/* Simple read/act table for regularize / wfh / on_duty / comp_off tabs */}
        {(tab === "regularize" || tab === "wfh" || tab === "comp_off") && (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
            ) : error ? (
              <p className="py-16 text-center text-[13px] text-rose-500">Couldn't load approvals</p>
            ) : rows.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-slate-400">No pending requests</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
                    {(tab === "regularize"
                      // Regularization: single-stage HR-only — no L1/L2 split.
                      ? ["EMPLOYEE", "DATE", "REQUESTED IN / OUT", "REASON", "STATUS", "APPROVAL NOTE", "ACTIONS"]
                      // WFH / OD / Comp-off: two-stage L1 → L2.
                      : ["EMPLOYEE", tab === "comp_off" ? "WORKED DATE" : "DATE", "DETAILS", "REASON", "L1 APPROVAL", "L2 APPROVAL", "REQUEST STATUS"]
                    ).map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => {
                    const u = r.user || {};
                    const dateObj = new Date(r.date || r.workedDate);
                    const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                    const fmtTime = (iso: string | null | undefined) => iso
                      ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true })
                      : "—";
                    const details = tab === "regularize"
                      ? `${fmtTime(r.requestedIn)} → ${fmtTime(r.requestedOut)}`
                      : tab === "wfh" && r._kind === "on_duty"
                        ? `On Duty${r.location ? ` @ ${r.location}` : ""}`
                      : tab === "wfh"
                        ? "Work From Home"
                      : tab === "comp_off"
                        ? `${r.creditDays ?? 1} day(s)`
                        : "—";
                    const reason = r.reason || r.purpose || "—";
                    const isTwoStage = tab === "wfh" || tab === "comp_off";
                    // ApprovalCell expects approvedAt / finalApprover / finalApprovedAt
                    // shape used by leave rows. WFH / OD / Comp-off don't have those
                    // schema fields, so we synthesise them from the row's
                    // existing data — `updatedAt` is a fine proxy for the stage
                    // timestamp because it changes on every status transition.
                    const stageRow = {
                      ...r,
                      approvedAt:        r.approvedAt        ?? r.updatedAt,
                      finalApprovedAt:   r.finalApprovedAt   ?? (r.status === "approved" || (r.status === "rejected" && r.approvedById) ? r.updatedAt : null),
                      finalApprover:     r.finalApprover     ?? null,
                      finalApprovalNote: r.finalApprovalNote ?? null,
                    };
                    return (
                      <tr key={`${r._kind ?? tab}-${r.id}`} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/60 dark:hover:bg-white/[0.015]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar name={u.name || "?"} url={u.profilePictureUrl} size={32} />
                            <div className="min-w-0">
                              <Link href={`/dashboard/hr/people/${u.id}`} className="text-[13px] font-semibold text-slate-800 dark:text-white hover:text-[#008CFF] truncate block">
                                {u.name}
                              </Link>
                              <span className="text-[11px] text-slate-500 truncate block">
                                {u.employeeProfile?.designation || getUserRoleLabel(u.role) || "—"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-[12.5px] text-slate-700 dark:text-slate-300">{fmt(dateObj)}</p>
                          <p className="text-[10.5px] text-slate-400 mt-0.5">
                            <span className="font-semibold text-slate-500">Submitted</span> · {fmtDt(r.createdAt)}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-[12.5px] text-slate-700 dark:text-slate-300 whitespace-nowrap">{details}</td>
                        <td className="px-4 py-3 text-[12.5px] text-slate-600 dark:text-slate-400 max-w-[260px] truncate" title={reason}>{reason}</td>

                        {isTwoStage ? (
                          <>
                            <td className="px-4 py-3 align-top">
                              <ApprovalCell
                                stage="L1"
                                row={stageRow}
                                canAct={r.status === "pending" && canActOn(r)}
                                onApprove={() => actOne(r.id, "approve")}
                                onReject={() => actOne(r.id, "reject")}
                                actioning={actioning}
                              />
                            </td>
                            <td className="px-4 py-3 align-top">
                              <ApprovalCell
                                stage="L2"
                                row={stageRow}
                                canAct={r.status === "partially_approved" && isFinalApprover}
                                onApprove={() => actOne(r.id, "approve")}
                                onReject={() => actOne(r.id, "reject")}
                                actioning={actioning}
                              />
                            </td>
                            <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                            <td className="px-4 py-3 text-[12px] text-slate-600 dark:text-slate-400 max-w-[220px] truncate" title={r.approvalNote ?? ""}>
                              {r.approvalNote || <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              {canActOn(r) ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => actOne(r.id, "approve")}
                                    disabled={actioning}
                                    title="Approve"
                                    className="w-7 h-7 rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    <Check size={13} strokeWidth={2.5} />
                                  </button>
                                  <button
                                    onClick={() => actOne(r.id, "reject")}
                                    disabled={actioning}
                                    title="Reject"
                                    className="w-7 h-7 rounded-full flex items-center justify-center bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-30 disabled:cursor-not-allowed"
                                  >
                                    <X size={13} strokeWidth={2.5} />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-400">—</span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Tabs that genuinely have no backing data yet */}
        {(tab === "leave_encashment" || tab === "half_day" || tab === "shift_weekly_off") && (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-12 text-center">
            <p className="text-[14px] font-semibold text-slate-700 dark:text-white mb-1">{TABS.find((t) => t.key === tab)?.label}</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Approvals for this module will be enabled here soon.</p>
          </div>
        )}

        {tab === "leave" && (
          <>
            {/* Filter bar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <FilterDropdown label="Business Unit" options={buOpts}        selected={fBU}        onChange={setFBU}        />
              <FilterDropdown label="Department"    options={deptOpts}      selected={fDept}      onChange={setFDept}      width={280} />
              <FilterDropdown label="Location"      options={locOpts}       selected={fLoc}       onChange={setFLoc}       />
              <FilterDropdown label="Legal Entity"  options={legalOpts}     selected={fLegal}     onChange={setFLegal}     />
              <FilterDropdown label="Leave Status"  options={statusOpts}    selected={fStatus}    onChange={setFStatus}    width={220} />
              {anyFilter ? (
                <button type="button" onClick={clearFilters}
                  className="h-9 px-3 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-[#008CFF] transition-colors">
                  Clear filters
                </button>
              ) : null}
              <div className="relative flex-1 min-w-[200px]">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                  className="w-full h-9 pl-9 pr-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-500 focus:outline-none focus:border-[#008CFF]/40" />
              </div>
            </div>

            {/* Bulk action row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const acts = filtered.filter((r) => picked.has(r.id) && canActOn(r)).map((r) => r.id);
                    actOnIds(acts, "approve");
                  }}
                  disabled={picked.size === 0 || actioning}
                  className="h-9 px-4 rounded-lg text-[12px] font-semibold bg-[#008CFF] text-white hover:bg-[#0070cc] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Check size={14} strokeWidth={2.5} /> Approve
                </button>
                <button
                  onClick={() => {
                    const acts = filtered.filter((r) => picked.has(r.id) && canActOn(r)).map((r) => r.id);
                    if (acts.length === 0) return;
                    setRejectPending({
                      ids: acts,
                      label: acts.length === 1 ? "this request" : `${acts.length} requests`,
                    });
                  }}
                  disabled={picked.size === 0 || actioning}
                  className="h-9 px-4 rounded-lg text-[12px] font-semibold border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:border-rose-400 hover:text-rose-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <X size={14} strokeWidth={2.5} /> Reject
                </button>
              </div>
              <span className="text-[11.5px] text-slate-500 dark:text-slate-400">Total: {filtered.length}</span>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              {isLoading ? (
                <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
              ) : error ? (
                <p className="py-16 text-center text-[13px] text-rose-500">Couldn't load approvals</p>
              ) : filtered.length === 0 ? (
                <p className="py-16 text-center text-[13px] text-slate-400">No pending leave approvals</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
                      <th className="px-4 py-3 text-left">
                        <input type="checkbox"
                          checked={filtered.length > 0 && filtered.every((r) => picked.has(r.id))}
                          onChange={toggleAllVisible}
                          className="w-3.5 h-3.5 rounded border-slate-300 accent-[#008CFF]" />
                      </th>
                      {["EMPLOYEE","EMPLOYEE NUMBER","DEPARTMENT","LOCATION","BUSINESS UNIT","LEGAL ENTITY","LEAVE DATES","LEAVE TYPE","REASON","L1 APPROVAL","L2 APPROVAL","REQUEST STATUS"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r: any) => {
                      const u = r.user || {};
                      const profile = u.employeeProfile || {};
                      const entity = deriveEntity(u);
                      const from = new Date(r.fromDate);
                      const to   = new Date(r.toDate);
                      const same = from.toDateString() === to.toDateString();
                      const totalDays = parseFloat(String(r.totalDays ?? "1"));
                      const actionable = canActOn(r);

                      return (
                        <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.04] hover:bg-slate-50/60 dark:hover:bg-white/[0.015]">
                          <td className="px-4 py-3">
                            <input type="checkbox"
                              checked={picked.has(r.id)}
                              onChange={() => toggleRow(r.id)}
                              disabled={!actionable}
                              className="w-3.5 h-3.5 rounded border-slate-300 accent-[#008CFF] disabled:opacity-30" />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <Avatar name={u.name || "?"} url={u.profilePictureUrl} size={36} />
                              <div className="min-w-0">
                                <Link href={`/dashboard/hr/people/${u.id}`} className="text-[13px] font-semibold text-slate-800 dark:text-white hover:text-[#008CFF] truncate block">
                                  {u.name}
                                </Link>
                                <span className="text-[11px] text-slate-500 truncate block">
                                  {profile.designation || getUserRoleLabel(u.role) || "—"}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[12.5px] text-slate-700 dark:text-slate-300 font-mono">{profile.employeeId || "—"}</td>
                          <td className="px-4 py-3 text-[12.5px] text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{profile.department || "—"}</td>
                          <td className="px-4 py-3 text-[12.5px] text-slate-700 dark:text-slate-300">{profile.workLocation || "—"}</td>
                          <td className="px-4 py-3 text-[12.5px] text-slate-700 dark:text-slate-300">{entity === "NB" ? "NB Media" : "—"}</td>
                          <td className="px-4 py-3 text-[12.5px] text-slate-700 dark:text-slate-300">{entity === "NB" ? "NB Media" : "—"}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="text-[12.5px] text-slate-800 dark:text-white font-medium">
                              {same
                                ? from.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                                : `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              {totalDays} day{totalDays === 1 ? "" : "s"}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-[12.5px] text-slate-800 dark:text-white">{r.leaveType?.name || "Leave"}</p>
                            <p className="text-[10.5px] text-slate-400 mt-0.5">
                              <span className="font-semibold text-slate-500">Applied</span> · {fmtDt(r.appliedAt)}
                            </p>
                          </td>
                          {/* Reason — what the employee wrote when applying.
                              Truncate visually but keep the full text in a
                              title attribute so HR can hover for the rest. */}
                          <td className="px-4 py-3 text-[12.5px] text-slate-700 dark:text-slate-300 max-w-[260px] truncate"
                              title={r.reason || ""}>
                            {r.reason ? r.reason : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <ApprovalCell
                              stage="L1"
                              row={r}
                              canAct={r.status === "pending" && actionable}
                              onApprove={() => actOne(r.id, "approve")}
                              onReject={() => actOne(r.id, "reject")}
                              actioning={actioning}
                            />
                          </td>
                          <td className="px-4 py-3 align-top">
                            <ApprovalCell
                              stage="L2"
                              row={r}
                              canAct={r.status === "partially_approved" && isFinalApprover}
                              onApprove={() => actOne(r.id, "approve")}
                              onReject={() => actOne(r.id, "reject")}
                              actioning={actioning}
                            />
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Rejection-reason modal — replaces the browser prompt() so the
          experience matches the rest of the dashboard. */}
      {rejectPending && (
        <RejectReasonModal
          label={rejectPending.label}
          onCancel={() => setRejectPending(null)}
          onConfirm={(note) => {
            const ids = rejectPending.ids;
            setRejectPending(null);
            actOnIds(ids, "reject", note);
          }}
        />
      )}
    </>
  );

  return embedded ? body : (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">{body}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RejectReasonModal — collects a reason before firing the reject action.
// Submit is disabled until the reason has at least 3 non-whitespace chars,
// keeps Esc / outside-click behaviour predictable, and auto-focuses the
// textarea on open so HR can start typing immediately.
// ─────────────────────────────────────────────────────────────────────────────
function RejectReasonModal({
  label, onCancel, onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && note.trim().length >= 3) {
        onConfirm(note.trim());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, onCancel, onConfirm]);

  const tooShort = note.trim().length < 3;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <div className="mt-0.5 h-9 w-9 rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
            <X size={18} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white">
              Reject {label}
            </h3>
            <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
              Share a short reason so the requester knows what to fix. They'll see this
              note in their notification email.
            </p>
          </div>
        </div>

        <div className="px-6 py-5">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
            Reason for rejection
          </label>
          <textarea
            ref={textareaRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Coverage already arranged for this date — please pick another."
            rows={4}
            className="w-full resize-none rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1526] px-3 py-2.5 text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:focus:ring-rose-500/10"
            maxLength={500}
          />
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>{tooShort ? "At least 3 characters." : "Looks good."}</span>
            <span>{note.length}/500</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] bg-slate-50/60 dark:bg-white/[0.02]">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note.trim())}
            disabled={tooShort}
            className="h-9 px-4 rounded-lg text-[13px] font-semibold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <X size={14} strokeWidth={2.5} /> Confirm Rejection
          </button>
        </div>
      </div>
    </div>
  );
}
