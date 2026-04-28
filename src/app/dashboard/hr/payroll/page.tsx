"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Download, IndianRupee, FileText, Play, CheckCircle2, Clock, Plus, X, ChevronDown } from "lucide-react";

const TOP_TABS = [
  { key: "home",         label: "HOME",              href: "/dashboard/hr/home"  },
  { key: "attendance",   label: "ATTENDANCE",        href: "/dashboard/hr/attendance" },
  { key: "leave",        label: "LEAVE",             href: "/dashboard/hr/leaves"     },
  { key: "performance",  label: "PERFORMANCE",       href: "/dashboard/hr/goals"      },
  { key: "payroll",      label: "MY FINANCES",       href: "/dashboard/hr/payroll"    },
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    generated:  "bg-blue-50 dark:bg-blue-500/10 text-[#008CFF]",
    sent:       "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    acknowledged: "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400",
    draft:      "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400",
    processing: "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400",
    completed:  "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    paid:       "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${map[status] || "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

function downloadPayslip(p: any, structure: any) {
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const fmt = (n: any) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(parseFloat(n || 0));
  const monthlyBasic  = structure ? fmt(parseFloat(structure.basic) / 12) : "—";
  const monthlyHra    = structure ? fmt(parseFloat(structure.hra) / 12) : "—";
  const specialAllow  = structure
    ? fmt(parseFloat(p.grossEarnings) - parseFloat(structure.basic) / 12 - parseFloat(structure.hra) / 12)
    : "—";

  const html = `<!DOCTYPE html>
<html><head><title>Payslip - ${MONTHS[p.month]} ${p.year}</title>
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
  <div><div class="company">NB Media Productions</div><div class="period">Payslip for ${MONTHS[p.month]} ${p.year}</div></div>
  <div class="title">SALARY SLIP</div>
</div>

<div class="info-grid">
  <div class="info-cell"><div class="info-label">Employee Name</div><div class="info-value">${p.user?.name || "—"}</div></div>
  <div class="info-cell"><div class="info-label">Email</div><div class="info-value">${p.user?.email || "—"}</div></div>
  <div class="info-cell"><div class="info-label">Pay Period</div><div class="info-value">${MONTHS[p.month]} ${p.year}</div></div>
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
  const user = session?.user as any;
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper || user?.orgLevel === "hr_manager";

  const [adminTab, setAdminTab] = useState<"runs"|"structures">("runs");
  const [showNewRun, setShowNewRun] = useState(false);
  const [showNewStructure, setShowNewStructure] = useState(false);
  const [generating, setGenerating] = useState<number | null>(null);
  const [form, setForm] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });
  const [structureForm, setStructureForm] = useState({
    userId: "", ctc: "", basic: "", hra: "", specialAllowance: "",
    pfEmployee: "", pfEmployer: "", tds: "", professionalTax: "", effectiveFrom: "",
  });

  const { data: myPayslips = [] }    = useSWR("/api/hr/payroll/payslips", fetcher);
  const { data: myStructure }        = useSWR("/api/hr/payroll/salary-structure", fetcher);
  const { data: payrollRuns = [] }   = useSWR(isAdmin ? "/api/hr/payroll/runs" : null, fetcher);
  const { data: employees = [] }     = useSWR(isAdmin ? "/api/hr/employees" : null, fetcher);

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
    if (res.ok) { mutate("/api/hr/payroll/runs"); }
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

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* Top tabs */}
      <div className="flex items-center bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-4">
        {TOP_TABS.map(t => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest border-b-2 transition-colors whitespace-nowrap ${
              t.key === "payroll"
                ? "border-[#008CFF] text-[#008CFF]"
                : "border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}>{t.label}</Link>
        ))}
      </div>

      <div className="p-6 space-y-5 max-w-6xl mx-auto">

        {/* ── My Salary Structure ── */}
        {myStructure && (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
            <h3 className="text-[13px] font-bold text-slate-800 dark:text-white mb-4">My Salary Structure</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Annual CTC",      value: fmt(myStructure.ctc) },
                { label: "Monthly Basic",   value: fmt(parseFloat(myStructure.basic) / 12) },
                { label: "Monthly HRA",     value: fmt(parseFloat(myStructure.hra) / 12) },
                { label: "Monthly Gross",   value: fmt(parseFloat(myStructure.ctc) / 12) },
              ].map(c => (
                <div key={c.label} className="py-3 px-4 rounded-lg bg-slate-50 dark:bg-[#002140]/60">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">{c.label}</p>
                  <p className="text-[18px] font-bold text-[#008CFF] flex items-center gap-0.5">
                    <IndianRupee className="w-4 h-4" />{c.value}
                  </p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              {[
                { label: "PF (Employee)",   value: fmt(parseFloat(myStructure.pfEmployee) / 12), color: "text-red-500" },
                { label: "TDS / month",     value: fmt(parseFloat(myStructure.tds) / 12),        color: "text-red-500" },
                { label: "Prof. Tax",       value: fmt(myStructure.professionalTax),             color: "text-red-500" },
                { label: "Net Pay / month", value: fmt(parseFloat(myStructure.ctc) / 12 - parseFloat(myStructure.pfEmployee) / 12 - parseFloat(myStructure.tds) / 12 - parseFloat(myStructure.professionalTax)), color: "text-emerald-600 dark:text-emerald-400" },
              ].map(c => (
                <div key={c.label} className="py-2 px-3 rounded-lg bg-slate-50 dark:bg-[#002140]/60">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-0.5">{c.label}</p>
                  <p className={`text-[15px] font-bold ${c.color} flex items-center gap-0.5`}>
                    <IndianRupee className="w-3 h-3" />{c.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── My Payslips ── */}
        <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.04]">
            <h3 className="text-[13px] font-bold text-slate-800 dark:text-white">My Payslips</h3>
          </div>
          {myPayslips.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <FileText className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-[13px] text-slate-500 dark:text-slate-400">No payslips generated yet</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/[0.04]">
                  {["Month","Gross Earnings","Deductions","Net Pay","Status",""].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {myPayslips.map((p: any) => (
                  <tr key={p.id} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="px-5 py-3 text-[13px] font-medium text-slate-800 dark:text-white">
                      {MONTHS[p.month]} {p.year}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-slate-700 dark:text-slate-300">₹{fmt(p.grossEarnings)}</td>
                    <td className="px-5 py-3 text-[13px] text-red-500">₹{fmt(p.totalDeductions)}</td>
                    <td className="px-5 py-3 text-[13px] font-bold text-emerald-600 dark:text-emerald-400">₹{fmt(p.netPay)}</td>
                    <td className="px-5 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-5 py-3">
                      <button onClick={() => downloadPayslip(p, myStructure)}
                        className="flex items-center gap-1 text-[12px] text-[#008CFF] hover:underline">
                        <Download className="w-3.5 h-3.5" />Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Admin: Payroll Runs ── */}
        {isAdmin && (
          <div className="bg-white dark:bg-[#001529]/80 border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/[0.04]">
              <div className="flex items-center gap-4">
                <h3 className="text-[13px] font-bold text-slate-800 dark:text-white">Payroll Management</h3>
                <div className="flex items-center gap-0 bg-slate-100 dark:bg-white/5 rounded-lg p-0.5">
                  {(["runs","structures"] as const).map(t => (
                    <button key={t} onClick={() => setAdminTab(t)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${
                        adminTab === t ? "bg-white dark:bg-[#001529] text-[#008CFF] shadow-sm" : "text-slate-500 dark:text-slate-400"
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
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">No payroll runs yet</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-white/[0.04]">
                      {["Period","Status","Employees","Total CTC","Total Net Pay","Actions"].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payrollRuns.map((r: any) => (
                      <tr key={r.id} className="border-b border-slate-50 dark:border-white/[0.03] hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                        <td className="px-5 py-3 text-[13px] font-medium text-slate-800 dark:text-white">
                          {MONTHS[r.month]} {r.year}
                        </td>
                        <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                        <td className="px-5 py-3 text-[13px] text-slate-600 dark:text-slate-300">{r._count?.payslips ?? 0}</td>
                        <td className="px-5 py-3 text-[13px] text-slate-700 dark:text-slate-300">₹{fmt(r.totalCTC)}</td>
                        <td className="px-5 py-3 text-[13px] font-bold text-emerald-600 dark:text-emerald-400">₹{fmt(r.totalNetPay)}</td>
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
                <p className="text-[13px] text-slate-500 dark:text-slate-400">
                  Manage salary structures via the "Assign Structure" button above.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: New Payroll Run */}
      {showNewRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[360px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">New Payroll Run</h3>
              <button onClick={() => setShowNewRun(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Month</label>
                <select value={form.month} onChange={e => setForm(f => ({ ...f, month: parseInt(e.target.value) }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white text-[13px]">
                  {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Year</label>
                <input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value) }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white text-[13px]" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewRun(false)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5">
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
          <div className="bg-white dark:bg-[#001529] rounded-xl shadow-2xl p-6 w-[480px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-bold text-slate-800 dark:text-white">Assign Salary Structure</h3>
              <button onClick={() => setShowNewStructure(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Employee</label>
                <select value={structureForm.userId} onChange={e => setStructureForm(f => ({ ...f, userId: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white text-[13px]">
                  <option value="">Select employee…</option>
                  {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              {[
                { field: "ctc",              label: "Annual CTC (₹)"        },
                { field: "basic",            label: "Annual Basic (₹)"      },
                { field: "hra",              label: "Annual HRA (₹)"        },
                { field: "specialAllowance", label: "Special Allowance (₹)" },
                { field: "pfEmployee",       label: "PF Employee Annual (₹)"},
                { field: "pfEmployer",       label: "PF Employer Annual (₹)"},
                { field: "tds",              label: "Annual TDS (₹)"        },
                { field: "professionalTax",  label: "Professional Tax/mo (₹)"},
              ].map(({ field, label }) => (
                <div key={field}>
                  <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">{label}</label>
                  <input type="number" value={(structureForm as any)[field]}
                    onChange={e => setStructureForm(f => ({ ...f, [field]: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white text-[13px]" />
                </div>
              ))}
              <div className="col-span-2">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Effective From</label>
                <input type="date" value={structureForm.effectiveFrom}
                  onChange={e => setStructureForm(f => ({ ...f, effectiveFrom: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-800 dark:text-white text-[13px]" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewStructure(false)}
                className="flex-1 h-9 border border-slate-200 dark:border-white/10 rounded-lg text-[13px] text-slate-600 dark:text-slate-300">
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
