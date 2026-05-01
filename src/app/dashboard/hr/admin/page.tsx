"use client";
import { useState, useEffect } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { Settings, Calendar, Clock, Users, Plus, Pencil, X, CheckCircle2, AlertCircle, ToggleLeft, ToggleRight, Palmtree, Trash2, LayoutDashboard, CalendarDays, Package, CheckSquare, UserPlus, ShieldCheck, Briefcase, UserMinus, BarChart3 } from "lucide-react";
import AttendanceDashboardPanel from "@/components/hr/AttendanceDashboardPanel";
import AssetsPanel from "@/components/hr/AssetsPanel";
import ApprovalsPanel from "@/components/hr/ApprovalsPanel";
import LeavesAdminPanel from "@/components/hr/LeavesAdminPanel";
import {
  isHRAdmin,
  isFullHRAdmin,
  HR_MANAGER_ALLOWED_TABS,
  HR_MANAGER_ALLOWED_RAIL_LINKS,
} from "@/lib/access";

// Every HR-admin section is an inline state tab — no sub-routes.
type AdminTabDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
};
// Each sub-tab also carries the TabKey it's gated by in the central
// permissions catalog. Tab Permissions UI flipping any of these to
// false hides that section from the user.
const ADMIN_TABS: Array<AdminTabDef & { permKey: string }> = [
  { key: "attendance-dashboard", label: "Attendance Dashboard", icon: LayoutDashboard, permKey: "hr_admin_attendance"     },
  { key: "approvals",            label: "Approvals",            icon: CheckSquare,     permKey: "hr_admin_approvals"      },
  { key: "leaves",               label: "Leave Balances",       icon: Calendar,        permKey: "hr_admin_leaves"         },
  { key: "holidays",             label: "Holidays & Calendar",  icon: CalendarDays,    permKey: "hr_admin_holidays"       },
  { key: "assets",               label: "Assets",               icon: Package,         permKey: "hr_admin_assets"         },
  { key: "leave-types",          label: "Leave Types",          icon: Calendar,        permKey: "hr_admin_leave_types"    },
  { key: "shifts",               label: "Shift Templates",      icon: Clock,           permKey: "hr_admin_shifts"         },
  { key: "departments",          label: "Departments",          icon: Users,           permKey: "hr_admin_departments"    },
];

