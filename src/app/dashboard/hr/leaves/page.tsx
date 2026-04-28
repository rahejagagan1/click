"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";

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
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper || user?.orgLevel === "hr_manager";
  const [view, setView] = useState<"my" | "team">("my");
  const [showApply, setShowApply] = useState(false);
  const [showCompOff, setShowCompOff] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);

  const { data: balances = [] } = useSWR("/api/hr/leaves/balance", fetcher);
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
                    <div className="min-w-[140px]"><span className="text-[10px] text-slate-500 uppercase tracking-wider block">Past Leave</span><span className="text-[13px] text-slate-800 dark:text-white">{new Date(app.fromDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ({app.totalDays} day{app.totalDays > 1 ? "s" : ""})</span></div>
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

          {/* ── Leave Balances (Keka exact: 4 cards per row with doughnut) ── */}
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-3">Leave Balances</h3>
            <div className="grid grid-cols-4 gap-4">
              {balances.map((lb: any, i: number) => {
                const total = parseFloat(lb.totalDays), used = parseFloat(lb.usedDays), pend = parseFloat(lb.pendingDays), avail = total - used - pend;
                return (
                  <div key={lb.id} className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-[13px] font-semibold text-slate-800 dark:text-white">{lb.leaveType.name}</h4>
                      <span className="text-[12px] text-[#008CFF] cursor-pointer hover:underline">View details</span>
                    </div>
                    <div className="flex justify-center mb-4 flex-1">
                      {total > 0 ? <DoughnutChart available={avail} total={total} color={balanceColors[i % balanceColors.length]} /> : <p className="text-[12px] text-slate-500 py-8 self-center">No data to display.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 border-t border-white/[0.04]">
                      <div><span className="text-[10px] text-slate-500 block uppercase tracking-wider">Available</span><span className="text-[13px] text-slate-800 dark:text-white font-medium">{avail} day{avail !== 1 ? "s" : ""}</span></div>
                      <div><span className="text-[10px] text-slate-500 block uppercase tracking-wider">Consumed</span><span className="text-[13px] text-slate-800 dark:text-white font-medium">{used} day{used !== 1 ? "s" : ""}</span></div>
                      <div className="col-span-2"><span className="text-[10px] text-slate-500 block uppercase tracking-wider">Annual Quota</span><span className="text-[13px] text-slate-800 dark:text-white font-medium">{total} day{total !== 1 ? "s" : ""}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Leave History Table ── */}
          {applications.filter((a: any) => a.status !== "pending").length > 0 && (
            <div>
              <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white mb-3">Leave History</h3>
              <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
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
          <RequestLeavePanel leaveTypes={leaveTypes} onClose={() => setShowApply(false)} />
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
            <input type="date" value={form.workedDate} onChange={e => set("workedDate", e.target.value)}
              className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]/40" />
          </div>
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Credit Days</label>
            <select value={form.creditDays} onChange={e => set("creditDays", e.target.value)}
              className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none">
              <option value="0.5">Half Day (0.5)</option>
              <option value="1">Full Day (1.0)</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Reason *</label>
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

  const dayCount = isHalfLeave
    ? (form.fromDate ? 0.5 : 0)
    : (form.fromDate && form.toDate ? Math.max(0, Math.ceil((new Date(form.toDate).getTime() - new Date(form.fromDate).getTime()) / 86400000) + 1) : 0);

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
      body: JSON.stringify({ ...form, toDate, reason, leaveTypeId: parseInt(form.leaveTypeId) }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error); setSaving(false); return; }
    mutate((key: string) => typeof key === "string" && key.includes("/api/hr/leaves"));
    onClose();
  };

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[400px] bg-[#f4f7f8] dark:bg-[#001529] border-l border-slate-200 dark:border-white/[0.08] shadow-2xl z-50 flex flex-col animate-slide-in">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
        <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white">Request Leave</h2>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-800 dark:text-white text-xl">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {error && <p className="text-[12px] text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

        {/* Date Range */}
        <div className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-xl p-4">
          <div className="grid grid-cols-3 gap-0">
            <div>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1">From</span>
              <input type="date" value={form.fromDate}
                onChange={(e) => setForm((p) => ({
                  ...p,
                  fromDate: e.target.value,
                  // Half-day must stay on a single date; keep To pinned to From.
                  toDate: isHalfLeave ? e.target.value : (!p.toDate || new Date(e.target.value) > new Date(p.toDate) ? e.target.value : p.toDate),
                }))}
                className="w-full bg-transparent text-[13px] text-[#008CFF] focus:outline-none cursor-pointer" />
            </div>
            <div className="text-center flex items-center justify-center">
              <span className="text-[14px] font-bold text-slate-800 dark:text-white bg-slate-100 dark:bg-white/5 px-3 py-1 rounded">{dayCount} day{dayCount === 1 ? "" : "s"}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block mb-1 text-right">To</span>
              <input type="date"
                value={isHalfLeave ? form.fromDate : form.toDate}
                disabled={isHalfLeave}
                onChange={(e) => setForm((p) => ({ ...p, toDate: e.target.value }))}
                className="w-full bg-transparent text-[13px] text-[#008CFF] focus:outline-none text-right cursor-pointer disabled:text-slate-400 disabled:cursor-not-allowed" />
            </div>
          </div>
        </div>

        {/* Full vs Half day toggle. First/Second Half nests under Half Day so
            the sub-choice is visually scoped to that side. Markers in the
            reason field drive the half-circle badge on the home-page board. */}
        <div className="grid grid-cols-2 gap-2 items-start">
          <button
            type="button"
            onClick={() => setDayKind("full")}
            className={`h-9 rounded-lg border text-[12.5px] font-semibold transition-colors ${
              dayKind === "full"
                ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF] dark:border-[#4a9cff] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff]"
                : "border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
            }`}
          >
            Full Day
          </button>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                // Collapse the range to a single date when switching to half-day.
                setForm((p) => ({ ...p, toDate: p.fromDate }));
                setDayKind((d) => (d === "full" ? "first_half" : d));
              }}
              className={`h-9 w-full rounded-lg border text-[12.5px] font-semibold transition-colors ${
                isHalfLeave
                  ? "border-[#008CFF] bg-[#008CFF]/10 text-[#008CFF] dark:border-[#4a9cff] dark:bg-[#4a9cff]/15 dark:text-[#4a9cff]"
                  : "border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-slate-300 hover:border-[#008CFF]/40"
              }`}
            >
              Half Day
            </button>

            {isHalfLeave && (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setDayKind("first_half")}
                  className={`h-8 rounded-md border text-[11.5px] font-medium transition-colors ${
                    dayKind === "first_half"
                      ? "border-[#008CFF] bg-[#008CFF]/[0.06] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                      : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                  }`}
                >
                  First Half
                </button>
                <button
                  type="button"
                  onClick={() => setDayKind("second_half")}
                  className={`h-8 rounded-md border text-[11.5px] font-medium transition-colors ${
                    dayKind === "second_half"
                      ? "border-[#008CFF] bg-[#008CFF]/[0.06] text-[#008CFF] dark:border-[#4a9cff] dark:text-[#4a9cff]"
                      : "border-slate-200 dark:border-white/[0.08] text-slate-500 dark:text-slate-400 hover:border-[#008CFF]/40"
                  }`}
                >
                  Second Half
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Leave Type */}
        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Select type of leave you want to apply</label>
          <select value={form.leaveTypeId} onChange={(e) => setForm((p) => ({ ...p, leaveTypeId: e.target.value }))} className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]/40">
            <option value="">Select</option>
            {leaveTypes.map((lt: any) => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
          </select>
        </div>

        {/* Note */}
        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Note</label>
          <textarea value={form.reason} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))} placeholder="Type here" rows={4} className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none focus:border-[#008CFF]/40 resize-none" />
        </div>

        {/* Notify */}
        <div>
          <label className="text-[12px] text-slate-500 dark:text-slate-400 font-medium mb-2 block">Notify</label>
          <input placeholder="Search employee" className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none focus:border-[#008CFF]/40" />
        </div>
      </div>

      <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.06] flex justify-end gap-3">
        <button onClick={onClose} className="h-9 px-5 text-[13px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white rounded-lg hover:bg-slate-100 dark:bg-white/5">Cancel</button>
        <button onClick={apply} disabled={saving} className="h-9 px-5 bg-[#008CFF] hover:bg-[#0077dd] disabled:opacity-40 text-slate-800 dark:text-white rounded-lg text-[13px] font-semibold">
          {saving ? "Requesting..." : "Request"}
        </button>
      </div>
    </div>
  );
}
