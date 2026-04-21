"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { Settings, Calendar, Clock, Users, Plus, Pencil, X, CheckCircle2, AlertCircle, ToggleLeft, ToggleRight, Palmtree, Trash2, LayoutDashboard, CalendarDays, Package } from "lucide-react";
import AttendanceDashboardPanel from "@/components/hr/AttendanceDashboardPanel";
import AssetsPanel from "@/components/hr/AssetsPanel";

// Every HR-admin section is an inline state tab — no sub-routes.
type AdminTabDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
};
const ADMIN_TABS: AdminTabDef[] = [
  { key: "attendance-dashboard", label: "Attendance Dashboard", icon: LayoutDashboard },
  { key: "holidays",             label: "Holidays & Calendar",  icon: CalendarDays    },
  { key: "assets",               label: "Assets",               icon: Package         },
  { key: "leave-types",          label: "Leave Types",          icon: Calendar        },
  { key: "shifts",               label: "Shift Templates",      icon: Clock           },
  { key: "departments",          label: "Departments",          icon: Users           },
];

const DAYS_LABEL = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function HRAdminPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper || user?.orgLevel === "hr_manager";

  const [tab, setTab] = useState("attendance-dashboard");

  const { data: leaveTypes = [] } = useSWR("/api/hr/admin/leave-types", fetcher);
  const { data: shifts = [] }     = useSWR("/api/hr/admin/shifts", fetcher);
  const { data: employees = [] }  = useSWR("/api/hr/employees", fetcher);
  const { data: holidays = [] }   = useSWR("/api/hr/admin/holidays", fetcher);

  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [holidayForm, setHolidayForm] = useState({ name: "", date: "", isOptional: false });

  const saveHoliday = async () => {
    const res = await fetch("/api/hr/admin/holidays", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(holidayForm),
    });
    if (res.ok) { setShowHolidayForm(false); setHolidayForm({ name: "", date: "", isOptional: false }); mutate("/api/hr/admin/holidays"); }
    else alert((await res.json()).error);
  };

  const deleteHoliday = async (id: number) => {
    await fetch(`/api/hr/admin/holidays?id=${id}`, { method: "DELETE" });
    mutate("/api/hr/admin/holidays");
  };

  // Leave type form
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [editLeave, setEditLeave] = useState<any>(null);
  const [leaveForm, setLeaveForm] = useState({ name: "", description: "", daysPerYear: "12", isPaid: true, carryForward: false, maxCarryForward: "" });

  // Shift form
  const [showShiftForm, setShowShiftForm] = useState(false);
  const [editShift, setEditShift] = useState<any>(null);
  const [shiftForm, setShiftForm] = useState({ name: "", startTime: "09:00", endTime: "18:00", gracePeriodMinutes: "15", workingDays: [1,2,3,4,5] });

  const openLeaveEdit = (lt: any) => {
    setEditLeave(lt);
    setLeaveForm({ name: lt.name, description: lt.description || "", daysPerYear: String(lt.daysPerYear), isPaid: lt.isPaid, carryForward: lt.carryForward, maxCarryForward: lt.maxCarryForward ? String(lt.maxCarryForward) : "" });
    setShowLeaveForm(true);
  };

  const openShiftEdit = (s: any) => {
    setEditShift(s);
    setShiftForm({ name: s.name, startTime: s.startTime, endTime: s.endTime, gracePeriodMinutes: String(s.gracePeriodMinutes), workingDays: s.workingDays });
    setShowShiftForm(true);
  };

  const saveLeave = async () => {
    const method = editLeave ? "PUT" : "POST";
    const body = editLeave ? { ...leaveForm, id: editLeave.id } : leaveForm;
    const res = await fetch("/api/hr/admin/leave-types", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { setShowLeaveForm(false); setEditLeave(null); mutate("/api/hr/admin/leave-types"); }
    else alert((await res.json()).error);
  };

  const saveShift = async () => {
    const method = editShift ? "PUT" : "POST";
    const body = editShift ? { ...shiftForm, id: editShift.id } : shiftForm;
    const res = await fetch("/api/hr/admin/shifts", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { setShowShiftForm(false); setEditShift(null); mutate("/api/hr/admin/shifts"); }
    else alert((await res.json()).error);
  };

  const toggleDay = (d: number) => {
    setShiftForm(f => ({
      ...f,
      workingDays: f.workingDays.includes(d) ? f.workingDays.filter(x => x !== d) : [...f.workingDays, d].sort(),
    }));
  };

  // Dept breakdown from employees
  const deptMap: Record<string, number> = {};
  employees.forEach((e: any) => {
    const d = e.employeeProfile?.department || "Unassigned";
    deptMap[d] = (deptMap[d] || 0) + 1;
  });
  const depts = Object.entries(deptMap).sort((a, b) => b[1] - a[1]);

  if (!isAdmin) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <AlertCircle className="w-10 h-10 text-slate-400 mx-auto mb-2" />
        <p className="text-[14px] font-semibold text-slate-600 dark:text-slate-300">Admin access required</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Header */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6 py-4">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-[#008CFF]" />
          <div>
            <h1 className="text-[15px] font-bold text-slate-800 dark:text-white">HR Dashboard</h1>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">Attendance, holidays, assets, leave types, shifts & org structure</p>
          </div>
        </div>
      </div>

      <div className="flex gap-0 h-full">

        {/* Sidebar tabs — every section is an in-page state tab. */}
        <div className="w-[240px] shrink-0 p-4 space-y-1 border-r border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/40">
          {ADMIN_TABS.map((t) => {
            const active = tab === t.key;
            const base = `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left ${
              active
                ? "bg-[#008CFF]/10 text-[#008CFF]"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            }`;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={base}>
                <t.icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 space-y-4">

          {/* ── Attendance Dashboard ── */}
          {tab === "attendance-dashboard" && <AttendanceDashboardPanel />}

          {/* ── Assets ── */}
          {tab === "assets" && <AssetsPanel />}

          {/* ── Leave Types ── */}
          {tab === "leave-types" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Leave Types</h2>
                <button onClick={() => { setEditLeave(null); setLeaveForm({ name:"",description:"",daysPerYear:"12",isPaid:true,carryForward:false,maxCarryForward:"" }); setShowLeaveForm(true); }}
                  className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">
                  <Plus className="w-3.5 h-3.5" />Add Leave Type
                </button>
              </div>
              <div className="space-y-2">
                {leaveTypes.map((lt: any) => (
                  <div key={lt.id} className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-10 rounded-full ${lt.isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-white/20"}`} />
                      <div>
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{lt.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {lt.daysPerYear} days/year
                          {lt.isPaid ? " · Paid" : " · Unpaid"}
                          {lt.carryForward ? ` · Carry forward${lt.maxCarryForward ? ` (max ${lt.maxCarryForward})` : ""}` : ""}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => openLeaveEdit(lt)}
                      className="flex items-center gap-1 h-7 px-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-medium">
                      <Pencil className="w-3 h-3" />Edit
                    </button>
                  </div>
                ))}
                {leaveTypes.length === 0 && (
                  <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-8 text-center">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400">No leave types configured yet</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Shift Templates ── */}
          {tab === "shifts" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Shift Templates</h2>
                <button onClick={() => { setEditShift(null); setShiftForm({ name:"",startTime:"09:00",endTime:"18:00",gracePeriodMinutes:"15",workingDays:[1,2,3,4,5] }); setShowShiftForm(true); }}
                  className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">
                  <Plus className="w-3.5 h-3.5" />Add Shift
                </button>
              </div>
              <div className="space-y-2">
                {shifts.map((s: any) => (
                  <div key={s.id} className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-10 rounded-full ${s.isActive ? "bg-[#008CFF]" : "bg-slate-300 dark:bg-white/20"}`} />
                      <div>
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-white">{s.name}</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {s.startTime} – {s.endTime}
                          {" · "}Grace: {s.gracePeriodMinutes}min
                          {" · "}{(s.workingDays as number[]).map(d => DAYS_LABEL[d]).join(", ")}
                        </p>
                      </div>
                    </div>
                    <button onClick={() => openShiftEdit(s)}
                      className="flex items-center gap-1 h-7 px-3 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-slate-300 rounded-lg text-[11px] font-medium">
                      <Pencil className="w-3 h-3" />Edit
                    </button>
                  </div>
                ))}
                {shifts.length === 0 && (
                  <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-8 text-center">
                    <p className="text-[13px] text-slate-500 dark:text-slate-400">No shift templates configured yet</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Departments ── */}
          {tab === "departments" && (
            <>
              <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Department Breakdown</h2>
              <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-white/[0.04]">
                      <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Department</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Headcount</th>
                      <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Distribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depts.map(([dept, count]) => {
                      const pct = employees.length > 0 ? (count / employees.length) * 100 : 0;
                      return (
                        <tr key={dept} className="border-b border-slate-50 dark:border-white/[0.03]">
                          <td className="px-5 py-3 text-[13px] font-medium text-slate-800 dark:text-white">{dept}</td>
                          <td className="px-5 py-3 text-[13px] text-slate-600 dark:text-slate-300">{count}</td>
                          <td className="px-5 py-3 w-64">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-[#008CFF] rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 w-8 text-right">{pct.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {/* ── Holidays ── */}
          {tab === "holidays" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-bold text-slate-800 dark:text-white">Company Holidays</h2>
                <button onClick={() => { setHolidayForm({ name:"", date: new Date().toISOString().slice(0,10), isOptional: false }); setShowHolidayForm(true); }}
                  className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold">
                  <Plus className="w-3.5 h-3.5" />Add Holiday
                </button>
              </div>
              <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-white/[0.04]">
                      {["DATE","HOLIDAY NAME","TYPE",""].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[9px] uppercase tracking-widest text-[#008CFF] font-bold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(holidays as any[]).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()).map((h: any) => (
                      <tr key={h.id} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-slate-50/50 dark:hover:bg-white/[0.015]">
                        <td className="px-5 py-3 text-[12px] text-slate-600 dark:text-slate-400 font-medium">
                          {new Date(h.date).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-5 py-3 text-[13px] font-semibold text-slate-800 dark:text-white">{h.name}</td>
                        <td className="px-5 py-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${h.isOptional ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}>
                            {h.isOptional ? "Optional" : "Mandatory"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => deleteHoliday(h.id)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/10 text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 mx-auto">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {holidays.length === 0 && (
                  <div className="py-12 text-center">
                    <Palmtree className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <p className="text-[13px] text-slate-400">No holidays added yet</p>
                  </div>
                )}
              </div>
            </>
          )}

        </div>
      </div>

      {/* Modal: Leave Type */}
      {showLeaveForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[440px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{editLeave ? "Edit" : "Add"} Leave Type</h3>
              <button onClick={() => setShowLeaveForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              {[{ field: "name", label: "Name", placeholder: "e.g. Annual Leave" }, { field: "description", label: "Description", placeholder: "" }].map(({ field, label, placeholder }) => (
                <div key={field}>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</label>
                  <input value={(leaveForm as any)[field]} onChange={e => setLeaveForm(f => ({ ...f, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
                </div>
              ))}
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Days Per Year</label>
                <input type="number" value={leaveForm.daysPerYear} onChange={e => setLeaveForm(f => ({ ...f, daysPerYear: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
              </div>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={leaveForm.isPaid} onChange={e => setLeaveForm(f => ({ ...f, isPaid: e.target.checked }))} className="w-4 h-4" />
                  Paid Leave
                </label>
                <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={leaveForm.carryForward} onChange={e => setLeaveForm(f => ({ ...f, carryForward: e.target.checked }))} className="w-4 h-4" />
                  Carry Forward
                </label>
              </div>
              {leaveForm.carryForward && (
                <div>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Max Carry Forward Days</label>
                  <input type="number" value={leaveForm.maxCarryForward} onChange={e => setLeaveForm(f => ({ ...f, maxCarryForward: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowLeaveForm(false)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={saveLeave}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Holiday */}
      {showHolidayForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Add Holiday</h3>
              <button onClick={() => setShowHolidayForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Holiday Name *</label>
                <input value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Republic Day"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Date *</label>
                <input type="date" value={holidayForm.date} onChange={e => setHolidayForm(f => ({ ...f, date: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white focus:outline-none" />
              </div>
              <label className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={holidayForm.isOptional} onChange={e => setHolidayForm(f => ({ ...f, isOptional: e.target.checked }))} className="w-4 h-4 accent-[#008CFF]" />
                Optional holiday (employees can choose)
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowHolidayForm(false)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={saveHoliday} disabled={!holidayForm.name || !holidayForm.date}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Shift */}
      {showShiftForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[440px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">{editShift ? "Edit" : "Add"} Shift</h3>
              <button onClick={() => setShowShiftForm(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Shift Name</label>
                <input value={shiftForm.name} onChange={e => setShiftForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. General Shift"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[{ field: "startTime", label: "Start Time" }, { field: "endTime", label: "End Time" }].map(({ field, label }) => (
                  <div key={field}>
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</label>
                    <input type="time" value={(shiftForm as any)[field]} onChange={e => setShiftForm(f => ({ ...f, [field]: e.target.value }))}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Grace Period (minutes)</label>
                <input type="number" value={shiftForm.gracePeriodMinutes} onChange={e => setShiftForm(f => ({ ...f, gracePeriodMinutes: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-[13px] text-slate-800 dark:text-white" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2 block">Working Days</label>
                <div className="flex gap-2">
                  {DAYS_LABEL.map((d, i) => (
                    <button key={i} onClick={() => toggleDay(i)}
                      className={`w-9 h-9 rounded-full text-[11px] font-bold transition-colors ${
                        shiftForm.workingDays.includes(i)
                          ? "bg-[#008CFF] text-white"
                          : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400"
                      }`}>{d}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowShiftForm(false)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={saveShift}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
