"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { isHRAdmin } from "@/lib/access";
import {
  ChevronLeft, ChevronRight, Calendar,
  CheckCircle2, PlayCircle, UserPlus, Wallet, ShieldCheck, Lock,
  X,
} from "lucide-react";

// ─── Keka-style "Run Payroll" surface for HR admins ──────────────────────────
// 12-month strip, the selected month's headline stats, and the 6-step
// run-payroll workflow. The 6 steps wrap the existing payroll engine
// (/api/hr/payroll/runs + /generate + /[id]/transition + /bonus); the
// page is the orchestration layer, not the business logic.
//
// Real APIs used:
//   /api/hr/payroll/runs                    (list + create)
//   /api/hr/payroll/runs/[id]/totals        (aggregate stats — new)
//   /api/hr/payroll/runs/[id]/activity      (audit feed — new)
//   /api/hr/payroll/runs/[id]/transition    (lock / pay / re-open)
//   /api/hr/payroll/generate                (compute payslips)
//   /api/hr/payroll/bonus                   (one-off bonuses for the cycle)
//   /api/hr/employees                       (total employee count)

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_LONG  = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function fmtInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "INR 0";
  return `INR ${Math.round(n).toLocaleString("en-IN")}`;
}

function timeAgo(iso: string): string {
  const t  = new Date(iso).getTime();
  const dt = Math.max(0, Date.now() - t);
  const m  = Math.floor(dt / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

type PayrollRun = {
  id: number;
  month: number;   // 0-indexed (Jan=0)
  year: number;
  status: "draft" | "generated" | "processing" | "locked" | "paid";
  _count?: { payslips: number };
};

type MonthCell = {
  key: string;
  year: number;
  month0: number;
  isCurrent: boolean;
  run: PayrollRun | null;
  status: "completed" | "current" | "upcoming";
};

function buildStrip(today: Date, runs: PayrollRun[]): MonthCell[] {
  const cells: MonthCell[] = [];
  const curY = today.getFullYear();
  const curM = today.getMonth();
  const PAST = 1, FUTURE = 10;
  for (let offset = -PAST; offset <= FUTURE; offset++) {
    const d = new Date(curY, curM + offset, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const run = runs.find((r) => r.year === y && r.month === m) ?? null;
    const isCurrent = offset === 0;
    const status: MonthCell["status"] =
      run?.status === "paid" || run?.status === "locked" ? "completed" :
      isCurrent                                           ? "current"   :
                                                            "upcoming";
    cells.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, year: y, month0: m, isCurrent, run, status });
  }
  return cells;
}

const MODULE_TABS = [
  { key: "home",         label: "HOME",        href: "/dashboard/hr/home"       },
  { key: "attendance",   label: "ATTENDANCE",  href: "/dashboard/hr/attendance" },
  { key: "leave",        label: "LEAVE",       href: "/dashboard/hr/leaves"     },
  { key: "performance",  label: "PERFORMANCE", href: "/dashboard/hr/goals"      },
  { key: "payroll",      label: "MY FINANCES", href: "/dashboard/hr/payroll"    },
];

const PAYROLL_TABS = [
  { key: "analytics", label: "PAYROLL ANALYTICS", href: "#" },
  { key: "run",       label: "RUN PAYROLL",       href: "/dashboard/hr/payroll/run" },
  { key: "admin",     label: "PAYROLL ADMIN",     href: "/dashboard/hr/admin?tab=payroll" },
  { key: "approvals", label: "APPROVALS",         href: "/dashboard/hr/approvals" },
  { key: "loans",     label: "LOANS",             href: "#" },
  { key: "benefits",  label: "BENEFITS",          href: "#" },
  { key: "reports",   label: "REPORTS",           href: "#" },
  { key: "settings",  label: "SETTINGS",          href: "#" },
];

export default function RunPayrollPage() {
  const { data: session } = useSession();
  const user = (session?.user ?? null) as any;

  const today = useMemo(() => new Date(), []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // For step-action feedback
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const isAdmin = !!user && isHRAdmin(user);

  const { data: runsRaw } = useSWR<PayrollRun[]>(isAdmin ? "/api/hr/payroll/runs" : null, fetcher);
  const runs = Array.isArray(runsRaw) ? runsRaw : [];

  const { data: empData } = useSWR<any>(isAdmin ? "/api/hr/employees?count=1" : null, fetcher);
  const totalEmployees = (Array.isArray(empData) ? empData.length : empData?.total) ?? 0;

  const cells = useMemo(() => buildStrip(today, runs), [today, runs]);
  const selected = cells.find((c) => c.key === selectedKey)
                ?? cells.find((c) => c.isCurrent)
                ?? cells[0];

  // Phase 2 — totals (real aggregates from the payslip rows).
  const totalsUrl = selected?.run ? `/api/hr/payroll/runs/${selected.run.id}/totals` : null;
  const { data: totals } = useSWR<any>(isAdmin && totalsUrl ? totalsUrl : null, fetcher);

  // Phase 4 — activity feed for the right rail.
  const activityUrl = selected?.run ? `/api/hr/payroll/runs/${selected.run.id}/activity` : null;
  const { data: activity } = useSWR<any>(isAdmin && activityUrl ? activityUrl : null, fetcher);

  if (user && !isAdmin) {
    return (
      <div className="min-h-screen bg-[#f4f7f8] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-slate-200 p-10 max-w-md text-center">
          <h2 className="text-[15px] font-semibold text-slate-800 mb-2">Access restricted</h2>
          <p className="text-[12.5px] text-slate-500">Run Payroll is only available to HR admins.</p>
        </div>
      </div>
    );
  }

  const monthLabelShort = selected ? `${MONTHS_LONG[selected.month0]}-${selected.year}` : "";
  const monthDayCount   = selected ? daysInMonth(selected.year, selected.month0 + 1) : 0;
  const monthRangeText  = selected ? `(${MONTHS_LONG[selected.month0]} 1 - ${MONTHS_LONG[selected.month0]} ${monthDayCount}, ${monthDayCount} days)` : "";

  // Step completion is derived from PayrollRun.status:
  //   draft       → 0/6  (no payslips yet)
  //   processing  → 3/6  (run is being generated)
  //   generated   → 4/6  (payslips exist, awaiting review)
  //   locked      → 5/6  (HR locked, awaiting payment)
  //   paid        → 6/6  (finance confirmed money out — completed)
  const statusForSteps = selected?.run?.status ?? null;
  const stepsCompleted =
    statusForSteps === "paid"       ? 6 :
    statusForSteps === "locked"     ? 5 :
    statusForSteps === "generated"  ? 4 :
    statusForSteps === "processing" ? 3 :
                                      0;

  // ─── Step action handlers ──────────────────────────────────────────────
  // All payroll-mutating actions go through the existing engine endpoints;
  // we're only acting as the orchestrator UI here.

  // Ensure a PayrollRun row exists for the selected month before any
  // generate / transition call can run (they require an id).
  async function ensureRun(): Promise<PayrollRun | null> {
    if (!selected) return null;
    if (selected.run) return selected.run;
    const res = await fetch("/api/hr/payroll/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: selected.month0, year: selected.year }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || "Could not create run");
    }
    const run = await res.json();
    await mutate("/api/hr/payroll/runs");
    return run;
  }

  async function doRunSalary() {
    if (!selected) return;
    setBusyStep("run-salary"); setBanner(null);
    try {
      const run = await ensureRun();
      if (!run) throw new Error("No run");
      const res = await fetch("/api/hr/payroll/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Generate failed");
      const data = await res.json();
      setBanner({ kind: "ok", text: `Payslips generated for ${data.count ?? "all"} employees.` });
      await mutate("/api/hr/payroll/runs");
      if (run.id) await mutate(`/api/hr/payroll/runs/${run.id}/totals`);
    } catch (e: any) {
      setBanner({ kind: "err", text: e?.message || "Generate failed" });
    } finally {
      setBusyStep(null);
    }
  }

  // Generic transition (lock / pay / reopen). The /[id]/transition route
  // gates which transitions are valid — we just pass the desired action.
  async function doTransition(action: "lock" | "mark_paid" | "reopen") {
    if (!selected?.run) {
      setBanner({ kind: "err", text: "Generate payslips first before locking." });
      return;
    }
    setBusyStep(action === "reopen" ? "pre-check" : "finalize");
    setBanner(null);
    try {
      const res = await fetch(`/api/hr/payroll/runs/${selected.run.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Transition failed");
      setBanner({ kind: "ok", text: `Run ${action === "reopen" ? "reopened" : action + "ed"}.` });
      await mutate("/api/hr/payroll/runs");
      await mutate(`/api/hr/payroll/runs/${selected.run.id}/totals`);
      await mutate(`/api/hr/payroll/runs/${selected.run.id}/activity`);
    } catch (e: any) {
      setBanner({ kind: "err", text: e?.message || "Transition failed" });
    } finally {
      setBusyStep(null);
    }
  }

  // Pre-Payroll Check modal state — opens a side panel showing every
  // generated payslip with its key numbers so HR can review before lock.
  const [preCheckOpen, setPreCheckOpen] = useState(false);

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f4f7f8]">
      <div className="flex items-center bg-white border-b border-slate-200 px-4 overflow-x-auto">
        {MODULE_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest border-b-2 transition-colors whitespace-nowrap ${
              t.key === "payroll" ? "border-[#6f42c1] text-[#6f42c1]" : "border-transparent text-slate-400 hover:text-slate-600"
            }`}>{t.label}</Link>
        ))}
      </div>

      <div className="flex items-center bg-white border-b border-slate-100 px-4 overflow-x-auto">
        {PAYROLL_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`relative px-4 py-3 text-[11px] font-bold tracking-widest transition-colors whitespace-nowrap ${
              t.key === "run" ? "text-[#0f4e93]" : "text-slate-400 hover:text-slate-600"
            }`}>
            {t.label}
            {t.key === "run" && (
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#0f4e93]" />
            )}
          </Link>
        ))}
      </div>

      <div className="mx-auto max-w-7xl space-y-5 p-6">
        <div className="flex items-center gap-2">
          <h1 className="text-[20px] font-bold text-slate-800">NB Media</h1>
          <button className="text-slate-400 hover:text-slate-600" aria-label="Switch entity">▾</button>
        </div>

        <MonthStrip cells={cells} selectedKey={selected?.key ?? null} onSelect={setSelectedKey} />

        <div className="flex items-baseline gap-3">
          <h2 className="text-[18px] font-bold text-slate-800">{monthLabelShort}</h2>
          <span className="text-[12.5px] text-slate-500">{monthRangeText}</span>
          {selected?.run && (
            <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
              {selected.run.status}
            </span>
          )}
        </div>

        <StatsRow
          totalEmployees={totalEmployees}
          calendarDays={monthDayCount}
          processedCount={totals?.payslipCount ?? 0}
          totalPayrollCost={totals?.totalPayrollCost ?? 0}
          employeeDeposit={totals?.employeeDeposit ?? 0}
          totalDeductions={totals?.totalDeductions ?? 0}
          totalContributions={totals?.totalContributions ?? 0}
        />

        {banner && (
          <div className={`rounded-lg border px-3 py-2 text-[12.5px] flex items-center gap-2 ${
            banner.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                 : "bg-rose-50 border-rose-200 text-rose-700"
          }`}>
            <span>{banner.text}</span>
            <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setBanner(null)}><X size={12} /></button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] p-5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-[14px] font-semibold text-slate-800">Run Payroll</h3>
              <span className="text-[11.5px] text-slate-500">{stepsCompleted} of 6 steps completed</span>
            </div>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-[#3b82f6] rounded-full transition-[width] duration-300" style={{ width: `${(stepsCompleted / 6) * 100}%` }} />
            </div>

            <div className="mb-4 rounded-lg border border-sky-100 bg-sky-50/70 px-3 py-2 text-[12px] text-slate-700">
              Ready to run payroll? Click <a className="font-semibold text-[#0f4e93] hover:underline" href="#">here</a> for a step-by-step guide.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Step 1: Leave & Attendance — manage from attendance page */}
              <StepCard step={1} title="Leave, Attendance & Payable Units" blurb="Lock attendance + leave for the cycle." Icon={Calendar}
                href="/dashboard/hr/attendance" done={stepsCompleted >= 1} />
              {/* Step 2: Joinees & Exits */}
              <StepCard step={2} title="New Joinees & Exits" blurb="Pro-rate new joiners and exits." Icon={UserPlus}
                href="/dashboard/hr/hiring" done={stepsCompleted >= 2} />
              {/* Step 3: Other payments — links to admin tab where bonuses live */}
              <StepCard step={3} title="Other Payments & Deductions" blurb="One-off bonuses / deductions for this cycle." Icon={Wallet}
                href={selected?.run ? `/dashboard/hr/admin?tab=payroll&runId=${selected.run.id}` : "/dashboard/hr/admin?tab=payroll"}
                done={stepsCompleted >= 3} />
              {/* Step 4: Run payroll — generate payslips */}
              <StepCard step={4} title="Run Payroll" blurb="Compute every payslip from the salary structure." Icon={PlayCircle}
                onClick={doRunSalary}
                done={stepsCompleted >= 4}
                busy={busyStep === "run-salary"}
                cta={statusForSteps === "generated" ? "Re-generate" : "Generate payslips"} />
              {/* Step 5: Pre-payroll check — review payslips */}
              <StepCard step={5} title="Pre-Payroll Check" blurb="Review the computed numbers before locking." Icon={ShieldCheck}
                onClick={() => setPreCheckOpen(true)}
                done={stepsCompleted >= 5}
                cta="Review payslips"
                disabled={!selected?.run} />
              {/* Step 6: Finalize — lock + pay */}
              <StepCard step={6} title="Finalize" blurb="Lock the cycle, generate payslips, mark complete." Icon={Lock}
                onClick={() => statusForSteps === "locked" ? doTransition("mark_paid") : doTransition("lock")}
                done={stepsCompleted >= 6}
                busy={busyStep === "finalize"}
                cta={statusForSteps === "locked" ? "Mark paid" : "Lock run"}
                disabled={!selected?.run || stepsCompleted < 4} />
            </div>
          </div>

          <div className="space-y-4">
            <RailCard title="Activity">
              {!activity ? (
                <p className="text-[12px] text-slate-400">Loading…</p>
              ) : activity.items?.length > 0 ? (
                <ul className="space-y-2">
                  {activity.items.slice(0, 8).map((a: any) => (
                    <li key={a.id} className="text-[11.5px] leading-snug">
                      <span className="font-semibold text-slate-700">{a.actorName || "system"}</span>{" "}
                      <span className="text-slate-500">{labelForAction(a.action)}</span>
                      <span className="block text-[10.5px] text-slate-400 mt-0.5">{timeAgo(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-slate-400">No activity yet for this cycle.</p>
              )}
            </RailCard>
            <RailCard title="Help Resources">
              <ul className="space-y-2 text-[12.5px]">
                <li><a className="text-[#0f4e93] hover:underline" href="#">How to override statutory contributions &amp; deductions?</a></li>
                <li><a className="text-[#0f4e93] hover:underline" href="#">Handle ad-hoc payments &amp; deductions</a></li>
                <li><a className="text-[#0f4e93] hover:underline" href="#">Reverse a finalised payroll</a></li>
              </ul>
            </RailCard>
          </div>
        </div>
      </div>

      {/* Pre-Payroll Check side panel */}
      {preCheckOpen && selected?.run && (
        <PreCheckPanel runId={selected.run.id} monthLabel={monthLabelShort} onClose={() => setPreCheckOpen(false)} />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function labelForAction(action: string): string {
  // Human-friendly verbs for common audit actions. Falls back to the
  // raw action string so we never silently hide unknown events.
  const map: Record<string, string> = {
    "payroll_run.create":      "created the run",
    "payroll_run.lock":        "locked the run",
    "payroll_run.pay":         "marked the run paid",
    "payroll_run.reopen":      "re-opened the run",
    "payslip.generate":        "generated payslips",
    "bonus.create":            "added a bonus",
    "bonus.update":            "updated a bonus",
    "bonus.delete":            "removed a bonus",
    "salary_structure.update": "updated a salary structure",
  };
  return map[action] || action;
}

function MonthStrip({ cells, selectedKey, onSelect }: {
  cells: MonthCell[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="relative bg-white rounded-xl border border-slate-200 p-3">
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        <button className="shrink-0 flex items-center justify-center w-7 self-center text-slate-400 hover:text-slate-600">
          <ChevronLeft size={16} />
        </button>
        {cells.map((c) => {
          const isSelected = c.key === selectedKey;
          const isCurrent  = c.status === "current";
          return (
            <button
              key={c.key}
              onClick={() => onSelect(c.key)}
              className={`shrink-0 w-[110px] rounded-lg border px-3 py-2.5 text-left transition-all hover:shadow-sm ${
                isSelected ? "ring-2 ring-[#1e64ce] ring-offset-1" : ""
              }`}
              style={{
                backgroundColor: isCurrent ? "#1e64ce" : "white",
                borderColor:     isCurrent ? "#1e64ce" : "#e2e8f0",
              }}
            >
              <p className={`text-[12px] font-bold ${isCurrent ? "text-white" : "text-slate-800"}`}>
                {MONTHS_SHORT[c.month0]} {c.year}
              </p>
              <p className={`text-[10px] mt-0.5 ${isCurrent ? "text-white/80" : "text-slate-500"}`}>
                01 {MONTHS_LONG[c.month0]}-{daysInMonth(c.year, c.month0 + 1)} {MONTHS_LONG[c.month0]}
              </p>
              <div className="mt-1.5">
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ${
                    c.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                    c.status === "current"   ? "bg-white/20 text-white"          :
                                               "bg-slate-100 text-slate-500"
                  }`}
                >
                  {c.status === "completed" && <CheckCircle2 size={9} strokeWidth={3} />}
                  {c.status === "current"   && <PlayCircle   size={9} strokeWidth={3} />}
                  {c.status === "completed" ? "COMPLETED" : c.status === "current" ? "CURRENT" : "UPCOMING"}
                </span>
              </div>
            </button>
          );
        })}
        <button className="shrink-0 flex items-center justify-center w-7 self-center text-slate-400 hover:text-slate-600">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function StatsRow({
  totalEmployees, calendarDays, processedCount,
  totalPayrollCost, employeeDeposit, totalDeductions, totalContributions,
}: {
  totalEmployees: number;
  calendarDays: number;
  processedCount: number;
  totalPayrollCost: number;
  employeeDeposit: number;
  totalDeductions: number;
  totalContributions: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-6 items-end">
        <StatBlock label="TOTAL EMPLOYEES" value={String(totalEmployees)} />
        <StatBlock label="CALENDAR DAYS"   value={String(calendarDays)} />
        <StatBlock label="PAYROLL PROCESSED" value={`${processedCount}/${totalEmployees} EMPLOYEES`} small />
        <div className="hidden lg:flex items-center justify-center text-[16px] font-bold text-slate-400">=</div>
        <StatBlock label="TOTAL PAYROLL COST" value={fmtInr(totalPayrollCost)} />
        <div className="hidden lg:flex items-center justify-center text-[16px] font-bold text-slate-400">+</div>
        <StatBlock label="EMPLOYEE DEPOSIT" value={fmtInr(employeeDeposit)} info />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-4 pt-4 border-t border-slate-100">
        <StatBlock label="TOTAL DEDUCTIONS"    value={fmtInr(totalDeductions)} />
        <StatBlock label="TOTAL CONTRIBUTIONS" value={fmtInr(totalContributions)} />
      </div>
    </div>
  );
}

function StatBlock({ label, value, small, info }: { label: string; value: string; small?: boolean; info?: boolean }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
        {label}
        {info && <span title="Net pay only — excludes employer contributions and one-off payments." className="text-slate-400 cursor-help">ⓘ</span>}
      </p>
      <p className={`mt-1 ${small ? "text-[14px]" : "text-[18px]"} font-bold text-slate-800 tabular-nums`}>{value}</p>
    </div>
  );
}

function StepCard({ step, title, blurb, Icon, href, onClick, done, busy, cta, disabled }: {
  step: number;
  title: string;
  blurb: string;
  Icon: typeof Calendar;
  href?: string;
  onClick?: () => void;
  done?: boolean;
  busy?: boolean;
  cta?: string;
  disabled?: boolean;
}) {
  const isLink   = !!href && !onClick;
  const isAction = !!onClick;

  const inner = (
    <div className="flex items-start gap-3">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
        done ? "bg-emerald-100 text-emerald-700" : "bg-sky-50 text-[#0f4e93]"
      }`}>
        {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">
          <span className="text-[10px] text-slate-400 font-bold">STEP {step}</span>
          <span className="truncate">{title}</span>
        </p>
        <p className="mt-0.5 text-[11.5px] text-slate-500">{blurb}</p>
        {cta && isAction && (
          <p className={`mt-1 text-[11.5px] font-semibold ${busy ? "text-slate-400" : "text-[#0f4e93]"}`}>
            {busy ? "Working…" : cta} {!busy && "→"}
          </p>
        )}
      </div>
    </div>
  );

  const baseClass = `block rounded-lg border border-slate-200 p-4 transition-colors text-left w-full ${
    disabled ? "opacity-50 cursor-not-allowed"
             : "hover:border-[#0f4e93] hover:bg-sky-50/40 cursor-pointer"
  }`;

  if (isLink) return <Link href={href!} className={baseClass}>{inner}</Link>;
  if (isAction) {
    return (
      <button type="button" onClick={() => !disabled && !busy && onClick?.()} disabled={!!disabled || !!busy} className={baseClass}>
        {inner}
      </button>
    );
  }
  return <div className={baseClass}>{inner}</div>;
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left text-[13px] font-semibold text-slate-800">
        {title}
        <span className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

// ─── Pre-Payroll Check side panel ───────────────────────────────────────────
// Slides in from the right showing every payslip for the selected run with
// gross / deductions / net so HR can sanity-check before lock. Read-only.

function PreCheckPanel({ runId, monthLabel, onClose }: { runId: number; monthLabel: string; onClose: () => void }) {
  // Pull payslips for the run. The /api/hr/payroll/payslips route already
  // supports a runId filter via query string.
  const { data: payslips = [] } = useSWR<any[]>(`/api/hr/payroll/payslips?runId=${runId}`, fetcher);
  const totalGross = payslips.reduce((s, p) => s + parseFloat(p.grossEarnings || 0), 0);
  const totalNet   = payslips.reduce((s, p) => s + parseFloat(p.netPay || 0), 0);
  const totalDed   = payslips.reduce((s, p) => s + parseFloat(p.totalDeductions || 0), 0);

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={onClose} />
      <aside className="fixed top-0 right-0 bottom-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">Pre-Payroll Check</p>
            <h3 className="text-[15px] font-semibold text-slate-800">{monthLabel} — {payslips.length} payslip(s)</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </header>

        <div className="px-5 py-3 grid grid-cols-3 gap-4 border-b border-slate-100">
          <StatBlock label="Gross"      value={fmtInr(totalGross)} small />
          <StatBlock label="Deductions" value={fmtInr(totalDed)}   small />
          <StatBlock label="Net Pay"    value={fmtInr(totalNet)}   small />
        </div>

        <div className="flex-1 overflow-y-auto">
          {payslips.length === 0 ? (
            <p className="text-center text-[12.5px] text-slate-500 py-10">No payslips yet — click "Generate payslips" first.</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-[10.5px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2">Employee</th>
                  <th className="px-5 py-2 text-right">Gross</th>
                  <th className="px-5 py-2 text-right">Deductions</th>
                  <th className="px-5 py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {payslips.map((p: any) => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-2 text-slate-800">{p.user?.name ?? `User ${p.userId}`}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{fmtInr(parseFloat(p.grossEarnings))}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-rose-700">{fmtInr(parseFloat(p.totalDeductions))}</td>
                    <td className="px-5 py-2 text-right tabular-nums font-semibold">{fmtInr(parseFloat(p.netPay))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  );
}
