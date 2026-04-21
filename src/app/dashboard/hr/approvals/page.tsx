"use client";
import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { Check, X, MoreHorizontal, Calendar, ArrowDown, Home, Shield, Clock3 } from "lucide-react";
import FilterDropdown from "@/components/hr/FilterDropdown";
import {
  deriveEntity,
  deriveDepartment,
  deriveLocation,
  entityOptions,
  departmentOptions,
  locationOptions,
} from "@/lib/hr-taxonomy";
import { getUserRoleLabel } from "@/lib/user-role-options";

// ── Tab config ──────────────────────────────────────────────────────────────
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

// Renders a pill-style status badge.
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending:             { bg: "bg-amber-100 dark:bg-amber-500/15",  text: "text-amber-700 dark:text-amber-300",  label: "Pending"            },
    partially_approved:  { bg: "bg-[#008CFF]/10 dark:bg-[#008CFF]/15", text: "text-[#008CFF]",                   label: "Partially Approved" },
    approved:            { bg: "bg-emerald-100 dark:bg-emerald-500/15", text: "text-emerald-700 dark:text-emerald-300", label: "Approved"         },
    rejected:            { bg: "bg-rose-100 dark:bg-rose-500/15",     text: "text-rose-700 dark:text-rose-300",    label: "Rejected"           },
    cancelled:           { bg: "bg-slate-100 dark:bg-white/[0.05]",   text: "text-slate-500",                      label: "Cancelled"          },
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

