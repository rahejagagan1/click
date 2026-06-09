"use client";

// HR-admin panel — per-employee WFH balance for the chosen month.
// Mirrors the layout of LeaveBalancesPanel / RegularizationBalancePanel:
// month picker, brand sub-tabs, search box, sticky-header table.

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { Home, Search, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";

type Row = {
  userId: number;
  name: string;
  email: string;
  department: string | null;
  businessUnit: "NB Media" | "YT Labs" | null;
  credited: number;
  used: number;
  remaining: number;
  hasRow: boolean;
};
type Payload = {
  monthKey: string;
  brand: "NB Media" | "YT Labs" | null;
  limitEnabled: boolean;
  totals: { credited: number; used: number; remaining: number; employees: number };
  rows: Row[];
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function currentMonthKey(): string {
  const ist = new Date(Date.now() + 5.5 * 3600_000);
  return `${ist.getUTCFullYear()}-M${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shiftMonth(key: string, by: number): string {
  const m = key.match(/^(\d{4})-M(\d{2})$/); if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + by, 1));
  return `${d.getUTCFullYear()}-M${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function prettyMonth(key: string): string {
  const m = key.match(/^(\d{4})-M(\d{2})$/); if (!m) return key;
  return `${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

export default function WfhBalancesPanel({ initialBrand }: { initialBrand?: "NB Media" | "YT Labs" | "all" | null } = {}) {
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey());
  const [brand, setBrand] = useState<"NB Media" | "YT Labs" | "all">(
    initialBrand === "NB Media" || initialBrand === "YT Labs" ? initialBrand : "all",
  );
  const [q, setQ] = useState<string>("");

  const apiKey = useMemo(() => {
    const params = new URLSearchParams({ monthKey });
    if (brand !== "all") params.set("brand", brand);
    if (q.trim()) params.set("q", q.trim());
    return `/api/hr/wfh/balances?${params.toString()}`;
  }, [monthKey, brand, q]);

  const { data, isLoading } = useSWR<Payload>(apiKey, fetcher, { revalidateOnFocus: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-[16px] font-bold text-slate-800 inline-flex items-center gap-2">
            <Home size={16} className="text-[#008CFF]" />
            WFH Balances
          </h2>
          <p className="text-[12px] text-slate-500 mt-0.5 max-w-2xl">
            Per-employee monthly WFH quota and usage. Credited automatically on the 1st of each month from the policy on <span className="font-semibold">/admin → Attendance Policies</span>. New joiners show their quota even before the cron creates a row.
          </p>
        </div>
      </div>

      {data && !data.limitEnabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 inline-flex items-center gap-2">
          <AlertCircle size={14} />
          <span>
            <strong>WFH limit is currently OFF.</strong> Numbers below are shown for reference but quotas are not enforced. Flip the switch on <span className="font-semibold">/admin → Attendance Policies</span> to re-enable.
          </span>
        </div>
      )}

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Month nav */}
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white">
          <button
            onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
            className="h-8 w-8 inline-flex items-center justify-center text-slate-500 hover:bg-slate-50 rounded-l-lg"
            aria-label="Previous month"
          >
            <ChevronLeft size={14} />
          </button>
          <div className="px-3 text-[12.5px] font-semibold text-slate-700 tabular-nums">
            {prettyMonth(monthKey)}
          </div>
          <button
            onClick={() => setMonthKey(shiftMonth(monthKey, +1))}
            className="h-8 w-8 inline-flex items-center justify-center text-slate-500 hover:bg-slate-50 rounded-r-lg"
            aria-label="Next month"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Brand tabs */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(["all", "NB Media", "YT Labs"] as const).map((b) => {
            const active = brand === b;
            return (
              <button
                key={b}
                onClick={() => setBrand(b)}
                className={`px-3 py-1.5 rounded-md text-[11.5px] font-semibold transition-colors ${
                  active ? "bg-white text-[#008CFF] shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {b === "all" ? "All Brands" : b}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="h-8 pl-8 pr-3 rounded-lg border border-slate-200 bg-white text-[12.5px] text-slate-700 placeholder-slate-400 w-64 focus:outline-none focus:border-[#008CFF]"
          />
        </div>
      </div>

      {/* Totals card */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Stat label="Employees" value={data.totals.employees} accent="slate" />
          <Stat label="Total credited" value={data.totals.credited} accent="blue" />
          <Stat label="Total used" value={data.totals.used} accent="amber" />
          <Stat label="Total remaining" value={data.totals.remaining} accent="emerald" />
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full min-w-[760px]">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur border-b border-slate-200">
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5">Employee</th>
                <th className="px-4 py-2.5">Department</th>
                <th className="px-4 py-2.5">Brand</th>
                <th className="px-4 py-2.5 text-right">Credited</th>
                <th className="px-4 py-2.5 text-right">Used</th>
                <th className="px-4 py-2.5 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12.5px] text-slate-400">Loading…</td></tr>
              ) : !data || data.rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[12.5px] text-slate-400">No employees match.</td></tr>
              ) : data.rows.map((r) => {
                const exhausted = r.remaining <= 0;
                const oneLeft   = r.remaining === 1;
                return (
                  <tr key={r.userId} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <div className="text-[13px] font-semibold text-slate-800 leading-tight">{r.name}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{r.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-slate-600">{r.department || "—"}</td>
                    <td className="px-4 py-2.5">
                      {r.businessUnit === "YT Labs" ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#d4143d]/10 text-[#d4143d]">YT Labs</span>
                      ) : r.businessUnit === "NB Media" ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#008CFF]/10 text-[#008CFF]">NB Media</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[13px] font-semibold tabular-nums text-slate-800">
                      {r.credited}
                      {!r.hasRow && (
                        <span className="ml-1 text-[10px] font-medium text-slate-400" title="No DB row yet — will be created on next cron firing">*</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-slate-700">
                      {r.used}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 rounded-md text-[12px] font-bold tabular-nums ${
                        exhausted ? "bg-rose-50 text-rose-700"
                          : oneLeft ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}>
                        {r.remaining}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data && data.rows.some((r) => !r.hasRow) && (
          <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-500">
            <span className="text-slate-400">*</span> No DB row yet — values shown are what the next cron firing will credit. Run a force-credit from VPS to materialise them now.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: "slate" | "blue" | "amber" | "emerald" }) {
  const tone = {
    slate:   "bg-slate-50  text-slate-700",
    blue:    "bg-[#008CFF]/10 text-[#008CFF]",
    amber:   "bg-amber-50  text-amber-800",
    emerald: "bg-emerald-50 text-emerald-700",
  }[accent];
  return (
    <div className={`rounded-lg ${tone} px-3 py-2.5`}>
      <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">{label}</p>
      <p className="text-[18px] font-bold tabular-nums leading-tight mt-0.5">{value}</p>
    </div>
  );
}
