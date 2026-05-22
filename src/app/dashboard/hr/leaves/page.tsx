"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import SelectField from "@/components/ui/SelectField";
import { isHRAdmin, canApplyRestrictedLeave } from "@/lib/access";
import { DateField } from "@/components/ui/date-field";
import EmployeePicker, { type PickerUser } from "@/components/hr/EmployeePicker";

const TOP_TABS = [
  { key: "home",        label: "HOME",              href: "/dashboard/hr/home"  },
  { key: "attendance",  label: "ATTENDANCE",        href: "/dashboard/hr/attendance" },
  { key: "leave",       label: "LEAVE",             href: "/dashboard/hr/leaves"     },
  { key: "performance", label: "PERFORMANCE",       href: "/dashboard/hr/goals"      },
  { key: "apps",        label: "APPS",              href: "/dashboard/hr/apps"       },
];

function DoughnutChart({ available, total, color }: { available: number; total: number; color: string }) {
  const pct = total > 0 ? (available / total) * 100 : 0;
  const r = 54, cx = 64, cy = 64, circum = 2 * Math.PI * r;
  const offset = circum - (pct / 100) * circum;
  return (
    <div className="relative w-[128px] h-[128px]">
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="10" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={circum} strokeDashoffset={offset} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-slate-800 dark:text-white">{available}</span>
        <span className="text-[11px] text-cyan-300">Days</span>
        <span className="text-[10px] text-slate-500 dark:text-slate-400">Available</span>
      </div>
    </div>
  );
}

