"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Download, FileText, Play, CheckCircle2, Clock, Plus, X, TrendingUp, ChevronRight,
  ChevronDown, Lightbulb,
} from "lucide-react";

const MODULE_TABS = [
  { key: "home",         label: "HOME",        href: "/dashboard/hr/analytics"       },
  { key: "attendance",   label: "ATTENDANCE",  href: "/dashboard/hr/attendance"      },
  { key: "leave",        label: "LEAVE",       href: "/dashboard/hr/leaves"          },
  { key: "performance",  label: "PERFORMANCE", href: "/dashboard/hr/goals"           },
  { key: "payroll",      label: "MY FINANCES", href: "/dashboard/hr/payroll"         },
];

const PAYROLL_TABS = [
  { key: "summary",  label: "SUMMARY",    href: "/dashboard/hr/payroll/summary" },
  { key: "my-pay",   label: "MY PAY",     href: "/dashboard/hr/payroll"         },
  { key: "tax",      label: "MANAGE TAX", href: "/dashboard/hr/payroll/tax"     },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtInr(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v);
}

function fmtInrWhole(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    generated:    "bg-blue-50 text-[#008CFF]",
    sent:         "bg-emerald-50 text-emerald-600",
    acknowledged: "bg-slate-100 text-slate-600",
    draft:        "bg-amber-50 text-amber-600",
    processing:   "bg-violet-50 text-violet-600",
    completed:    "bg-emerald-50 text-emerald-600",
    paid:         "bg-green-50 text-green-600",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${map[status] || "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

function downloadPayslip(p: any, structure: any) {
  const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const fmt = (n: any) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(parseFloat(n || 0));
  const monthlyBasic  = structure ? fmt(parseFloat(structure.basic) / 12) : "—";
  const monthlyHra    = structure ? fmt(parseFloat(structure.hra) / 12) : "—";
  const specialAllow  = structure
    ? fmt(parseFloat(p.grossEarnings) - parseFloat(structure.basic) / 12 - parseFloat(structure.hra) / 12)
    : "—";

  const html = `<!DOCTYPE html>
<html><head><title>Payslip - ${MONTHS_FULL[p.month]} ${p.year}</title>
<meta charset="UTF-8"/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:12px;color:#1e293b;background:#fff}
  .header{background:#1e3a5f;color:#fff;padding:24px 32px;display:flex;align-items:center;justify-content:space-between}
  .company{font-size:20px;font-weight:700}
  .period{font-size:13px;opacity:0.8;margin-top:4px}
  .title{font-size:16px;font-weight:600;letter-spacing:2px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #e2e8f0;margin:24px 32px}
  .info-cell{padding:10px 16px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
  .info-cell:nth-child(2n){border-right:none}
  .info-label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;margin-bottom:3px}
  .info-value{font-size:13px;font-weight:600;color:#1e293b}
  .table{width:calc(100% - 64px);margin:0 32px;border-collapse:collapse}
  .table th{background:#f8fafc;padding:10px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#64748b;border:1px solid #e2e8f0}
  .table td{padding:10px 14px;border:1px solid #e2e8f0;font-size:12px}
  .table .amount{text-align:right;font-weight:600}
  .table .total-row td{background:#f1f5f9;font-weight:700}
  .net{background:#1e3a5f;color:#fff;margin:0 32px;padding:16px;border-radius:0 0 8px 8px;display:flex;justify-content:space-between;align-items:center}
  .net-label{font-size:13px;font-weight:600;letter-spacing:1px}
  .net-amount{font-size:22px;font-weight:700}
  .section-title{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700;margin:20px 32px 8px}
  .note{font-size:10px;color:#94a3b8;margin:16px 32px;text-align:center}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="header">
  <div><div class="company">NB Media Productions</div><div class="period">Payslip for ${MONTHS_FULL[p.month]} ${p.year}</div></div>
  <div class="title">SALARY SLIP</div>
</div>

<div class="info-grid">
  <div class="info-cell"><div class="info-label">Employee Name</div><div class="info-value">${p.user?.name || "—"}</div></div>
  <div class="info-cell"><div class="info-label">Email</div><div class="info-value">${p.user?.email || "—"}</div></div>
  <div class="info-cell"><div class="info-label">Pay Period</div><div class="info-value">${MONTHS_FULL[p.month]} ${p.year}</div></div>
  <div class="info-cell"><div class="info-label">Status</div><div class="info-value" style="text-transform:capitalize">${p.status}</div></div>
</div>

<div class="section-title">Earnings</div>
<table class="table">
  <tr><th>Component</th><th style="text-align:right">Amount (₹)</th></tr>
  <tr><td>Basic Salary</td><td class="amount">₹${monthlyBasic}</td></tr>
  <tr><td>House Rent Allowance (HRA)</td><td class="amount">₹${monthlyHra}</td></tr>
  <tr><td>Special Allowance</td><td class="amount">₹${specialAllow}</td></tr>
  <tr class="total-row"><td>Gross Earnings</td><td class="amount">₹${fmt(p.grossEarnings)}</td></tr>
</table>

<div class="section-title">Deductions</div>
<table class="table">
  <tr><th>Component</th><th style="text-align:right">Amount (₹)</th></tr>
  <tr><td>Provident Fund (Employee)</td><td class="amount">₹${fmt(p.pfEmployee)}</td></tr>
  <tr><td>TDS / Income Tax</td><td class="amount">₹${fmt(p.tds)}</td></tr>
  <tr><td>Professional Tax</td><td class="amount">₹${fmt(p.professionalTax)}</td></tr>
  <tr class="total-row"><td>Total Deductions</td><td class="amount">₹${fmt(p.totalDeductions)}</td></tr>
</table>

<div class="net">
  <span class="net-label">NET PAY</span>
  <span class="net-amount">₹${fmt(p.netPay)}</span>
</div>
<p class="note">This is a computer-generated payslip and does not require a physical signature.</p>
</body></html>`;

  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 400);
}

export default function PayrollPage() {
  const { data: session } = useSession();
  const user    = session?.user as any;
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper || user?.orgLevel === "hr_manager";

  const searchParams = useSearchParams();
  const initialSubTab = (() => {
    const t = searchParams?.get("tab");
    if (t === "pay-slips" || t === "income-tax" || t === "admin" || t === "my-salary") return t;
    return "my-salary" as const;
  })();
  const [subTab, setSubTab] = useState<"my-salary"|"pay-slips"|"income-tax"|"admin">(initialSubTab);
  useEffect(() => {
    const t = searchParams?.get("tab");
    if (t === "pay-slips" || t === "income-tax" || t === "admin" || t === "my-salary") {
      setSubTab(t);
    }
  }, [searchParams]);
  const [showBreakup, setShowBreakup] = useState(false);

  // Admin-only state for modals
  const [adminTab, setAdminTab] = useState<"runs"|"structures">("runs");
  const [showNewRun, setShowNewRun] = useState(false);
  const [showNewStructure, setShowNewStructure] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);
  const [form, setForm] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });
  const [structureForm, setStructureForm] = useState({
    userId: "", ctc: "", basic: "", hra: "", specialAllowance: "",
    pfEmployee: "", pfEmployer: "", tds: "", professionalTax: "", effectiveFrom: "",
  });

  const { data: myPayslips = [] }  = useSWR("/api/hr/payroll/payslips", fetcher);
  const { data: myStructure }      = useSWR("/api/hr/payroll/salary-structure", fetcher);
  const { data: payrollRuns = [] } = useSWR(isAdmin ? "/api/hr/payroll/runs" : null, fetcher);
  const { data: employees = [] }   = useSWR(isAdmin ? "/api/hr/employees" : null, fetcher);

  const annualCtc  = parseFloat(myStructure?.ctc || 0);
  const monthlyCtc = annualCtc / 12;

  const effectiveFrom = myStructure?.effectiveFrom
    ? new Date(myStructure.effectiveFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : "—";

  // Earnings rows for the breakup modal / salary card.
  const earningsRows = useMemo(() => {
    if (!myStructure) return [];
    const basic   = parseFloat(myStructure.basic || 0);
    const hra     = parseFloat(myStructure.hra || 0);
    const special = parseFloat(myStructure.specialAllowance || 0);
    const rows: { label: string; annual: number }[] = [];
    if (basic)   rows.push({ label: "Basic Salary",              annual: basic   });
    if (hra)     rows.push({ label: "House Rent Allowance",      annual: hra     });
    if (special) rows.push({ label: "Special Allowance",         annual: special });
    // If the structure is flat (single stipend), fall back to one row covering CTC.
    if (rows.length === 0 && annualCtc > 0) {
      rows.push({ label: "Stipend", annual: annualCtc });
    }
    return rows;
  }, [myStructure, annualCtc]);

  const totalAnnual  = earningsRows.reduce((s, r) => s + r.annual, 0);
  const totalMonthly = totalAnnual / 12;

  // Admin actions
  const createRun = async () => {
    const res = await fetch("/api/hr/payroll/runs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) { setShowNewRun(false); mutate("/api/hr/payroll/runs"); }
    else alert((await res.json()).error);
  };
  const generatePayslips = async (runId: number) => {
    setGenerating(runId);
    const res = await fetch("/api/hr/payroll/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    setGenerating(null);
    if (res.ok) mutate("/api/hr/payroll/runs");
    else alert((await res.json()).error);
  };
  const saveStructure = async () => {
    const res = await fetch("/api/hr/payroll/salary-structure", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(structureForm),
    });
    if (res.ok) { setShowNewStructure(false); mutate("/api/hr/payroll/salary-structure"); }
    else alert((await res.json()).error);
  };

  const subTabs: { key: typeof subTab; label: string }[] = [
    { key: "my-salary",  label: "My Salary"  },
    { key: "pay-slips",  label: "Pay Slips"  },
    { key: "income-tax", label: "Income Tax" },
    ...(isAdmin ? [{ key: "admin" as const, label: "Admin" }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#f4f7f8]">

      {/* Module-level tabs (HR modules) */}
      <div className="flex items-center bg-white border-b border-slate-200 px-4 overflow-x-auto">
        {MODULE_TABS.map(t => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest border-b-2 transition-colors whitespace-nowrap ${
              t.key === "payroll"
                ? "border-[#008CFF] text-[#008CFF]"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}>{t.label}</Link>
        ))}
      </div>

      {/* Payroll-area tabs: SUMMARY / MY PAY / MANAGE TAX */}
      <div className="flex items-center bg-white px-4">
        {PAYROLL_TABS.map(t => (
          <Link key={t.key} href={t.href}
            className={`relative px-4 py-3 text-[11px] font-bold tracking-widest transition-colors whitespace-nowrap ${
              t.key === "my-pay"
                ? "text-[#0f4e93]"
                : "text-slate-400 hover:text-slate-600"
            }`}>
            {t.label}
            {t.key === "my-pay" && (
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#0f4e93]" />
            )}
          </Link>
        ))}
      </div>

      {/* My Pay sub-tabs */}
      <div className="flex items-center gap-6 bg-white border-b border-slate-200 px-6">
        {subTabs.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`relative py-3 text-[13px] font-semibold transition-colors whitespace-nowrap ${
              subTab === t.key ? "text-slate-800" : "text-slate-400 hover:text-slate-600"
            }`}>
            {t.label}
            {subTab === t.key && (
              <span className="absolute left-0 right-0 bottom-0 h-[2px] bg-[#0f4e93] rounded-t" />
            )}
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-6xl space-y-5 p-6">

        {/* ══════════════════════  My Salary  ══════════════════════ */}
        {subTab === "my-salary" && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Current compensation</p>
                <p className="mt-2 text-[18px] font-semibold text-slate-800">
                  {myStructure ? `INR ${fmtInrWhole(annualCtc)} / Annum` : "Not assigned"}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-8">
                  <div>
                    <p className="text-[14px] font-semibold text-slate-800">Payroll</p>
                  </div>
                  <div>
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Pay cycle</p>
                    <p className="mt-1 text-[14px] font-medium text-slate-800">Monthly</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
              <h3 className="text-[15px] font-semibold text-slate-800 mb-4">Salary Timeline</h3>

              {/* Tax regime note */}
              <div className="mb-5 flex items-start gap-2 rounded-lg bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-100">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-[13px] text-amber-900">
                  Your Income and tax liability is being computed as per New Tax Regime.
                </p>
              </div>

              {!myStructure ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-[13px] text-slate-500">No salary structure assigned yet</p>
                  <p className="mt-1 text-[11.5px] text-slate-400">Please ask HR to assign you a salary structure.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                      <TrendingUp className="h-4 w-4" />
                    </span>
                    <p className="text-[14px] font-semibold text-slate-800">Salary Revision</p>
                    <p className="text-[12px] text-slate-400">Effective {effectiveFrom}</p>
                    <span className="inline-flex items-center rounded bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-600 ring-1 ring-inset ring-sky-200">
                      Current
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                    <div className="flex items-center gap-6 text-slate-700">
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                      <div>
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Regular salary</p>
                        <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalAnnual)}</p>
                      </div>
                      <span className="text-slate-400 text-[15px] font-semibold">=</span>
                      <div>
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Total</p>
                        <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalAnnual)}</p>
                      </div>
                    </div>
                    <button onClick={() => setShowBreakup(true)}
                      className="text-[13px] font-semibold text-sky-600 hover:underline">
                      View Salary breakup
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════  Pay Slips  ══════════════════════ */}
        {subTab === "pay-slips" && (
          <PaySlipsView payslips={myPayslips} structure={myStructure} />
        )}

        {/* ══════════════════════  Income Tax  ══════════════════════ */}
        {subTab === "income-tax" && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <h3 className="text-[15px] font-semibold text-slate-800 mb-4">Income Tax Summary</h3>
            {!myStructure ? (
              <p className="text-[13px] text-slate-500">No salary structure assigned yet — nothing to compute.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Annual CTC",              value: fmtInrWhole(annualCtc) },
                  { label: "TDS / Income Tax (FY)",   value: fmtInrWhole(myStructure.tds) },
                  { label: "Professional Tax (₹/mo)", value: fmtInrWhole(myStructure.professionalTax) },
                  { label: "PF — Employee (FY)",      value: fmtInrWhole(myStructure.pfEmployee) },
                  { label: "PF — Employer (FY)",      value: fmtInrWhole(myStructure.pfEmployer) },
                  { label: "Net Pay (Annual)",        value: fmtInrWhole(annualCtc - parseFloat(myStructure.pfEmployee || 0) - parseFloat(myStructure.tds || 0) - parseFloat(myStructure.professionalTax || 0) * 12) },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{c.label}</p>
                    <p className="mt-1.5 text-[16px] font-semibold text-slate-800">INR {c.value}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-5 text-[11.5px] text-slate-400">
              Regime: New Tax Regime. Figures are illustrative — based on the assigned salary structure only.
            </p>
          </div>
        )}

        {/* ══════════════════════  Admin (HR / CEO)  ══════════════════════ */}
        {subTab === "admin" && isAdmin && (
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-4">
                <h3 className="text-[13px] font-bold text-slate-800">Payroll Management</h3>
                <div className="flex items-center gap-0 bg-slate-100 rounded-lg p-0.5">
                  {(["runs","structures"] as const).map(t => (
                    <button key={t} onClick={() => setAdminTab(t)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                        adminTab === t ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-500"
                      }`}>
                      {t === "runs" ? "Payroll Runs" : "Salary Structures"}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={() => adminTab === "runs" ? setShowNewRun(true) : setShowNewStructure(true)}
                className="flex items-center gap-1.5 h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[12px] font-semibold transition-colors">
                <Plus className="w-3.5 h-3.5" />
                {adminTab === "runs" ? "New Payroll Run" : "Assign Structure"}
              </button>
            </div>

            {adminTab === "runs" ? (
              payrollRuns.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-[13px] text-slate-500">No payroll runs yet</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {["Period","Status","Employees","Total CTC","Total Net Pay","Actions"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payrollRuns.map((r: any) => (
                      <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-5 py-3 text-[13px] font-medium text-slate-800">{MONTHS[r.month]} {r.year}</td>
                        <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                        <td className="px-5 py-3 text-[13px] text-slate-600">{r._count?.payslips ?? 0}</td>
                        <td className="px-5 py-3 text-[13px] text-slate-700">₹{fmtInrWhole(r.totalCTC)}</td>
                        <td className="px-5 py-3 text-[13px] font-bold text-emerald-600">₹{fmtInrWhole(r.totalNetPay)}</td>
                        <td className="px-5 py-3">
                          {(r.status === "draft" || r.status === "processing") && (
                            <button onClick={() => generatePayslips(r.id)}
                              disabled={generating === r.id}
                              className="flex items-center gap-1 h-7 px-3 bg-[#008CFF]/10 hover:bg-[#008CFF]/20 text-[#008CFF] rounded text-[11px] font-semibold transition-colors disabled:opacity-50">
                              {generating === r.id
                                ? <><Clock className="w-3 h-3 animate-spin" />Processing…</>
                                : <><Play className="w-3 h-3" />Generate</>}
                            </button>
                          )}
                          {r.status === "completed" && (
                            <span className="flex items-center gap-1 text-[12px] text-emerald-500">
                              <CheckCircle2 className="w-3.5 h-3.5" />Done
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : (
              <div className="p-5">
                <p className="text-[13px] text-slate-500">Manage salary structures via the "Assign Structure" button above.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════  Salary Breakup Modal  ═══════════════ */}
      {showBreakup && myStructure && (
        <div className="fixed inset-0 z-50 flex bg-black/40 backdrop-blur-sm">
          <div className="flex-1 bg-white flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-[15px] font-semibold text-slate-800">Salary Breakup for INR {fmtInrWhole(totalAnnual)}</h3>
              <button onClick={() => setShowBreakup(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Earnings</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Monthly</th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Annually</th>
                  </tr>
                </thead>
                <tbody>
                  {earningsRows.map((r) => (
                    <tr key={r.label} className="border-b border-slate-100">
                      <td className="px-4 py-3 text-slate-800">{r.label}</td>
                      <td className="px-4 py-3 text-slate-800">INR {fmtInr(r.annual / 12)}</td>
                      <td className="px-4 py-3 text-slate-800">INR {fmtInr(r.annual)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <td className="px-4 py-3 font-semibold text-slate-800">Total Earnings</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">INR {fmtInr(totalMonthly)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">INR {fmtInr(totalAnnual)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3">
                <div className="grid grid-cols-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Net Pay</p>
                  <p className="text-[13px] font-semibold text-slate-800">INR {fmtInr(totalMonthly)}</p>
                  <p className="text-[13px] font-semibold text-slate-800">INR {fmtInr(totalAnnual)}</p>
                </div>
              </div>

              <div className="mt-5 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div>
                  <p className="text-[12.5px] font-semibold text-slate-800">Note</p>
                  <p className="mt-0.5 text-[12.5px] text-slate-600">
                    NOTE: Net Pay above does not include Taxes or Other deductions (if any).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Version History sidebar */}
          <aside className="w-[280px] bg-[#f4f7f8] border-l border-slate-200 p-5 overflow-y-auto">
            <h4 className="text-[13.5px] font-semibold text-slate-800">Version History</h4>
            <p className="mt-0.5 text-[11.5px] text-slate-500">View previous versions of salary structures</p>

            <div className="mt-4 rounded-lg bg-sky-50 border border-sky-100 p-3">
              <p className="text-[12.5px] font-semibold text-slate-800">{effectiveFrom}</p>
              <p className="mt-0.5 text-[11.5px] text-slate-500">Original salary structure</p>
              <span className="mt-2 inline-flex items-center rounded bg-sky-100 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-sky-700 ring-1 ring-inset ring-sky-200">
                Current Version
              </span>
            </div>
          </aside>
        </div>
      )}

      {/* Modal: New Payroll Run */}
      {showNewRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[360px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800">New Payroll Run</h3>
              <button onClick={() => setShowNewRun(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Month</label>
                <select value={form.month} onChange={e => setForm(f => ({ ...f, month: parseInt(e.target.value) }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]">
                  {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Year</label>
                <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value) }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewRun(false)}
                className="flex-1 h-9 border border-slate-200 rounded-lg text-[13px] text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={createRun}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold transition-colors">
                Create Run
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Assign Salary Structure */}
      {showNewStructure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800">Assign Salary Structure</h3>
              <button onClick={() => setShowNewStructure(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Employee</label>
                <select value={structureForm.userId} onChange={e => setStructureForm(f => ({ ...f, userId: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]">
                  <option value="">Select employee…</option>
                  {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              {[
                { field: "ctc",              label: "Annual CTC (₹)"         },
                { field: "basic",            label: "Annual Basic (₹)"       },
                { field: "hra",              label: "Annual HRA (₹)"         },
                { field: "specialAllowance", label: "Special Allowance (₹)"  },
                { field: "pfEmployee",       label: "PF Employee Annual (₹)" },
                { field: "pfEmployer",       label: "PF Employer Annual (₹)" },
                { field: "tds",              label: "Annual TDS (₹)"         },
                { field: "professionalTax",  label: "Professional Tax/mo (₹)"},
              ].map(({ field, label }) => (
                <div key={field}>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</label>
                  <input type="number" value={(structureForm as any)[field]}
                    onChange={e => setStructureForm(f => ({ ...f, [field]: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Effective From</label>
                <input type="date" value={structureForm.effectiveFrom}
                  onChange={e => setStructureForm(f => ({ ...f, effectiveFrom: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-[13px]" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewStructure(false)}
                className="flex-1 h-9 border border-slate-200 rounded-lg text-[13px] text-slate-600">
                Cancel
              </button>
              <button onClick={saveStructure}
                className="flex-1 h-9 bg-[#008CFF] hover:bg-[#0077dd] text-white rounded-lg text-[13px] font-semibold">
                Save Structure
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Pay Slips — Keka-style two-pane layout: year selector + month list on the
// left, inline payslip preview on the right.
// ══════════════════════════════════════════════════════════════════════════════
function PaySlipsView({ payslips, structure }: { payslips: any[]; structure: any }) {
  const { data: summary } = useSWR<{ profile: any }>("/api/hr/payroll/summary", fetcher);
  const profile = summary?.profile ?? null;

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const p of payslips) set.add(p.year);
    const sorted = Array.from(set).sort((a, b) => b - a);
    return sorted.length > 0 ? sorted : [new Date().getFullYear()];
  }, [payslips]);

  const [selectedYear, setSelectedYear] = useState<number>(years[0]);
  useEffect(() => {
    if (!years.includes(selectedYear)) setSelectedYear(years[0]);
  }, [years, selectedYear]);

  const monthsInYear = useMemo(
    () => payslips.filter((p: any) => p.year === selectedYear).sort((a: any, b: any) => b.month - a.month),
    [payslips, selectedYear]
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => {
    if (monthsInYear.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !monthsInYear.find((p: any) => p.id === selectedId)) {
      setSelectedId(monthsInYear[0].id);
    }
  }, [monthsInYear, selectedId]);

  const active = monthsInYear.find((p: any) => p.id === selectedId) || null;

  const maskedAcct = (v?: string | null) =>
    !v ? "—" : String(v).length <= 4 ? String(v) : String(v);
  const maskedPan = (v?: string | null) => v || "—";

  const fullName =
    profile?.firstName || profile?.lastName
      ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
      : profile?.name || "—";

  return (
    <div className="-mt-5">
      {/* Header row */}
      <div className="px-6 pb-4 pt-2">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[18px] font-semibold text-slate-800">Pay Slips</h2>
              <Download className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-1 text-[12.5px] text-slate-500">
              Here you can manage all generated payslips for applicable years.
            </p>
          </div>
          {active ? (
            <button
              onClick={() => downloadPayslip(active, structure)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-sky-300 text-sky-600 hover:bg-sky-50 text-[13px] font-semibold"
            >
              {MONTHS_FULL[active.month]} {active.year} Pay Slip
              <Download className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5 px-6">
        {/* Left: year dropdown + month list */}
        <aside className="col-span-12 md:col-span-3 space-y-4">
          <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 py-2.5 pr-9 text-[13px] font-medium text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              {years.map((y) => (
                <option key={y} value={y}>Year {y}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          </div>

          <div className="rounded-lg bg-white overflow-hidden shadow-[0_1px_3px_rgba(15,23,42,0.04)] border border-slate-200">
            <p className="bg-slate-100 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              Payslips
            </p>
            {monthsInYear.length === 0 ? (
              <p className="px-4 py-6 text-[12.5px] text-slate-400">No payslips for {selectedYear}.</p>
            ) : (
              <ul>
                {monthsInYear.map((p: any) => {
                  const isSel = p.id === selectedId;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setSelectedId(p.id)}
                        className={`w-full text-left px-4 py-3 text-[13px] transition-colors ${
                          isSel
                            ? "bg-sky-50 text-sky-700 font-semibold"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {MONTHS_FULL[p.month]} {p.year}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Right: preview */}
        <section className="col-span-12 md:col-span-9">
          <div className="rounded-t-lg bg-[#3c4656] px-6 py-3 text-white text-[13px] font-medium">
            {active ? `${MONTHS_FULL[active.month]} ${active.year}` : "—"}
          </div>
          <div className="bg-[#2a3140] px-6 py-8 rounded-b-lg min-h-[600px]">
            {active ? (
              <div className="mx-auto max-w-3xl rounded bg-white p-10 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="text-[22px] font-bold text-slate-800 tracking-wide">
                      PAYSLIP <span className="font-normal">{MONTHS_FULL[active.month].toUpperCase()} {active.year}</span>
                    </h1>
                    <p className="mt-3 text-[13px] font-semibold text-slate-700">NB MEDIA PRODUCTIONS PRIVATE LIMITED</p>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">
                      1st Floor, 209, NB Media, Model Town Main Road,<br />
                      Bathinda, Punjab, 151001.
                    </p>
                  </div>
                  <div className="flex h-14 w-14 items-center justify-center rounded-md bg-white ring-1 ring-slate-200 overflow-hidden">
                    <img src="/logo.png" alt="NB" className="h-11 w-11 object-contain" />
                  </div>
                </div>

                <h2 className="mt-8 text-[14px] font-bold text-slate-800 border-b border-slate-200 pb-2">
                  {fullName.toUpperCase()}
                </h2>

                <div className="mt-4 grid grid-cols-4 gap-x-6 gap-y-5">
                  <PayslipField label="Employee Number"  value={profile?.employeeId || "—"} />
                  <PayslipField label="Date Joined"      value={formatDate(profile?.joiningDate)} />
                  <PayslipField label="Department"       value={profile?.department || "—"} />
                  <PayslipField label="Designation"      value={profile?.designation || "—"} />

                  <PayslipField label="Date of Birth"    value={formatDate(profile?.dateOfBirth)} />
                  <PayslipField label="Location"         value={profile?.city || "—"} />
                  <PayslipField label="Payment Mode"     value="Bank Transfer" />
                  <PayslipField label="Bank"             value={profile?.bankName || "—"} />

                  <PayslipField label="Bank IFSC"        value={profile?.bankIfsc || "—"} />
                  <PayslipField label="Bank Account"     value={maskedAcct(profile?.bankAccountNumber)} />
                  <PayslipField label="Monthly Salary"   value={fmtInrWhole(active.grossEarnings)} />
                  <PayslipField label="PAN Number"       value={maskedPan(profile?.panNumber)} />
                </div>

                {/* Salary Details */}
                <h3 className="mt-10 text-[13px] font-bold text-slate-800 border-b border-slate-200 pb-2">
                  SALARY DETAILS
                </h3>
                <div className="mt-4 grid grid-cols-4 gap-x-6">
                  <PayslipField label="Actual Payable Days" value={String(active.presentDays ?? "—")} />
                  <PayslipField label="Total Working Days"  value={String(active.workingDays ?? "—")} />
                  <PayslipField label="Loss of Pay Days"    value={String(active.lopDays ?? 0)} />
                  <PayslipField label="Days Payable"        value={String((active.workingDays ?? 0) - (active.lopDays ?? 0))} />
                </div>

                {/* Earnings */}
                <h3 className="mt-8 text-[13px] font-bold text-slate-800 border-b border-slate-200 pb-2">
                  EARNINGS
                </h3>
                <table className="mt-3 w-full text-[13px]">
                  <tbody>
                    {renderEarnings(active, structure).map((row) => (
                      <tr key={row.label} className="border-b border-slate-100">
                        <td className="py-2 text-slate-700">{row.label}</td>
                        <td className="py-2 text-right text-slate-800 font-medium">{row.value}</td>
                      </tr>
                    ))}
                    <tr className="border-b-2 border-slate-300">
                      <td className="py-2 font-semibold text-slate-800">Total Earnings (A)</td>
                      <td className="py-2 text-right font-semibold text-slate-800">{fmtInr(active.grossEarnings)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Deductions */}
                <h3 className="mt-6 text-[13px] font-bold text-slate-800 border-b border-slate-200 pb-2">
                  DEDUCTIONS
                </h3>
                <table className="mt-3 w-full text-[13px]">
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 text-slate-700">Provident Fund (Employee)</td>
                      <td className="py-2 text-right text-slate-800 font-medium">{fmtInr(active.pfEmployee)}</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 text-slate-700">TDS / Income Tax</td>
                      <td className="py-2 text-right text-slate-800 font-medium">{fmtInr(active.tds)}</td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <td className="py-2 text-slate-700">Professional Tax</td>
                      <td className="py-2 text-right text-slate-800 font-medium">{fmtInr(active.professionalTax)}</td>
                    </tr>
                    <tr className="border-b-2 border-slate-300">
                      <td className="py-2 font-semibold text-slate-800">Total Deductions (B)</td>
                      <td className="py-2 text-right font-semibold text-slate-800">{fmtInr(active.totalDeductions)}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="mt-5 flex items-center justify-between rounded bg-[#1e3a5f] px-5 py-3 text-white">
                  <span className="text-[13px] font-semibold tracking-wide">NET PAY (A − B)</span>
                  <span className="text-[18px] font-bold">{fmtInr(active.netPay)}</span>
                </div>

                <p className="mt-4 text-[10.5px] text-slate-400 text-center">
                  This is a computer-generated payslip and does not require a physical signature.
                </p>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl rounded bg-white p-10 text-center">
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-[13px] text-slate-500">No payslip selected</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function PayslipField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className="mt-1.5 text-[12.5px] font-medium text-slate-800">{value}</p>
    </div>
  );
}

const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function renderEarnings(p: any, structure: any): { label: string; value: string }[] {
  const gross = parseFloat(p.grossEarnings || 0);
  if (!structure) {
    return [{ label: "Stipend", value: fmtInr(gross) }];
  }
  const basic   = parseFloat(structure.basic   || 0) / 12;
  const hra     = parseFloat(structure.hra     || 0) / 12;
  const special = Math.max(0, gross - basic - hra);
  const rows: { label: string; value: string }[] = [];
  if (basic)   rows.push({ label: "Basic Salary",              value: fmtInr(basic) });
  if (hra)     rows.push({ label: "House Rent Allowance",      value: fmtInr(hra)   });
  if (special) rows.push({ label: "Special Allowance",         value: fmtInr(special) });
  if (rows.length === 0) rows.push({ label: "Stipend", value: fmtInr(gross) });
  return rows;
}
