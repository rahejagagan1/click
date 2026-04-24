"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";

const MODULE_TABS = [
  { key: "home",         label: "HOME",        href: "/dashboard/hr/analytics"       },
  { key: "attendance",   label: "ATTENDANCE",  href: "/dashboard/hr/attendance"      },
  { key: "leave",        label: "LEAVE",       href: "/dashboard/hr/leaves"          },
  { key: "performance",  label: "PERFORMANCE", href: "/dashboard/hr/goals"           },
  { key: "payroll",      label: "MY FINANCES", href: "/dashboard/hr/payroll/summary" },
];

const PAYROLL_TABS = [
  { key: "summary",  label: "SUMMARY",    href: "/dashboard/hr/payroll/summary" },
  { key: "my-pay",   label: "MY PAY",     href: "/dashboard/hr/payroll"         },
  { key: "tax",      label: "MANAGE TAX", href: "/dashboard/hr/payroll/tax"     },
];

function fmt(n: any) {
  const v = parseFloat(n || 0);
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v);
}

export default function ManageTaxPage() {
  const { data: myStructure } = useSWR("/api/hr/payroll/salary-structure", fetcher);
  const annualCtc = parseFloat(myStructure?.ctc || 0);

  return (
    <div className="min-h-screen bg-[#f4f7f8]">
      <div className="flex items-center bg-white border-b border-slate-200 px-4 overflow-x-auto">
        {MODULE_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`px-4 py-3 text-[11px] font-bold tracking-widest border-b-2 transition-colors whitespace-nowrap ${
              t.key === "payroll" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-400 hover:text-slate-600"
            }`}>{t.label}</Link>
        ))}
      </div>

      <div className="flex items-center bg-white border-b border-slate-200 px-4">
        {PAYROLL_TABS.map((t) => (
          <Link key={t.key} href={t.href}
            className={`relative px-4 py-3 text-[11px] font-bold tracking-widest transition-colors whitespace-nowrap ${
              t.key === "tax" ? "text-[#0f4e93]" : "text-slate-400 hover:text-slate-600"
            }`}>
            {t.label}
            {t.key === "tax" && (
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-0 w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-[#0f4e93]" />
            )}
          </Link>
        ))}
      </div>

      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <h3 className="text-[15px] font-semibold text-slate-800 mb-2">Tax Regime</h3>
          <p className="text-[13px] text-slate-500 mb-4">
            Your Income and tax liability is being computed as per <span className="font-semibold text-slate-700">New Tax Regime</span>.
          </p>
          {!myStructure ? (
            <p className="text-[13px] text-slate-500">No salary structure assigned yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Annual CTC",              value: fmt(annualCtc) },
                { label: "TDS / Income Tax (FY)",   value: fmt(myStructure.tds) },
                { label: "Professional Tax (₹/mo)", value: fmt(myStructure.professionalTax) },
                { label: "PF — Employee (FY)",      value: fmt(myStructure.pfEmployee) },
                { label: "PF — Employer (FY)",      value: fmt(myStructure.pfEmployer) },
                { label: "Net Pay (Annual, est.)",  value: fmt(annualCtc - parseFloat(myStructure.pfEmployee || 0) - parseFloat(myStructure.tds || 0) - parseFloat(myStructure.professionalTax || 0) * 12) },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">{c.label}</p>
                  <p className="mt-1.5 text-[16px] font-semibold text-slate-800">INR {c.value}</p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-5 text-[11.5px] text-slate-400">
            Declarations and proof submissions will live here in a future update.
          </p>
        </div>
      </div>
    </div>
  );
}