export default function ApprovalsPage() {
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

  // Filters (same palette as Employee Directory)
  const [fBU,   setFBU]   = useState<Set<string>>(new Set());
  const [fDept, setFDept] = useState<Set<string>>(new Set());
  const [fLoc,  setFLoc]  = useState<Set<string>>(new Set());
  const [fCost, setFCost] = useState<Set<string>>(new Set());
  const [fLegal,setFLegal] = useState<Set<string>>(new Set());
  const [fLeaveType, setFLeaveType] = useState<Set<string>>(new Set());
  const [fStatus,    setFStatus]    = useState<Set<string>>(new Set());

  const tabsCounts = useSWR(`/api/hr/approvals?tab=leave`, fetcher, { refreshInterval: 30_000 });
  const { data: tabData, isLoading, error } = useSWR(`/api/hr/approvals?tab=${tab}`, fetcher);

  const rows: any[] = tabData?.items || [];

  // Build filter options from the rows' users
  const { buOpts, deptOpts, locOpts, costOpts, legalOpts, leaveTypeOpts, statusOpts } = useMemo(() => {
    const users = rows.map((r) => r.user).filter(Boolean);
    const ents = entityOptions(users);
    const leaveTypeSet = new Set<string>();
    const statusSet    = new Set<string>();
    rows.forEach((r) => {
      if (r.leaveType?.name) leaveTypeSet.add(r.leaveType.name);
      if (r.status) statusSet.add(r.status);
    });
    return {
      buOpts:        ents,
      costOpts:      ents,
      legalOpts:     ents,
      deptOpts:      departmentOptions(users),
      locOpts:       locationOptions(users),
      leaveTypeOpts: Array.from(leaveTypeSet).sort().map((v) => ({ value: v, label: v })),
      statusOpts:    Array.from(statusSet).sort().map((v) => ({
        value: v,
        label: v === "partially_approved" ? "Partially Approved" : v.charAt(0).toUpperCase() + v.slice(1),
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
      if (!matches(fLeaveType, r.leaveType?.name ?? "")) return false;
      if (!matches(fStatus,    r.status ?? ""))          return false;
      if (search && !(
        (u.name  || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.employeeProfile?.employeeId || "").toLowerCase().includes(search.toLowerCase())
      )) return false;
      return true;
    });
  }, [rows, fBU, fDept, fLoc, fCost, fLegal, fLeaveType, fStatus, search]);

  const anyFilter = fBU.size || fDept.size || fLoc.size || fCost.size || fLegal.size || fLeaveType.size || fStatus.size;
  const clearFilters = () => { setFBU(new Set()); setFDept(new Set()); setFLoc(new Set()); setFCost(new Set()); setFLegal(new Set()); setFLeaveType(new Set()); setFStatus(new Set()); };

  const toggleRow = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
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

  const actOnIds = async (ids: number[], action: "approve" | "reject", note?: string) => {
    if (ids.length === 0 || actioning) return;
    setActioning(true);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/hr/leaves/${id}`, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action, approvalNote: note || null }),
        })
      )
    );
    mutate((k: any) => typeof k === "string" && (k.startsWith("/api/hr/approvals") || k.startsWith("/api/hr/leaves") || k.startsWith("/api/hr/notifications")));
    setPicked(new Set());
    setActioning(false);
  };

  const actOne = (id: number, action: "approve" | "reject") => {
    const note = action === "reject" ? (prompt("Reason for rejection?") || "") : undefined;
    if (action === "reject" && !note) return;
    actOnIds([id], action, note);
  };

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Approval module tabs */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6">
        <div className="flex items-center gap-0 overflow-x-auto">
          {TABS.map((t) => {
            const active = t.key === tab;
            const count = t.key === "leave" ? tabsCounts.data?.count : 0;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setPicked(new Set()); router.replace(`/dashboard/hr/approvals?tab=${t.key}`, { scroll: false }); }}
                className={`relative px-4 py-3 text-[12px] font-bold tracking-wider whitespace-nowrap transition-colors border-b-2 ${
                  active ? "border-[#008CFF] text-[#008CFF]"
                         : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white"
                }`}
              >
                {t.label.toUpperCase()}
                {count > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-[18px] px-1 rounded-full bg-[#008CFF] text-white text-[10px] font-bold align-top">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-6 py-5">
        <h1 className="text-[17px] font-semibold text-slate-800 dark:text-white mb-4">
          {tab === "leave" ? "Pending leave approvals" : "Coming soon"}
        </h1>

        {tab !== "leave" ? (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-12 text-center">
            <p className="text-[14px] font-semibold text-slate-700 dark:text-white mb-1">{TABS.find((t) => t.key === tab)?.label}</p>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Approvals for this module will be enabled here soon.</p>
          </div>
        ) : (
          <>
            {/* Filter bar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <FilterDropdown label="Business Unit" options={buOpts}        selected={fBU}        onChange={setFBU}        />
              <FilterDropdown label="Department"    options={deptOpts}      selected={fDept}      onChange={setFDept}      width={280} />
              <FilterDropdown label="Location"      options={locOpts}       selected={fLoc}       onChange={setFLoc}       />
              <FilterDropdown label="Legal Entity"  options={legalOpts}     selected={fLegal}     onChange={setFLegal}     />
              <FilterDropdown label="Leave Type"    options={leaveTypeOpts} selected={fLeaveType} onChange={setFLeaveType} width={220} />
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
                    const note = prompt("Reason for rejection?") || "";
                    if (!note) return;
                    const acts = filtered.filter((r) => picked.has(r.id) && canActOn(r)).map((r) => r.id);
                    actOnIds(acts, "reject", note);
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
                      {["EMPLOYEE","EMPLOYEE NUMBER","DEPARTMENT","LOCATION","BUSINESS UNIT","LEGAL ENTITY","LEAVE DATES","LEAVE TYPE","REQUEST STATUS","ACTIONS"].map((h) => (
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
                            <p className="text-[11px] text-slate-400">Requested on {new Date(r.appliedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                          </td>

                          <td className="px-4 py-3"><StatusBadge status={r.status} /></td>

                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => actOne(r.id, "approve")}
                                disabled={!actionable || actioning}
                                title={actionable ? "Approve" : "You can't act on this request"}
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Check size={13} strokeWidth={2.5} />
                              </button>
                              <button
                                onClick={() => actOne(r.id, "reject")}
                                disabled={!actionable || actioning}
                                title={actionable ? "Reject" : "You can't act on this request"}
                                className="w-7 h-7 rounded-full flex items-center justify-center bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-100 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <X size={13} strokeWidth={2.5} />
                              </button>
                              <button
                                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.05]"
                                title="Details"
                              >
                                <MoreHorizontal size={14} strokeWidth={2} />
                              </button>
                            </div>
                          </td>
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
    </div>
  );
}
