"use client";

// Inner content of the "My Finances → My Pay" page. Same component
// drives both the employee's own view (userId omitted, defaults to
// self via the API) and HR's view of another employee (userId passed
// in from the people-detail Finances tab).

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import SelectField from "@/components/ui/SelectField";
import {
  Download, FileText, X, TrendingUp, ChevronRight, ChevronDown, Lightbulb, Paperclip,
} from "lucide-react";

type Props = { userId?: number; initialSub?: SubTab };
type SubTab = "my-salary" | "pay-slips" | "income-tax";
type BonusRow = {
  id: number;
  amount: string;
  reason: string | null;
  effectiveDate: string;
  bonusType: string | null;
  paymentStatus: string;
  attachmentName: string | null;
};

const MONTHS_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function fmtInr(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(v);
}
function fmtInrWhole(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function downloadPayslip(p: any, structure: any) {
  const fmt = (n: any) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(parseFloat(n || 0));
  const isIntern = structure?.salaryType === "intern";

  let earningsRowsHtml = "";
  if (isIntern || !structure) {
    earningsRowsHtml = `<tr><td>Monthly Stipend</td><td class="amount">₹${fmt(p.grossEarnings)}</td></tr>`;
  } else {
    const basic   = parseFloat(structure.basic               || 0) / 12;
    const hra     = parseFloat(structure.hra                 || 0) / 12;
    const da      = parseFloat(structure.dearnessAllowance   || 0) / 12;
    const conv    = parseFloat(structure.conveyanceAllowance || 0) / 12;
    const medical = parseFloat(structure.medicalAllowance    || 0) / 12;
    const fixed   = basic + hra + da + conv + medical;
    const special = Math.max(0, parseFloat(p.grossEarnings || 0) - fixed);
    const rows: [string, number][] = [];
    if (basic)   rows.push(["Basic Salary",              basic]);
    if (hra)     rows.push(["House Rent Allowance (HRA)", hra]);
    if (da)      rows.push(["Dearness Allowance",        da]);
    if (conv)    rows.push(["Conveyance Allowance",      conv]);
    if (medical) rows.push(["Medical Allowance",         medical]);
    if (special) rows.push(["Special Allowance",         special]);
    earningsRowsHtml = rows
      .map(([label, value]) => `<tr><td>${label}</td><td class="amount">₹${fmt(value)}</td></tr>`)
      .join("\n       ");
  }

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
  ${earningsRowsHtml}
  <tr class="total-row"><td>Gross Earnings</td><td class="amount">₹${fmt(p.grossEarnings)}</td></tr>
</table>

<div class="section-title">Deductions</div>
<table class="table">
  <tr><th>Component</th><th style="text-align:right">Amount (₹)</th></tr>
  <tr><td>Provident Fund (Employee)</td><td class="amount">₹${fmt(p.pfEmployee)}</td></tr>
  <tr><td>TDS / Income Tax</td><td class="amount">₹${fmt(p.tds)}</td></tr>
  <tr><td>Professional Tax</td><td class="amount">₹${fmt(p.professionalTax)}</td></tr>
  ${parseFloat(p.additionalTax || 0) > 0 ? `<tr><td>Additional Tax</td><td class="amount">₹${fmt(p.additionalTax)}</td></tr>` : ""}
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

export default function MyPayPanel({ userId, initialSub = "my-salary" }: Props) {
  const [subTab, setSubTab] = useState<SubTab>(initialSub);
  const [showBreakup, setShowBreakup] = useState(false);
  // Salary Revision drill-down. Collapsed by default — clicking the
  // chevron expands into the regular-salary detail + per-bonus list.
  const [revisionOpen, setRevisionOpen] = useState(false);

  const qs = userId ? `?userId=${userId}` : "";
  const { data: myPayslips = [] } = useSWR<any[]>(`/api/hr/payroll/payslips${qs}`, fetcher);
  const { data: myStructure }     = useSWR<any>(`/api/hr/payroll/salary-structure${qs}`, fetcher);
  // Bonuses surface inline on the Salary Revision row (+ BONUS = TOTAL)
  // and as itemised rows in the expanded view. Hidden entirely when the
  // user has no recorded bonuses.
  const { data: bonusData } = useSWR<{ items: BonusRow[] }>(`/api/hr/payroll/bonus${qs}`, fetcher);
  const bonuses = bonusData?.items ?? [];
  const totalBonus = bonuses.reduce((s, b) => s + parseFloat(b.amount || "0"), 0);
  const hasBonuses = bonuses.length > 0 && totalBonus > 0;

  const annualCtc = parseFloat(myStructure?.ctc || 0);

  const effectiveFrom = myStructure?.effectiveFrom
    ? new Date(myStructure.effectiveFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : "—";

  const earningsRows = useMemo(() => {
    if (!myStructure) return [];
    const isIntern = myStructure.salaryType === "intern";
    const basic   = parseFloat(myStructure.basic || 0);
    const hra     = parseFloat(myStructure.hra || 0);
    const da      = parseFloat(myStructure.dearnessAllowance   || 0);
    const conv    = parseFloat(myStructure.conveyanceAllowance || 0);
    const medical = parseFloat(myStructure.medicalAllowance    || 0);
    const special = parseFloat(myStructure.specialAllowance || 0);
    const rows: { label: string; annual: number }[] = [];
    if (isIntern) {
      // Interns are paid a flat stipend; the DB only stores the annual
      // CTC. The breakup modal displays a synthetic Basic / HRA / Special
      // split (50 / 20 / 30) so the surface matches the regular-employee
      // layout — the actual stipend payment is unaffected.
      if (annualCtc > 0) {
        const basicAnnual = Math.round(annualCtc * 0.50);
        const hraAnnual   = Math.round(annualCtc * 0.20);
        const specialAnnual = annualCtc - basicAnnual - hraAnnual;
        rows.push({ label: "Basic Salary",         annual: basicAnnual   });
        rows.push({ label: "House Rent Allowance", annual: hraAnnual     });
        rows.push({ label: "Special Allowance",    annual: specialAnnual });
      }
      return rows;
    }
    if (basic)   rows.push({ label: "Basic Salary",         annual: basic   });
    if (hra)     rows.push({ label: "House Rent Allowance", annual: hra     });
    if (da)      rows.push({ label: "Dearness Allowance",   annual: da      });
    if (conv)    rows.push({ label: "Conveyance Allowance", annual: conv    });
    if (medical) rows.push({ label: "Medical Allowance",    annual: medical });
    if (special) rows.push({ label: "Special Allowance",    annual: special });
    if (rows.length === 0 && annualCtc > 0) {
      rows.push({ label: "Monthly Stipend", annual: annualCtc });
    }
    return rows;
  }, [myStructure, annualCtc]);

  const totalAnnual  = earningsRows.reduce((s, r) => s + r.annual, 0);
  const totalMonthly = totalAnnual / 12;

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "my-salary",  label: userId ? "Salary" : "My Salary" },
    { key: "pay-slips",  label: "Pay Slips"  },
    { key: "income-tax", label: "Income Tax" },
  ];

  return (
    <div>
      {/* My Pay sub-tabs */}
      <div className="flex items-center gap-6 bg-white border-b border-slate-200 px-6 -mx-6 mb-5">
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

      <div className="space-y-5">
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

                  <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                    {/* Compact row — REGULAR SALARY [+ BONUS] = TOTAL. Bonus
                        only appears when the user actually has bonuses on
                        record; otherwise it's a clean two-up. */}
                    <div className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="flex items-center gap-6 text-slate-700">
                        <button onClick={() => setRevisionOpen(o => !o)}
                          className="text-slate-400 hover:text-slate-600 transition-colors"
                          title={revisionOpen ? "Hide details" : "Show details"}>
                          {revisionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <div>
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Regular salary</p>
                          <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalAnnual)}</p>
                        </div>
                        {hasBonuses && (
                          <>
                            <span className="text-slate-400 text-[15px] font-semibold">+</span>
                            <div>
                              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Bonus</p>
                              <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalBonus)}</p>
                            </div>
                          </>
                        )}
                        <span className="text-slate-400 text-[15px] font-semibold">=</span>
                        <div>
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Total</p>
                          <p className="mt-1 text-[13.5px] font-semibold text-slate-800">INR {fmtInrWhole(totalAnnual + totalBonus)}</p>
                        </div>
                      </div>
                      <button onClick={() => setShowBreakup(true)}
                        className="text-[13px] font-semibold text-sky-600 hover:underline">
                        View Salary breakup
                      </button>
                    </div>

                    {/* Expanded detail — regular salary breakdown always; the
                        bonus list appears only when bonuses are recorded. */}
                    {revisionOpen && (
                      <>
                        <div className="bg-slate-100 px-5 py-2 border-t border-slate-200 flex items-center justify-between">
                          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">Regular salary</span>
                          <span className="text-[12px] font-medium text-slate-700">INR {fmtInrWhole(totalAnnual)} / Annum</span>
                        </div>
                        <div className="bg-white grid grid-cols-2 gap-y-3 px-5 py-4">
                          <div>
                            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Salary per month</p>
                            <p className="mt-1 text-[13px] font-medium text-slate-800">INR {fmtInrWhole(totalAnnual / 12)}</p>
                          </div>
                          <div>
                            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">Effective from</p>
                            <p className="mt-1 text-[13px] font-medium text-slate-800">{effectiveFrom}</p>
                          </div>
                        </div>

                        {hasBonuses && (
                          <>
                            <div className="bg-slate-100 px-5 py-2 border-t border-slate-200 flex items-center justify-between">
                              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-500">Bonus</span>
                              <span className="text-[12px] font-medium text-slate-700">INR {fmtInrWhole(totalBonus)}</span>
                            </div>
                            {bonuses.map(b => (
                              <BonusDetailRow key={b.id} bonus={b} />
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ══════════════════════  Pay Slips  ══════════════════════ */}
        {subTab === "pay-slips" && (
          <PaySlipsView payslips={myPayslips} structure={myStructure} userId={userId} />
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
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Pay Slips — two-pane (year/month rail + inline preview).
// The "structure" prop is the SalaryStructure record for the SAME user as the
// payslips list. The "userId" prop scopes the summary fetch so HR-side
// rendering pulls the viewed employee's profile, not the logged-in HR user's.
// ──────────────────────────────────────────────────────────────────────────────
function PaySlipsView({ payslips, structure, userId }: { payslips: any[]; structure: any; userId?: number }) {
  const summaryUrl = userId ? `/api/hr/payroll/summary?userId=${userId}` : "/api/hr/payroll/summary";
  const { data: summary } = useSWR<{ profile: any }>(summaryUrl, fetcher);
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

  const maskedAcct = (v?: string | null) => !v ? "—" : String(v);
  const maskedPan  = (v?: string | null) => v || "—";

  const fullName =
    profile?.firstName || profile?.lastName
      ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
      : profile?.name || "—";

  return (
    <div>
      {/* Header row */}
      <div className="pb-4">
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

      <div className="grid grid-cols-12 gap-5">
        <aside className="col-span-12 md:col-span-3 space-y-4">
          <div className="relative">
            <SelectField
              value={String(selectedYear)}
              onChange={(v) => setSelectedYear(parseInt(v))}
              options={years.map((y) => ({ value: String(y), label: `Year ${y}` }))}
              className="w-full rounded-lg border border-slate-200 bg-white h-10 px-4 text-[13px] font-medium text-slate-800 shadow-sm"
            />
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

        <section className="col-span-12 md:col-span-9">
          {active ? (
            <>
              <div className="rounded-t-lg bg-[#3c4656] px-6 py-3 text-white text-[13px] font-medium">
                {`${MONTHS_FULL[active.month]} ${active.year}`}
              </div>
              <div className="bg-[#2a3140] px-6 py-8 rounded-b-lg">
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
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

                  <h3 className="mt-10 text-[13px] font-bold text-slate-800 border-b border-slate-200 pb-2">SALARY DETAILS</h3>
                  <div className="mt-4 grid grid-cols-4 gap-x-6">
                    <PayslipField label="Actual Payable Days" value={String(active.presentDays ?? "—")} />
                    <PayslipField label="Total Working Days"  value={String(active.workingDays ?? "—")} />
                    <PayslipField label="Loss of Pay Days"    value={String(active.lopDays ?? 0)} />
                    <PayslipField label="Days Payable"        value={String((parseFloat(active.workingDays ?? 0)) - (parseFloat(active.lopDays ?? 0)))} />
                  </div>

                  <h3 className="mt-8 text-[13px] font-bold text-slate-800 border-b border-slate-200 pb-2">EARNINGS</h3>
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

                  <h3 className="mt-6 text-[13px] font-bold text-slate-800 border-b border-slate-200 pb-2">DEDUCTIONS</h3>
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
                      {parseFloat(active.additionalTax || 0) > 0 && (
                        <tr className="border-b border-slate-100">
                          <td className="py-2 text-slate-700">Additional Tax</td>
                          <td className="py-2 text-right text-slate-800 font-medium">{fmtInr(active.additionalTax)}</td>
                        </tr>
                      )}
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
              </div>
            </>
          ) : (
            <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
              <div>
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-[13px] font-medium text-slate-600">No payslip selected</p>
                <p className="mt-1 text-[12px] text-slate-400">
                  Pick a month from the list on the left to preview the payslip.
                </p>
              </div>
            </div>
          )}
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

// One row inside the expanded Salary Revision panel — title (bonus type),
// fixed/percentage marker (always Fixed for now since the data model only
// stores absolute amounts), Paid/Due status, amount, due date, and
// optional note. Mirrors the Keka-style screenshot the user provided.
function BonusDetailRow({ bonus }: { bonus: BonusRow }) {
  const title = (() => {
    if (!bonus.bonusType || bonus.bonusType === "other") return "Bonus";
    const t = bonus.bonusType.replace(/_/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  })();
  const status = bonus.paymentStatus === "paid_past" ? "Paid" : "Due";
  const due = new Date(bonus.effectiveDate).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });

  return (
    <div className="bg-white px-5 py-4 border-t border-slate-100">
      <div className="grid grid-cols-12 items-start gap-4">
        <p className="col-span-3 text-[13px] font-semibold text-slate-800">{title}</p>
        <div className="col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Type</p>
          <p className="mt-1 text-[12.5px] text-slate-700">Fixed</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Status</p>
          <p className="mt-1 text-[12.5px] text-slate-700">{status}</p>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Amount</p>
          <p className="mt-1 text-[12.5px] text-slate-700">INR {new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(parseFloat(bonus.amount || "0"))}</p>
        </div>
        <div className="col-span-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Due</p>
          <p className="mt-1 text-[12.5px] text-slate-700">{due}</p>
        </div>
      </div>
      {bonus.reason && (
        <p className="mt-3 text-[12px] text-slate-600">
          <span className="font-semibold text-slate-800">Note:</span> {bonus.reason}
        </p>
      )}
      {bonus.attachmentName && (
        <a
          href={`/api/hr/payroll/bonus/${bonus.id}/file`}
          className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#3b82f6] hover:text-[#2563eb] hover:underline"
        >
          <Paperclip size={12} />
          {bonus.attachmentName}
        </a>
      )}
    </div>
  );
}

function renderEarnings(p: any, structure: any): { label: string; value: string }[] {
  const gross = parseFloat(p.grossEarnings || 0);
  const bonus = parseFloat(p.bonus || 0);
  const baseEarnings = Math.max(0, gross - bonus);
  if (!structure) {
    const rows = [{ label: "Monthly Stipend", value: fmtInr(baseEarnings) }];
    if (bonus) rows.push({ label: "Bonus", value: fmtInr(bonus) });
    return rows;
  }
  if (structure.salaryType === "intern") {
    const rows = [{ label: "Monthly Stipend", value: fmtInr(baseEarnings) }];
    if (bonus) rows.push({ label: "Bonus", value: fmtInr(bonus) });
    return rows;
  }
  const basic   = parseFloat(structure.basic               || 0) / 12;
  const hra     = parseFloat(structure.hra                 || 0) / 12;
  const da      = parseFloat(structure.dearnessAllowance   || 0) / 12;
  const conv    = parseFloat(structure.conveyanceAllowance || 0) / 12;
  const medical = parseFloat(structure.medicalAllowance    || 0) / 12;
  // Special soaks up whatever's left after the fixed components — keeps
  // the row total equal to baseEarnings even when the DB row is missing
  // a component (older saves had only basic/hra/special populated).
  const fixed   = basic + hra + da + conv + medical;
  const special = Math.max(0, baseEarnings - fixed);
  const rows: { label: string; value: string }[] = [];
  if (basic)   rows.push({ label: "Basic Salary",         value: fmtInr(basic)   });
  if (hra)     rows.push({ label: "House Rent Allowance", value: fmtInr(hra)     });
  if (da)      rows.push({ label: "Dearness Allowance",   value: fmtInr(da)      });
  if (conv)    rows.push({ label: "Conveyance Allowance", value: fmtInr(conv)    });
  if (medical) rows.push({ label: "Medical Allowance",    value: fmtInr(medical) });
  if (special) rows.push({ label: "Special Allowance",    value: fmtInr(special) });
  if (rows.length === 0) rows.push({ label: "Monthly Stipend", value: fmtInr(baseEarnings) });
  if (bonus)   rows.push({ label: "Bonus",                value: fmtInr(bonus) });
  return rows;
}