const DAYS_LABEL = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function HRAdminPage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  // Includes ceo / developer / special_access / role=admin / hr_manager —
  // all of whom should see the HR Dashboard. Full admins see every tab;
  // hr_manager-only users see a curated subset.
  const isAdmin = isHRAdmin(user);
  const isFullAdmin = isFullHRAdmin(user);

  // Pull the viewer's effective tab permissions so the rail links honour
  // explicit grants/revokes from the Permissions UI (not just role-based
  // defaults). Lets an admin grant `hr_hiring: true` to a Coordinator
  // and have them see the Hiring rail link without making them an admin.
  const { data: perms } = useSWR<{ permissions: Record<string, boolean> }>(
    "/api/hr/me/tab-permissions",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );
  const tabAllowed = (key: string) => (perms?.permissions?.[key] ?? true);

  // Filter tabs by tier first, then by per-user permission so admins
  // can grant / revoke individual sub-tabs through Tab Permissions UI.
  // tabAllowed() defaults to true when no explicit row exists — so
  // existing users keep seeing every tab they're entitled to until
  // someone flips the toggle.
  const tierTabs = isFullAdmin
    ? ADMIN_TABS
    : ADMIN_TABS.filter((t) => HR_MANAGER_ALLOWED_TABS.has(t.key));
  const visibleTabs = tierTabs.filter((t) => tabAllowed(t.permKey));
  // Rail links: full admins always see them; hr_manager-tier sees them
  // when both the curated whitelist allows it AND their tab permission
  // is on. Other roles see them only if Tab Permissions explicitly grants.
  const showOnboardRail   = isFullAdmin
    || (HR_MANAGER_ALLOWED_RAIL_LINKS.has("onboard")  && tabAllowed("hr_people"));
  const showOffboardRail  = isFullAdmin
    || (HR_MANAGER_ALLOWED_RAIL_LINKS.has("offboard") && tabAllowed("hr_offboard"));
  const showHiringRail    = isFullAdmin
    || (HR_MANAGER_ALLOWED_RAIL_LINKS.has("hiring")   && tabAllowed("hr_hiring"));
  const showTabPermsRail  = isFullAdmin; // policy config — admin-only
  const showManageKpisRail = isFullAdmin; // KPI uploads — admin-only

  const [tab, setTab] = useState("attendance-dashboard");

  // If the current tab isn't visible (because tier-curation OR a
  // per-user revoke removed it), snap to the first visible tab. We
  // can't always pick attendance-dashboard since admins might revoke
  // even that one for a specific user.
  useEffect(() => {
    if (visibleTabs.length === 0) return;
    if (!visibleTabs.some((t) => t.key === tab)) {
      setTab(visibleTabs[0].key);
    }
  }, [visibleTabs, tab]);

  const { data: leaveTypes = [] } = useSWR("/api/hr/admin/leave-types", fetcher);
  const { data: shifts = [] }     = useSWR("/api/hr/admin/shifts", fetcher);
  const { data: employees = [] }  = useSWR("/api/hr/employees", fetcher);
  const { data: holidays = [] }   = useSWR("/api/hr/admin/holidays", fetcher);
  // Pending approvals count — feeds the badge on the "Approvals" rail item.
  const { data: approvalsSummary } = useSWR<{ byTab: Record<string, number>; total: number }>(
    "/api/hr/approvals/summary",
    fetcher,
    { refreshInterval: 60_000 }
  );
  const approvalsTotal = approvalsSummary?.total ?? 0;

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

  // Dept breakdown from employees — group full employee records by
  // department so the breakdown row can show team avatars instead of
  // a percentage bar. Sort departments by team size, biggest first.
  const deptEmployees: Record<string, any[]> = {};
  employees.forEach((e: any) => {
    const d = e.employeeProfile?.department || "Unassigned";
    if (!deptEmployees[d]) deptEmployees[d] = [];
    deptEmployees[d].push(e);
  });
  const depts = Object.entries(deptEmployees).sort((a, b) => b[1].length - a[1].length);

  // Manager breakdown — anyone with orgLevel manager / hod / hr_manager
  // counts as a manager. We then attach their direct reports (users
  // whose User.managerId points at them) so the panel can show the
  // team alongside the manager.
  const isManagerRole = (u: any) =>
    u?.orgLevel === "manager" || u?.orgLevel === "hod" || u?.orgLevel === "hr_manager";
  const managers = employees.filter(isManagerRole);
  const reportsByManagerId: Record<number, any[]> = {};
  employees.forEach((e: any) => {
    if (e.managerId) {
      if (!reportsByManagerId[e.managerId]) reportsByManagerId[e.managerId] = [];
      reportsByManagerId[e.managerId].push(e);
    }
  });
  const managersGrouped: Array<{ manager: any; reports: any[] }> = managers
    .map((m: any) => ({ manager: m, reports: reportsByManagerId[m.id] ?? [] }))
    .sort((a: { reports: any[] }, b: { reports: any[] }) => b.reports.length - a.reports.length);

  // Sub-tab inside Departments: "By Department" vs "By Manager".
  const [deptView, setDeptView] = useState<"dept" | "manager">("dept");

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
          {visibleTabs.map((t) => {
            const active = tab === t.key;
            const base = `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left ${
              active
                ? "bg-[#008CFF]/10 text-[#008CFF]"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            }`;
            // Only the Approvals item carries a count badge (for now).
            const badge = t.key === "approvals" && approvalsTotal > 0 ? approvalsTotal : null;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className={base}>
                <t.icon className="w-4 h-4" />
                <span className="flex-1">{t.label}</span>
                {badge !== null && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold tabular-nums leading-none ${
                    active ? "bg-[#008CFF] text-white" : "bg-[#008CFF]/15 text-[#008CFF]"
                  }`}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* ── Rail links — full-page destinations, not inline tabs.
                Each one is conditionally rendered based on tier. */}
          <div className="pt-2 mt-2 border-t border-slate-200 dark:border-white/[0.06]" />
          {showOnboardRail && (
            <Link
              href="/dashboard/hr/onboard"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
            >
              <UserPlus className="w-4 h-4" />
              <span className="flex-1">Onboard Employee</span>
              <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          {showTabPermsRail && (
            <Link
              href="/dashboard/hr/admin/permissions"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
            >
              <ShieldCheck className="w-4 h-4" />
              <span className="flex-1">Tab Permissions</span>
              <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          {showManageKpisRail && (
            <Link
              href="/dashboard/kpis/manage"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
            >
              <BarChart3 className="w-4 h-4" />
              <span className="flex-1">Manage KPIs</span>
              <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          {showHiringRail && (
            <Link
              href="/dashboard/hr/hiring"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
            >
              <Briefcase className="w-4 h-4" />
              <span className="flex-1">Hiring</span>
              <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          {showOffboardRail && (
            <Link
              href="/dashboard/hr/offboard"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors text-left text-slate-600 dark:text-slate-400 hover:bg-[#008CFF]/10 hover:text-[#008CFF]"
            >
              <UserMinus className="w-4 h-4" />
              <span className="flex-1">Offboard Employee</span>
              <svg className="w-3.5 h-3.5 opacity-40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 p-6 space-y-4">

          {/* ── Attendance Dashboard ── */}
          {tab === "attendance-dashboard" && <AttendanceDashboardPanel />}

          {/* ── Approvals — full multi-tab panel (Leave / Comp Offs / WFH / …) ── */}
          {tab === "approvals" && <ApprovalsPanel embedded />}

          {/* ── Leaves — admin can edit / cancel / delete any leave ── */}
          {tab === "leaves" && <LeavesAdminPanel leaveTypes={leaveTypes} />}

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
          {tab === "departments" && (() => {
            // Helpers used by both sub-tabs.
            // Professional, harmonious palette — uniformly mid-saturation
            // tones (≈ Tailwind 600 weights) that look balanced when
            // shown side-by-side. Skips the loud reds / hot pinks so the
            // breakdown reads as polished rather than party-coloured.
            const palette = [
              "#0f6ecd", // brand blue
              "#0d9488", // teal
              "#059669", // emerald
              "#7c3aed", // violet
              "#0284c7", // sky
              "#d97706", // amber
              "#4338ca", // indigo
              "#0891b2", // cyan
            ];
            const personName = (m: any) =>
              m.name || [m.employeeProfile?.firstName, m.employeeProfile?.lastName].filter(Boolean).join(" ") || m.email || "—";
            const personRole = (m: any) =>
              m.employeeProfile?.designation || m.orgLevel || "";
            const Av = ({ m, size = 28 }: { m: any; size?: number }) => {
              const name = personName(m);
              const initials = name.split(" ").map((p: string) => p[0] || "").join("").slice(0, 2).toUpperCase();
              const bg = palette[name.charCodeAt(0) % palette.length];
              const url = m.profilePictureUrl || m.employeeProfile?.profilePictureUrl;
              return (
                <span
                  title={name}
                  aria-label={name}
                  className="inline-block rounded-full ring-2 ring-white dark:ring-[#001529] cursor-default transition-transform hover:scale-110 hover:z-10"
                  style={{ width: size, height: size }}
                >
                  {url ? (
                    <img src={url} alt={name} className="h-full w-full rounded-full object-cover" />
                  ) : (
                    <span
                      className="flex h-full w-full items-center justify-center rounded-full font-bold text-white"
                      style={{ background: bg, fontSize: Math.round(size * 0.36) }}
                    >
                      {initials}
                    </span>
                  )}
                </span>
              );
            };
            const totalEmployees = employees.length;

            return (
              <>
                {/* Header + sub-tabs */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-[15px] font-bold text-slate-800 dark:text-white">
                      {deptView === "dept" ? "Department Breakdown" : "Manager Breakdown"}
                    </h2>
                    <p className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">
                      {deptView === "dept"
                        ? `${depts.length} ${depts.length === 1 ? "department" : "departments"} · ${totalEmployees} employees`
                        : `${managersGrouped.length} ${managersGrouped.length === 1 ? "manager" : "managers"}`}
                    </p>
                  </div>
                  <div className="inline-flex rounded-lg bg-slate-100 dark:bg-white/[0.05] p-1 self-start">
                    {[
                      { key: "dept",    label: "By Department" },
                      { key: "manager", label: "By Manager"    },
                    ].map((t) => {
                      const active = deptView === (t.key as typeof deptView);
                      return (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setDeptView(t.key as typeof deptView)}
                          className={`px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-all ${
                            active
                              ? "bg-white dark:bg-[#001529] text-[#008CFF] shadow-sm"
                              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          }`}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* By Department — card grid */}
                {deptView === "dept" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {depts.map(([dept, members]) => {
                      const accentBg = palette[dept.charCodeAt(0) % palette.length];
                      return (
                        <div
                          key={dept}
                          className="group relative rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/80 overflow-hidden transition-shadow hover:shadow-[0_4px_18px_rgba(15,23,42,0.06)]"
                        >
                          {/* Soft accent strip — a fade-out gradient looks
                              less aggressive than a flat coloured bar. */}
                          <span
                            aria-hidden
                            className="absolute inset-x-0 top-0 h-[3px]"
                            style={{ background: `linear-gradient(90deg, ${accentBg}, ${accentBg}80 65%, transparent)` }}
                          />
                          <div className="px-4 pt-4 pb-3 flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {/* Pastel chip — tinted background + dark
                                  text reads as an enterprise badge, not a
                                  child's sticker. */}
                              <span
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-bold text-[13px] ring-1"
                                style={{
                                  background: `${accentBg}14`,
                                  color: accentBg,
                                  boxShadow: `inset 0 0 0 1px ${accentBg}33`,
                                }}
                              >
                                {dept.slice(0, 2).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-[13.5px] font-bold text-slate-800 dark:text-white">{dept}</p>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {members.length} {members.length === 1 ? "member" : "members"}
                                </p>
                              </div>
                            </div>
                            <span className="text-[20px] font-bold tabular-nums text-slate-300 dark:text-white/15">
                              {members.length}
                            </span>
                          </div>
                          <div className="px-4 pb-4">
                            {members.length === 0 ? (
                              <p className="text-[12px] text-slate-400">No employees</p>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {members.slice(0, 14).map((m: any) => <Av key={m.id} m={m} size={28} />)}
                                {members.length > 14 && (
                                  <span
                                    title={members.slice(14).map(personName).join(", ")}
                                    className="inline-flex h-7 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.06] px-2 text-[10px] font-bold text-slate-600 dark:text-slate-300"
                                  >
                                    +{members.length - 14}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {depts.length === 0 && (
                      <div className="md:col-span-2 xl:col-span-3 rounded-xl border border-dashed border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/80 px-6 py-10 text-center text-[13px] text-slate-500">
                        No employees imported yet.
                      </div>
                    )}
                  </div>
                )}

                {/* By Manager — list of managers with department + reports */}
                {deptView === "manager" && (
                  <div className="rounded-xl border border-slate-200 dark:border-white/[0.06] bg-white dark:bg-[#001529]/80 overflow-hidden">
                    {managersGrouped.length === 0 ? (
                      <div className="px-6 py-12 text-center text-[13px] text-slate-500">
                        No employees with the Manager / HoD role.
                      </div>
                    ) : (
                      <ul className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                        {managersGrouped.map(({ manager: m, reports }) => {
                          const dept = m.employeeProfile?.department || "Unassigned";
                          const accentBg = palette[dept.charCodeAt(0) % palette.length];
                          return (
                            <li key={m.id} className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-start gap-3 min-w-0">
                                <Av m={m} size={40} />
                                <div className="min-w-0">
                                  <p className="truncate text-[13.5px] font-semibold text-slate-800 dark:text-white">
                                    {personName(m)}
                                  </p>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                                    {personRole(m) && (
                                      <span className="text-slate-500 dark:text-slate-400">{personRole(m)}</span>
                                    )}
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ring-1"
                                      style={{
                                        background: `${accentBg}14`,
                                        color: accentBg,
                                        boxShadow: `inset 0 0 0 1px ${accentBg}33`,
                                      }}
                                    >
                                      {dept}
                                    </span>
                                    <span className="text-slate-400">
                                      · {reports.length} {reports.length === 1 ? "report" : "reports"}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="shrink-0 flex flex-wrap items-center gap-1.5 sm:justify-end">
                                {reports.length === 0 ? (
                                  <span className="text-[11.5px] text-slate-400">No direct reports</span>
                                ) : (
                                  <>
                                    {reports.slice(0, 8).map((r: any) => <Av key={r.id} m={r} size={24} />)}
                                    {reports.length > 8 && (
                                      <span
                                        title={reports.slice(8).map(personName).join(", ")}
                                        className="inline-flex h-6 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.06] px-2 text-[10px] font-bold text-slate-600 dark:text-slate-300"
                                      >
                                        +{reports.length - 8}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </>
            );
          })()}
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