export default function LeavesPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access + role=admin.
  const isAdmin = isHRAdmin(user);
  const [view, setView] = useState<"my" | "team">("my");
  const [showApply, setShowApply] = useState(false);
  const [showCompOff, setShowCompOff] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);

  const { data: balancesRaw = [] } = useSWR("/api/hr/leaves/balance", fetcher);
  // Drop fully-zero rows (no quota AND nothing used or pending) so the
  // grid only renders types the user actually has a balance for. The
  // self-healing balance endpoint creates one row per active type, but
  // we don't want to show a "0 days / 0 days" tile for every entry.
  const balances = (balancesRaw as any[]).filter((b) => {
    if (!b.leaveType) return false;
    const total = parseFloat(b.totalDays   ?? "0");
    const used  = parseFloat(b.usedDays    ?? "0");
    const pend  = parseFloat(b.pendingDays ?? "0");
    return total > 0 || used > 0 || pend > 0;
  });
  const { data: applications = [] } = useSWR(`/api/hr/leaves?view=${view}`, fetcher);
  const { data: leaveTypes = [] } = useSWR("/api/hr/leaves/types", fetcher);

  const pendingApps = applications.filter((a: any) => a.status === "pending");

  const handleAction = async (id: number, action: string) => {
    const res = await fetch(`/api/hr/leaves/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) { const d = await res.json(); return alert(d.error); }
    mutate((key: string) => typeof key === "string" && key.includes("/api/hr/leaves"));
  };

  const balanceColors = ["#22d3ee", "#a78bfa", "#f472b6", "#34d399", "#fbbf24", "#f87171"];

  return (
    <div className="space-y-0 relative">
      {/* ── Top Module Tabs (Keka exact) ── */}
      <div className="flex items-center gap-0 bg-[#f4f7f8] dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6">
        {TOP_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-5 py-3 text-[12px] font-semibold tracking-wider transition-colors border-b-2 ${
              t.key === "leave" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* ── Sub-tab: Summary ── */}
      <div className="flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/[0.06] bg-[#f4f7f8] dark:bg-[#001529]">
        <div className="flex gap-0">
          <button className="px-4 py-2.5 text-[13px] font-medium border-b-2 border-[#008CFF] text-slate-800 dark:text-white">Summary</button>
        </div>
        <div className="flex border border-slate-200 dark:border-white/[0.08] rounded overflow-hidden">
          {(["my", "team"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`h-8 px-3 text-[12px] font-medium ${view === v ? "bg-[#008CFF]/20 text-[#008CFF]" : "text-slate-500 hover:text-slate-800 dark:text-white"}`}>
              {v === "my" ? "My Leaves" : "Team"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Main 3-column layout (like Keka) ── */}
      <div className="grid grid-cols-12 min-h-[calc(100vh-160px)]">
        {/* ── Center: Main Content ── */}
        <div className="col-span-9 px-6 py-5 space-y-6">
          {/* ── Pending leave requests ── */}
          {pendingApps.length > 0 && (
            <div>
              <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-3">Pending leave requests</h3>
              <div className="space-y-3">
                {pendingApps.map((app: any) => (
                  <div key={app.id} className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 flex items-center gap-8">
                    <div className="w-10 h-10 rounded-full bg-[#008CFF]/20 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-[#008CFF]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                    </div>
                    {view === "team" && <div className="min-w-[100px]"><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Employee</span><span className="text-[13px] text-slate-800 dark:text-white font-medium">{app.user?.name}</span></div>}
                    <div className="min-w-[140px]"><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Leave Dates</span><span className="text-[13px] text-slate-800 dark:text-white">{(() => {
                      const from = new Date(app.fromDate);
                      const to   = new Date(app.toDate);
                      const same = from.toDateString() === to.toDateString();
                      return same
                        ? `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (${app.totalDays} day${app.totalDays > 1 ? "s" : ""})`
                        : `${from.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} (${app.totalDays} day${app.totalDays > 1 ? "s" : ""})`;
                    })()}</span></div>
                    <div className="min-w-[120px]"><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Leave Type</span><span className="text-[13px] text-slate-800 dark:text-white">{app.leaveType.name}</span></div>
                    <div className="min-w-[120px]"><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Requested On</span><span className="text-[13px] text-slate-800 dark:text-white">{new Date(app.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
                    <div className="flex-1"><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Status</span><span className="text-[13px] text-amber-400">Pending</span></div>
                    {app.reason && <p className="text-[12px] text-slate-500 dark:text-slate-400 italic">Leave Note: {app.reason}</p>}
                    <div className="shrink-0 relative">
                      {view === "team" ? (
                        <div className="flex gap-2">
                          <button onClick={() => handleAction(app.id, "approve")} className="h-7 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-medium">Approve</button>
                          <button onClick={() => handleAction(app.id, "reject")} className="h-7 px-3 bg-red-600 hover:bg-red-500 text-white rounded text-[11px] font-medium">Reject</button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => setOpenDropdown(openDropdown === app.id ? null : app.id)}
                            className="w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-lg text-lg font-bold">
                            ⋯
                          </button>
                          {openDropdown === app.id && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setOpenDropdown(null)} />
                              <div className="absolute right-0 top-9 z-40 w-44 bg-white dark:bg-[#001e3c] border border-slate-200 dark:border-white/[0.08] rounded-xl shadow-xl overflow-hidden">
                                <button onClick={() => setOpenDropdown(null)} className="w-full px-4 py-2.5 text-left text-[13px] text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5">View Request</button>
                                <button onClick={() => setOpenDropdown(null)} className="w-full px-4 py-2.5 text-left text-[13px] text-slate-700 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5">Edit Leave</button>
                                <button onClick={() => { handleAction(app.id, "cancel"); setOpenDropdown(null); }} className="w-full px-4 py-2.5 text-left text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">Cancel Leave</button>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── My Leave Stats (3 chart cards) ── */}
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-3">My Leave Stats</h3>
            <div className="grid grid-cols-3 gap-4">
              {/* Weekly Pattern */}
              <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[13px] font-medium text-slate-800 dark:text-white">Weekly Pattern</h4>
                  <span className="text-slate-500 text-sm cursor-pointer">ⓘ</span>
                </div>
                <div className="flex items-end gap-2 h-16">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => {
                    const h = [25, 20, 28, 18, 35, 12, 8][i];
                    return <div key={d} className="flex-1 flex flex-col items-center gap-1.5">
                      <div className="w-full rounded-sm" style={{ height: `${h}px`, background: "#a78bfa" }} />
                      <span className="text-[10px] text-slate-500">{d}</span>
                    </div>;
                  })}
                </div>
              </div>

              {/* Consumed Leave Types (Doughnut) */}
              <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[13px] font-medium text-slate-800 dark:text-white">Consumed Leave Types</h4>
                  <span className="text-slate-500 text-sm cursor-pointer">ⓘ</span>
                </div>
                <div className="flex items-center justify-center">
                  <div className="relative w-[100px] h-[100px]">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="12" />
                      {balances.map((_: any, i: number) => {
                        const total = balances.reduce((s: number, b: any) => s + parseFloat(b.usedDays || 0), 0) || 1;
                        const used = parseFloat(balances[i]?.usedDays || 0);
                        const pct = (used / total) * 100;
                        const prevPct = balances.slice(0, i).reduce((s: number, b: any) => s + (parseFloat(b.usedDays || 0) / total) * 100, 0);
                        const circum = 2 * Math.PI * 40;
                        return <circle key={i} cx="50" cy="50" r="40" fill="none" stroke={balanceColors[i % balanceColors.length]} strokeWidth="12"
                          strokeDasharray={`${(pct / 100) * circum} ${circum}`} strokeDashoffset={-(prevPct / 100) * circum} />;
                      })}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[11px] text-cyan-300 font-medium">Leave</span>
                      <span className="text-[11px] text-cyan-300 font-medium">Types</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Monthly Stats */}
              <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[13px] font-medium text-slate-800 dark:text-white">Monthly Stats</h4>
                  <span className="text-slate-500 text-sm cursor-pointer">ⓘ</span>
                </div>
                <div className="flex items-end gap-1 h-16">
                  {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => {
                    const h = [5, 8, 22, 15, 3, 0, 0, 0, 0, 0, 0, 0][i];
                    return <div key={m} className="flex-1 flex flex-col items-center gap-1.5">
                      <div className="w-full rounded-sm" style={{ height: `${Math.max(h, 2)}px`, background: h > 0 ? "#a78bfa" : "#1e293b" }} />
                      <span className="text-[9px] text-slate-500">{m}</span>
                    </div>;
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* ── Leave Balances ── naked ring grid: no per-ring card,
              just the doughnut + label so the rings read as the data
              itself rather than a framed widget. Cool-tone palette
              (blue → violet) keeps the row cohesive. */}
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-4">Leave Balances</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-y-6 gap-x-4">
              {balances.map((lb: any, i: number) => {
                const total = parseFloat(lb.totalDays);
                const used  = parseFloat(lb.usedDays);
                const pend  = parseFloat(lb.pendingDays);
                const avail = Math.max(0, total - used - pend);
                const fmt   = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
                const PROFESSIONAL_COLORS = [
                  "#008CFF", // brand blue
                  "#0ea5e9", // sky-500
                  "#06b6d4", // cyan-500
                  "#14b8a6", // teal-500
                  "#6366f1", // indigo-500
                  "#8b5cf6", // violet-500
                ];
                const color = PROFESSIONAL_COLORS[i % PROFESSIONAL_COLORS.length];
                const empty = total === 0;
                return (
                  <div key={lb.id} className="flex flex-col items-center gap-2">
                    {empty ? (
                      <div className="flex h-[128px] w-[128px] items-center justify-center text-[11px] text-slate-400">
                        Not configured
                      </div>
                    ) : (
                      <DoughnutChart available={avail} total={total} color={color} />
                    )}
                    <p className="max-w-full truncate text-center text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">
                      {lb.leaveType.name}
                    </p>
                    {pend > 0 && (
                      <span className="text-[10px] font-semibold text-amber-600">
                        {fmt(pend)} pending
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Leave History Table ── */}
          {applications.filter((a: any) => a.status !== "pending").length > 0 && (
            <div>
              <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-3">Leave History</h3>
              <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-slate-200 dark:border-white/[0.06]">{[...(view === "team" ? ["Employee"] : []), "Leave Type", "Date Range", "Days", "Reason", "Status"].map((h) => <th key={h} className="px-5 py-3 text-left text-[10px] uppercase tracking-wider text-slate-500 font-medium">{h}</th>)}</tr></thead>
                  <tbody>{applications.filter((a: any) => a.status !== "pending").map((app: any, i: number) => (
                    <tr key={app.id} className={`border-b border-slate-100 dark:border-white/[0.03] ${i % 2 === 0 ? "" : "bg-slate-50 dark:bg-white/[0.01]"}`}>
                      {view === "team" && <td className="px-5 py-3 text-[13px] text-slate-800 dark:text-white">{app.user?.name}</td>}
                      <td className="px-5 py-3"><span className="text-[12px] px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400">{app.leaveType.name}</span></td>
                      <td className="px-5 py-3 text-[13px] text-slate-600 dark:text-slate-300">{new Date(app.fromDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} — {new Date(app.toDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td className="px-5 py-3 text-[13px] text-slate-800 dark:text-white font-medium">{app.totalDays}</td>
                      <td className="px-5 py-3 text-[13px] text-slate-500 dark:text-slate-400 max-w-[200px] truncate">{app.reason}</td>
                      <td className="px-5 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${app.status === "approved" ? "bg-emerald-500/10 text-emerald-400" : app.status === "rejected" ? "bg-red-500/10 text-red-400" : "bg-slate-500/10 text-slate-500 dark:text-slate-400"}`}>{app.status}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Right Panel (Keka exact: action panel) ── */}
        <div className="col-span-3 border-l border-slate-200 dark:border-white/[0.06] p-5 space-y-4">
          <button onClick={() => setShowApply(true)} className="w-full h-10 border border-[#008CFF] text-[#008CFF] hover:bg-[#008CFF] hover:text-slate-800 dark:text-white rounded-lg text-[13px] font-semibold transition-all">
            Request Leave
          </button>
          <button onClick={() => setShowCompOff(true)} className="block text-[13px] text-[#008CFF] hover:underline text-left">Request Credit for Compensatory Off</button>
          <a href="/dashboard/hr/admin" className="block text-[13px] text-[#008CFF] hover:underline">Leave Policy Explanation</a>
          <a href="/dashboard/hr/leaves/comp-off-history" className="block text-[13px] text-[#008CFF] hover:underline">Compensatory Off Requests History</a>
        </div>
      </div>

      {/* ── Request Leave Slide Panel (Keka-style right side) ── */}
      {showApply && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setShowApply(false)} />
          {/* Filter to applicable types only — balance-only buckets still
              surface on the leave-balances grid but mustn't be selectable
              in the apply form. Restricted-admin types (adminOnly=true)
              are additionally hidden from anyone who isn't CEO / HR
              Manager / developer; the server enforces the same gate. */}
          {(() => {
            const me = session?.user as any;
            const canApplyRestricted = canApplyRestrictedLeave(me);
            const applyable = leaveTypes
              .filter((lt: any) => lt.applicable !== false)
              .filter((lt: any) => lt.adminOnly !== true || canApplyRestricted);
            return (
              <RequestLeavePanel
                leaveTypes={applyable}
                onClose={() => setShowApply(false)}
              />
            );
          })()}
        </>
      )}

      {showCompOff && (
        <CompOffModal onClose={() => setShowCompOff(false)} />
      )}
    </div>
  );
}

function CompOffModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ workedDate: "", creditDays: "1", reason: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    setErr("");
    if (!form.workedDate || !form.reason) return setErr("All fields required");
    setSaving(true);
    const res = await fetch("/api/hr/leaves/comp-off", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await res.json();
    if (!res.ok) { setErr(data.error || "Failed"); setSaving(false); return; }
    mutate((k: string) => typeof k === "string" && k.includes("/api/hr/leaves/comp-off"));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-[#f4f7f8] dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Request Compensatory Off</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:text-white text-xl">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{err}</p>}
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Date You Worked Extra *</label>
            <DateField value={form.workedDate} onChange={(v) => set("workedDate", v)} className="w-full" />
          </div>
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Credit Days</label>
            <SelectField
              value={form.creditDays}
              onChange={(v) => set("creditDays", v)}
              options={[
                { value: "0.5", label: "Half Day (0.5)" },
                { value: "1",   label: "Full Day (1.0)" },
              ]}
              className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white"
            />
          </div>
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Reason <span className="text-rose-500">*</span></label>
            <textarea value={form.reason} onChange={e => set("reason", e.target.value)} rows={3}
              placeholder="Describe the extra work done..."
              className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none resize-none" />
          </div>
          <p className="text-[11px] text-slate-400">Credits are valid for 3 months from worked date.</p>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
          <button onClick={onClose} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="h-9 px-5 bg-[#008CFF] hover:bg-[#0077dd] disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold">
            {saving ? "Submitting..." : "Submit Request"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequestLeavePanel({ leaveTypes, onClose }: { leaveTypes: any[]; onClose: () => void }) {
  const [form, setForm] = useState({ leaveTypeId: "", fromDate: "", toDate: "", reason: "" });
  // Full vs half day with which half. Markers below match the regexes in
  // /api/hr/attendance/board/route.ts so the home-page badge picks them up.
  const [dayKind, setDayKind] = useState<"full" | "first_half" | "second_half">("full");
  const isHalfLeave = dayKind !== "full";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // "Notify" picker — extra people the applicant wants CC'd on the
  // approval emails. Sent through as `notifyUserIds` so the leave
  // route layers them onto the L1/L2 approver notification list.
  const [notify, setNotify] = useState<PickerUser[]>([]);

  // Live leave balances so each leave-type option can advertise "X days
  // available". Self-heal endpoint guarantees one row per active type.
  const { data: balanceData = [] } = useSWR("/api/hr/leaves/balance", fetcher);
  const balanceByTypeId: Map<number, number> = (() => {
    const map = new Map<number, number>();
    for (const b of Array.isArray(balanceData) ? balanceData : []) {
      const total   = parseFloat(b.totalDays   ?? "0");
      const used    = parseFloat(b.usedDays    ?? "0");
      const pending = parseFloat(b.pendingDays ?? "0");
      if (b.leaveTypeId) map.set(b.leaveTypeId, Math.max(0, total - used - pending));
    }
    return map;
  })();

  // Working-day count — skip Sat/Sun, mirrors server-side countWorkingDays.
  const dayCount = (() => {
    if (isHalfLeave) return form.fromDate ? 0.5 : 0;
    if (!form.fromDate || !form.toDate) return 0;
    const a = new Date(`${form.fromDate}T00:00:00Z`);
    const b = new Date(`${form.toDate}T00:00:00Z`);
    if (isNaN(a.getTime()) || isNaN(b.getTime()) || a > b) return 0;
    let n = 0;
    const cur = new Date(a.getTime());
    while (cur.getTime() <= b.getTime()) {
      const dow = cur.getUTCDay();
      if (dow !== 0 && dow !== 6) n++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return n;
  })();

  const apply = async () => {
    setError("");
    if (!form.leaveTypeId || !form.fromDate || !form.toDate || !form.reason) return setError("All fields are required");
    setSaving(true);
    // Half-day pins toDate to fromDate and tags the reason; the api stays the same.
    const reason =
      dayKind === "first_half"  ? `[First Half] ${form.reason}`  :
      dayKind === "second_half" ? `[Second Half] ${form.reason}` :
                                  form.reason;
    const toDate = isHalfLeave ? form.fromDate : form.toDate;
    const res = await fetch("/api/hr/leaves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form, toDate, reason,
        leaveTypeId: parseInt(form.leaveTypeId),
        notifyUserIds: notify.map((u) => u.id),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    mutate((key: string) => typeof key === "string" && key.includes("/api/hr/leaves"));
    onClose();
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[420px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]">
        <h2 className="text-[16px] font-bold text-slate-800 dark:text-white tracking-tight">Request Leave</h2>
        <button
          onClick={onClose}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {error && (
          <p className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/20">
            {error}
          </p>
        )}

        {/* ── Date range ──────────────────────────────────────────
            Symmetric flex layout: From / centered days-pill / To.
            Equal column widths so the dates line up under their
            labels and the pill sits exactly between them. */}
        <Section title="Date range">
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <FieldLabel>From</FieldLabel>
              <DateField
                value={form.fromDate}
                onChange={(v) => setForm((p) => ({
                  ...p,
                  fromDate: v,
                  toDate: isHalfLeave ? v : (!p.toDate || new Date(v) > new Date(p.toDate) ? v : p.toDate),
                }))}
                className="w-full"
              />
            </div>
            <div className="self-center pb-[2px]">
              <span className="inline-flex items-center justify-center h-7 px-3 rounded-full bg-slate-100 dark:bg-white/5 text-[11.5px] font-semibold text-slate-700 dark:text-white tabular-nums whitespace-nowrap">
                {dayCount} day{dayCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <FieldLabel>To</FieldLabel>
              <DateField
                value={isHalfLeave ? form.fromDate : form.toDate}
                disabled={isHalfLeave}
                onChange={(v) => setForm((p) => ({ ...p, toDate: v }))}
                className="w-full"
              />
            </div>
          </div>
        </Section>

        {/* ── Duration ────────────────────────────────────────────
            Full / Half are siblings in a 2-col grid (equal height).
            First/Second Half sub-buttons surface on a NEW row below
            so the parent toggles stay perfectly aligned. */}
        <Section title="Duration">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDayKind("full")}
              className={`h-10 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                dayKind === "full"
                  ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF] dark:border-[#4a9cff] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff]"
                  : "border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1e3a] text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
              }`}
            >
              Full Day
            </button>
            <button
              type="button"
              onClick={() => {
                setForm((p) => ({ ...p, toDate: p.fromDate }));
                setDayKind((d) => (d === "full" ? "first_half" : d));
              }}
              className={`h-10 rounded-lg border text-[12.5px] font-semibold transition-colors ${
                isHalfLeave
                  ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF] dark:border-[#4a9cff] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff]"
                  : "border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1e3a] text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
              }`}
            >
              Half Day
            </button>
          </div>
          {isHalfLeave && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDayKind("first_half")}
                className={`h-9 rounded-md border text-[11.5px] font-medium transition-colors ${
                  dayKind === "first_half"
                    ? "border-[#008CFF] bg-[#008CFF]/[0.06] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                    : "border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1e3a] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                }`}
              >
                First Half
              </button>
              <button
                type="button"
                onClick={() => setDayKind("second_half")}
                className={`h-9 rounded-md border text-[11.5px] font-medium transition-colors ${
                  dayKind === "second_half"
                    ? "border-[#008CFF] bg-[#008CFF]/[0.06] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                    : "border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1e3a] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                }`}
              >
                Second Half
              </button>
            </div>
          )}
        </Section>

        {/* ── Leave type ──────────────────────────────────────────
            Radio-style cards with an availability dot on the left
            (emerald = days available, slate = none / balance-only).
            Selected card lights up in the brand blue. */}
        <Section title="Leave type">
          <div className="space-y-1.5">
            {leaveTypes.map((lt: any) => {
              const avail = balanceByTypeId.get(lt.id);
              const hasBalance = avail != null && avail > 0;
              const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);
              const selected = String(form.leaveTypeId) === String(lt.id);
              return (
                <button
                  key={lt.id}
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, leaveTypeId: String(lt.id) }))}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "border-[#008CFF] bg-[#008CFF]/[0.08] dark:border-[#4a9cff] dark:bg-[#4a9cff]/[0.1]"
                      : "border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#0a1e3a] hover:border-[#008CFF]/40"
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        selected ? "bg-[#008CFF]" : hasBalance ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                      }`}
                    />
                    <span className={`text-[13px] font-medium truncate ${selected ? "text-[#008CFF] dark:text-[#4a9cff]" : "text-slate-800 dark:text-white"}`}>
                      {lt.name}
                    </span>
                  </span>
                  <span className={`text-[11.5px] tabular-nums shrink-0 ${hasBalance ? "text-emerald-700 dark:text-emerald-400 font-semibold" : "text-slate-400 dark:text-slate-500"}`}>
                    {avail == null
                      ? "Not Available"
                      : avail > 0
                        ? `${fmt(avail)} day${avail === 1 ? "" : "s"} available`
                        : "Not Available"}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ── Reason (required) ──────────────────────────────────── */}
        <Section title="Reason" required>
          <textarea
            value={form.reason}
            onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
            placeholder="Why are you applying for this leave?"
            rows={4}
            required
            aria-required="true"
            className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] focus:ring-2 focus:ring-[#008CFF]/15 resize-none transition-colors"
          />
        </Section>

        {/* ── Notify (chip-style picker → notifyUserIds) ─────────── */}
        <Section title="Notify">
          <EmployeePicker selected={notify} onChange={setNotify} />
          <p className="mt-1.5 text-[10.5px] text-slate-500 dark:text-slate-400">
            These people will be CC'd on the approval email.
          </p>
        </Section>
      </div>

      <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
        <button onClick={onClose} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg hover:bg-slate-100 dark:bg-white/5">Cancel</button>
        <button onClick={apply} disabled={saving} className="h-9 px-5 bg-[#008CFF] hover:bg-[#0077dd] disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold">
          {saving ? "Requesting…" : "Request"}
        </button>
      </div>
    </div>
  );
}

/* ── Layout helpers (Request Leave panel only) ─────────────────────────
   Single source of truth for section headers + field labels so spacing,
   font weight, and tracking stay consistent across the form. Moving the
   markup into helpers shaved ~40 lines off the panel and makes the
   visual rhythm obvious at a glance.
*/

function Section({ title, required, children }: { title: string; required?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 mb-2">
        {title}
        {required ? <span className="text-rose-500 ml-1">*</span> : null}
      </h3>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block mb-1">
      {children}
    </span>
  );
}
