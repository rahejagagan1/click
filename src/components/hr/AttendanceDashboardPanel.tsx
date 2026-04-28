"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { fetcher } from "@/lib/swr";
import { Users, CalendarOff, CheckCircle2, Home, Search, CircleUser, Clock, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import FilterDropdown, { FilterOption } from "@/components/hr/FilterDropdown";

type Row = {
  id: number; name: string; email: string; role: string; orgLevel: string;
  profilePictureUrl: string | null;
  teamCapsule: string | null;
  employeeId: string | null; designation: string | null; department: string | null;
  workLocation: string | null;
  clockIn: string | null; clockOut: string | null; totalMinutes: number;
  rawStatus: string; locationAddress: string | null; locationMode: string | null;
  status: "office" | "remote" | "on_leave" | "absent";
};

type Counts = {
  total: number; present: number; office: number; remote: number;
  onLeave: number; notClockedIn: number; late: number;
};

const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

const fmtMins = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;

function StatCard({ label, value, tint, Icon }: { label: string; value: number; tint: string; Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }) {
  return (
    <div className="flex-1 bg-white border border-slate-200 rounded-xl p-4 min-w-[150px]">
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${tint}18`, color: tint }}>
          <Icon size={18} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-500 leading-none">{label}</p>
          <p className="text-[22px] font-extrabold text-slate-800 mt-1 leading-none tabular-nums">{value}</p>
        </div>
      </div>
    </div>
  );
}

// SVG donut chart: segments sized by status count.
function StatusDonut({ c }: { c: Counts }) {
  const segs = [
    { label: "In Office",      n: c.office,       color: "#10b981" },
    { label: "Remote",         n: c.remote,       color: "#008CFF" },
    { label: "On Leave",       n: c.onLeave,      color: "#8b5cf6" },
    { label: "Not Clocked In", n: c.notClockedIn, color: "#cbd5e1" },
  ];
  const total = segs.reduce((s, x) => s + x.n, 0);
  const size = 120, stroke = 20, r = (size - stroke) / 2, C = 2 * Math.PI * r;

  let acc = 0;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-[12px] font-semibold text-slate-700 mb-3">Distribution</p>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
            {total > 0 && segs.map((s) => {
              if (s.n === 0) return null;
              const frac = s.n / total;
              const dash = frac * C;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-acc}
                />
              );
              acc += dash;
              return el;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[17px] font-extrabold text-slate-800 leading-none tabular-nums">{total}</span>
            <span className="text-[9px] text-slate-500 mt-0.5">employees</span>
          </div>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          {segs.map((s) => {
            const pct = total > 0 ? Math.round((s.n / total) * 100) : 0;
            return (
              <div key={s.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="text-slate-600 flex-1 truncate">{s.label}</span>
                <span className="font-semibold tabular-nums text-slate-800">{s.n}</span>
                <span className="text-slate-400 tabular-nums w-8 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type MonthSummaryRow = {
  id: number; name: string; email: string; role: string; orgLevel: string;
  profilePictureUrl: string | null; teamCapsule: string | null;
  employeeId: string | null; designation: string | null; department: string | null;
  presentDays: number; onLeaveDays: number; lateDays: number; halfDayDays: number; absentDays: number; avgHours: number;
};

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Click-to-open popover with a year stepper + 12-month grid. Portalled to body
// so the surrounding card's overflow can never clip it.
function MonthYearPicker({
  year, month, onChange, compact,
}: {
  year: number; month: number;
  onChange: (y: number, m: number) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(year);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number } | null>(null);

  const today = new Date();
  const curY = today.getFullYear();
  const curM = today.getMonth() + 1;

  const POP_W = 260;
  const POP_H = 260; // approx; only used for vertical flip
  const MARGIN = 8;

  useEffect(() => { if (open) setDraftYear(year); }, [open, year]);

  const place = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vw = typeof window !== "undefined" ? window.innerWidth  : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    // Horizontal clamp: prefer trigger.left; if that would overflow right, align to trigger.right; never below margin.
    let left = r.left;
    if (left + POP_W + MARGIN > vw) left = Math.max(MARGIN, r.right - POP_W);
    if (left < MARGIN) left = MARGIN;
    // Vertical flip: open upward if dropping down would overflow.
    let top = r.bottom + 4;
    if (top + POP_H + MARGIN > vh) top = Math.max(MARGIN, r.top - POP_H - 4);
    setRect({ left, top });
  };

  const openPicker = () => { place(); setOpen(true); };

  // Keep position correct on resize / scroll while the picker is open.
  useEffect(() => {
    if (!open) return;
    const handler = () => place();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (triggerRef.current && triggerRef.current.contains(e.target as Node)) return;
      const pop = document.getElementById("month-year-picker-pop");
      if (!pop || !pop.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`h-8 px-3 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-semibold tabular-nums ${compact ? "text-[12px]" : "text-[13px]"} min-w-[140px] justify-center`}
      >
        {MONTH_NAMES[month - 1]} {year}
        <ChevronDown size={13} className="text-slate-400" />
      </button>

      {open && rect && typeof document !== "undefined" && createPortal(
        <div
          id="month-year-picker-pop"
          style={{ position: "fixed", left: rect.left, top: rect.top, zIndex: 10000 }}
          className="w-[260px] bg-white border border-slate-200 rounded-xl shadow-xl p-3"
        >
          <div className="flex items-center justify-between mb-3">
            <button type="button"
              onClick={() => setDraftYear((y) => y - 1)}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[13px] font-bold text-slate-800 tabular-nums">{draftYear}</span>
            <button type="button"
              onClick={() => setDraftYear((y) => y + 1)}
              disabled={draftYear >= curY}
              className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTH_NAMES_SHORT.map((name, i) => {
              const m = i + 1;
              const isSel    = draftYear === year && m === month;
              const isCurrMo = draftYear === curY && m === curM;
              const isFuture = draftYear > curY || (draftYear === curY && m > curM);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={isFuture}
                  onClick={() => { onChange(draftYear, m); setOpen(false); }}
                  className={`h-9 rounded-lg text-[12px] font-semibold transition-colors
                    ${isSel ? "bg-[#008CFF] text-white" :
                      isCurrMo ? "border border-[#008CFF] text-[#008CFF] bg-[#008CFF]/5 hover:bg-[#008CFF]/10" :
                      "text-slate-700 hover:bg-slate-100"}
                    disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex justify-between">
            <button type="button"
              onClick={() => { onChange(curY, curM); setOpen(false); }}
              className="text-[11.5px] font-semibold text-[#008CFF] hover:underline">
              Jump to this month
            </button>
            <button type="button"
              onClick={() => setOpen(false)}
              className="text-[11.5px] text-slate-500 hover:text-slate-800">
              Close
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function MonthNav({ year, month, onChange, compact = false }: {
  year: number; month: number;
  onChange: (y: number, m: number) => void;
  compact?: boolean;
}) {
  const prev = () => { if (month === 1) onChange(year - 1, 12); else onChange(year, month - 1); };
  const next = () => { if (month === 12) onChange(year + 1, 1); else onChange(year, month + 1); };
  const today = new Date();
  const isCurrent = year === today.getFullYear() && month === today.getMonth() + 1;
  const isFuture = year > today.getFullYear() || (year === today.getFullYear() && month > today.getMonth() + 1);
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={prev}
        className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600">
        <ChevronLeft size={14} />
      </button>
      <MonthYearPicker year={year} month={month} onChange={onChange} compact={compact} />
      <button type="button" onClick={next} disabled={isFuture}
        className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed">
        <ChevronRight size={14} />
      </button>
      {!isCurrent && (
        <button type="button"
          onClick={() => onChange(today.getFullYear(), today.getMonth() + 1)}
          className="ml-1 h-8 px-3 rounded-lg border border-[#008CFF] text-[#008CFF] bg-[#008CFF]/5 hover:bg-[#008CFF]/10 text-[11.5px] font-semibold">
          This month
        </button>
      )}
    </div>
  );
}

type MonthSummary = {
  month: string;
  workingDays: number;
  workingDaysElapsed: number;
  weekendDays: number;
  holidayDays: number;
  daysInMonth: number;
  employeeCount: number;
  rows: MonthSummaryRow[];
};

function MonthlyReport({ year, month, onChange }: {
  year: number; month: number;
  onChange: (y: number, m: number) => void;
}) {
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const { data, isLoading } = useSWR<MonthSummary>(
    `/api/hr/admin/attendance-month-summary?month=${monthKey}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );
  const rows = data?.rows ?? [];
  const workingDays        = data?.workingDays        ?? 0;
  const workingDaysElapsed = data?.workingDaysElapsed ?? 0;
  const weekendDays        = data?.weekendDays        ?? 0;
  const holidayDays        = data?.holidayDays        ?? 0;
  const daysInMonth        = data?.daysInMonth        ?? 0;
  const employeeCount      = data?.employeeCount      ?? 0;

  // Aggregates across all employees for the month
  const totals = rows.reduce(
    (acc, r) => {
      acc.present += r.presentDays;
      acc.onLeave += r.onLeaveDays;
      acc.late    += r.lateDays;
      acc.halfDay += r.halfDayDays;
      acc.absent  += r.absentDays;
      return acc;
    },
    { present: 0, onLeave: 0, late: 0, halfDay: 0, absent: 0 }
  );

  // Live attendance % — computed against working days ELAPSED so it reflects
  // actual performance to date instead of being diluted by future days.
  const empWorkingDaysElapsed = workingDaysElapsed * employeeCount;
  const attendancePct = empWorkingDaysElapsed > 0
    ? Math.round((totals.present / empWorkingDaysElapsed) * 100)
    : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <p className="text-[12px] font-semibold text-slate-700">Monthly Report</p>
        <MonthNav year={year} month={month} onChange={onChange} compact />
      </div>
      {isLoading ? (
        <div className="py-8 text-center"><div className="inline-block w-6 h-6 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {/* Calendar breakdown for the month */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 mb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-[9.5px] uppercase tracking-[0.1em] text-slate-500 font-semibold">Working Days</p>
                <p className="text-[20px] font-extrabold text-[#008CFF] tabular-nums leading-none mt-1">
                  {workingDays}
                  <span className="text-[11px] text-slate-400 font-medium ml-1">/ {daysInMonth} days</span>
                </p>
              </div>
              <div className="text-right text-[11px] text-slate-600 space-y-0.5">
                <p><span className="font-semibold tabular-nums text-slate-800">{weekendDays}</span> weekend days</p>
                <p><span className="font-semibold tabular-nums text-slate-800">{holidayDays}</span> holidays</p>
                <p><span className="font-semibold tabular-nums text-slate-800">{employeeCount}</span> employees</p>
              </div>
            </div>
          </div>

          {/* Clock-in counts across the whole month */}
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Present"  value={totals.present} tint="#10b981" />
            <Stat label="On Leave" value={totals.onLeave} tint="#8b5cf6" />
            <Stat label="Absent"   value={totals.absent}  tint="#ef4444" />
            <Stat label="Late"     value={totals.late}    tint="#f59e0b" />
            <Stat label="Half Day" value={totals.halfDay} tint="#64748b" />
            <Stat label="Attendance" value={attendancePct} tint="#008CFF" suffix="%" />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tint, suffix }: { label: string; value: number; tint: string; suffix?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 p-2.5" style={{ background: `${tint}0d` }}>
      <p className="text-[9.5px] uppercase tracking-[0.1em] text-slate-500 font-semibold">{label}</p>
      <p className="text-[16px] font-extrabold tabular-nums mt-1" style={{ color: tint }}>
        {value}{suffix ?? ""}
      </p>
    </div>
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

function StatusPill({ s, rawStatus }: { s: Row["status"]; rawStatus: string }) {
  const map: Record<Row["status"], { bg: string; text: string; label: string; dot: string }> = {
    office:   { bg: "bg-emerald-50",  text: "text-emerald-700",  label: "In Office",    dot: "#10b981" },
    remote:   { bg: "bg-[#008CFF]/10", text: "text-[#008CFF]",   label: "Remote",       dot: "#008CFF" },
    on_leave: { bg: "bg-violet-50",   text: "text-violet-700",   label: "On Leave",     dot: "#8b5cf6" },
    absent:   { bg: "bg-slate-100",   text: "text-slate-600",    label: "Not Clocked In", dot: "#94a3b8" },
  };
  const m = map[s];
  const late = rawStatus === "late";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.bg} ${m.text}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}{late && <span className="text-[10px] text-amber-600 font-bold ml-1">· LATE</span>}
    </span>
  );
}

export default function AttendanceDashboardPanel() {
  const { data: session } = useSession();
  const me = session?.user as any;
  const canView =
    me?.isDeveloper === true ||
    me?.role === "admin" ||
    me?.orgLevel === "ceo" ||
    me?.orgLevel === "hr_manager";

  const { data, isLoading, error } = useSWR<{ rows: Row[]; counts: Counts; date: string }>(
    canView ? "/api/hr/admin/attendance-dashboard" : null,
    fetcher,
    { refreshInterval: 60_000 }
  );

  const [tab, setTab] = useState<"all" | "office" | "remote" | "on_leave" | "absent">("all");
  const [search, setSearch] = useState("");
  const [fDept, setFDept] = useState<Set<string>>(new Set());

  // Shared month state (drives both the Monthly Report card and the month-mode table)
  const now = new Date();
  const [selYear,  setSelYear]  = useState(now.getFullYear());
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const monthKey = `${selYear}-${String(selMonth).padStart(2, "0")}`;
  const [tableView, setTableView] = useState<"today" | "month">("today");

  const { data: monthData, isLoading: monthLoading } = useSWR<{ month: string; rows: MonthSummaryRow[] }>(
    tableView === "month" ? `/api/hr/admin/attendance-month-summary?month=${monthKey}` : null,
    fetcher,
    { keepPreviousData: true }
  );
  const monthRows = monthData?.rows ?? [];

  const rows: Row[] = data?.rows ?? [];
  const counts: Counts = data?.counts ?? { total: 0, present: 0, office: 0, remote: 0, onLeave: 0, notClockedIn: 0, late: 0 };

  const deptOpts = useMemo(() => {
    const dSet = new Set<string>();
    for (const r of rows) if (r.department) dSet.add(r.department);
    return Array.from(dSet).sort().map((v): FilterOption => ({ value: v, label: v }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== "all" && r.status !== tab) return false;
      if (fDept.size > 0 && (!r.department || !fDept.has(r.department))) return false;
      if (q) {
        const hay = `${r.name} ${r.email} ${r.employeeId ?? ""} ${r.designation ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, fDept, search]);

  const filteredMonth = useMemo(() => {
    const q = search.trim().toLowerCase();
    return monthRows.filter((r) => {
      if (fDept.size > 0 && (!r.department || !fDept.has(r.department))) return false;
      if (q) {
        const hay = `${r.name} ${r.email} ${r.employeeId ?? ""} ${r.designation ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [monthRows, fDept, search]);

  const clearFilters = () => { setFDept(new Set()); setSearch(""); };
  const anyFilter = fDept.size || search;

  if (!canView) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[14px] text-slate-600 font-medium">You don't have permission to view this.</p>
          <Link href="/dashboard/hr/home" className="text-[12px] text-[#008CFF] hover:underline mt-2 inline-block">Back to HR Home</Link>
        </div>
      </div>
    );
  }

  const TABS: { key: typeof tab; label: string; n: number }[] = [
    { key: "all",      label: "All",              n: counts.total        },
    { key: "office",   label: "In Office",        n: counts.office       },
    { key: "remote",   label: "Remote Clock-in",  n: counts.remote       },
    { key: "on_leave", label: "On Leave",         n: counts.onLeave      },
    { key: "absent",   label: "Not Clocked In",   n: counts.notClockedIn },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-slate-800">Attendance Dashboard</h1>
          <p className="text-[12px] text-slate-500">
            Live snapshot for {data?.date ? new Date(data.date).toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) : "today"} · refreshes every minute
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <StatCard label="Total Employees" value={counts.total}        tint="#475569" Icon={Users}          />
        <StatCard label="Present Today"   value={counts.present}      tint="#10b981" Icon={CheckCircle2}   />
        <StatCard label="Not Clocked In"  value={counts.notClockedIn} tint="#64748b" Icon={CircleUser}     />
        <StatCard label="On Leave"        value={counts.onLeave}      tint="#8b5cf6" Icon={CalendarOff}    />
        <StatCard label="Working Remotely" value={counts.remote}      tint="#008CFF" Icon={Home}           />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        <StatusDonut c={counts} />
        <MonthlyReport
          year={selYear}
          month={selMonth}
          onChange={(y, m) => { setSelYear(y); setSelMonth(m); }}
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        {/* View toggle + month nav */}
        <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-3 border-b border-slate-200">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            <button type="button" onClick={() => setTableView("today")}
              className={`h-8 px-3 text-[12px] font-semibold transition-colors ${
                tableView === "today" ? "bg-[#008CFF] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}>
              Today
            </button>
            <button type="button" onClick={() => setTableView("month")}
              className={`h-8 px-3 text-[12px] font-semibold transition-colors border-l border-slate-200 ${
                tableView === "month" ? "bg-[#008CFF] text-white border-[#008CFF]" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}>
              Month view
            </button>
          </div>
          {tableView === "month" && (
            <MonthNav year={selYear} month={selMonth} onChange={(y, m) => { setSelYear(y); setSelMonth(m); }} />
          )}
        </div>

        {/* Status tabs — today only */}
        {tableView === "today" && (
          <div className="flex items-center px-2 border-b border-slate-200 overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative px-4 py-3 text-[12.5px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                    active ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 text-[10.5px] tabular-nums ${active ? "text-[#008CFF]" : "text-slate-400"}`}>{t.n}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap px-3 py-3 border-b border-slate-200">
          <FilterDropdown label="Department" options={deptOpts} selected={fDept} onChange={setFDept} width={260} />
          {anyFilter ? (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 px-3 text-[12px] font-medium text-slate-500 hover:text-[#008CFF] transition-colors"
            >
              Clear filters
            </button>
          ) : null}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, employee #…"
              className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#008CFF]"
            />
          </div>
        </div>

        {tableView === "today" ? (
          isLoading ? (
            <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
          ) : error ? (
            <p className="py-16 text-center text-[13px] text-rose-500">Couldn't load attendance</p>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-slate-400">No employees match the current filters</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60">
                  {["EMPLOYEE","EMP #","DEPARTMENT","TEAM CAPSULE","CLOCK IN","CLOCK OUT","DURATION","STATUS"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name} url={r.profilePictureUrl} size={34} />
                        <div className="min-w-0">
                          <Link href={`/dashboard/hr/people/${r.id}`} className="block text-[13px] font-semibold text-slate-800 hover:text-[#008CFF] truncate">
                            {r.name}
                          </Link>
                          <p className="text-[11px] text-slate-500 truncate">{r.designation || r.role || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 font-mono">{r.employeeId || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 truncate max-w-[180px]">{r.department || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 truncate max-w-[160px]">{r.teamCapsule || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 tabular-nums">{fmtTime(r.clockIn)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 tabular-nums">{fmtTime(r.clockOut)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 tabular-nums">
                      {r.totalMinutes > 0 ? fmtMins(r.totalMinutes) : (r.clockIn ? <span className="inline-flex items-center gap-1 text-[#008CFF]"><Clock size={12} /> ongoing</span> : "—")}
                    </td>
                    <td className="px-4 py-3"><StatusPill s={r.status} rawStatus={r.rawStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          monthLoading ? (
            <div className="py-16 text-center"><div className="inline-block w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" /></div>
          ) : filteredMonth.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-slate-400">No employees match the current filters</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60">
                  {["EMPLOYEE","EMP #","DEPARTMENT","PRESENT","ON LEAVE","LATE","HALF-DAY","ABSENT","AVG HRS"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredMonth.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name} url={r.profilePictureUrl} size={34} />
                        <div className="min-w-0">
                          <Link href={`/dashboard/hr/people/${r.id}`} className="block text-[13px] font-semibold text-slate-800 hover:text-[#008CFF] truncate">
                            {r.name}
                          </Link>
                          <p className="text-[11px] text-slate-500 truncate">{r.designation || r.role || "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 font-mono">{r.employeeId || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-700 truncate max-w-[180px]">{r.department || "—"}</td>
                    <td className="px-4 py-3 text-[12.5px] text-emerald-600 tabular-nums">{r.presentDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-violet-600 tabular-nums">{r.onLeaveDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-amber-600 tabular-nums">{r.lateDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-600 tabular-nums">{r.halfDayDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-600 tabular-nums">{r.absentDays}</td>
                    <td className="px-4 py-3 text-[12.5px] text-slate-800 tabular-nums font-semibold">{r.avgHours ? `${r.avgHours}h` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
