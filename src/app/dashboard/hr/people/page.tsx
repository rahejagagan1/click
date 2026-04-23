"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import AddEmployeeWizard from "@/components/hr/add-employee-wizard";

const ORG_TABS = [
  { key: "employees", label: "EMPLOYEES" },
  { key: "documents", label: "DOCUMENTS" },
  { key: "engage", label: "ENGAGE" },
];

export default function PeoplePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = user?.orgLevel === "ceo" || user?.isDeveloper;
  const [subTab, setSubTab] = useState<"directory" | "tree">("directory");
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: employees = [] } = useSWR("/api/hr/employees", fetcher);

  const filtered = employees.filter((e: any) => {
    if (search && !e.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (deptFilter && e.profile?.department !== deptFilter) return false;
    if (locationFilter && e.profile?.workLocation !== locationFilter) return false;
    return true;
  });

  const departments = [...new Set(employees.map((e: any) => e.profile?.department).filter(Boolean))];
  const locations = [...new Set(employees.map((e: any) => e.profile?.workLocation).filter(Boolean))];

  return (
    <div className="space-y-0">
      {/* Top Module Tabs */}
      <div className="flex items-center gap-0 bg-[#f4f7f8] dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06] px-6">
        {ORG_TABS.map((t) => (
          <Link key={t.key} href={t.key === "documents" ? "/dashboard/hr/documents" : t.key === "engage" ? "/dashboard/hr/announcements" : "/dashboard/hr/people"}
            className={`px-5 py-3 text-[12px] font-semibold tracking-wider transition-colors border-b-2 ${
              t.key === "employees" ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:text-white"
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Sub-tabs: Employee Directory / Organization Tree */}
      <div className="flex items-center justify-between px-6 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="flex gap-0">
          {(["directory", "tree"] as const).map((tab) => (
            <button key={tab} onClick={() => setSubTab(tab)}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
                subTab === tab ? "border-[#008CFF] text-slate-800 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-white"
              }`}>
              {tab === "directory" ? "Employee Directory" : "Organization Tree"}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button onClick={() => setShowAdd(true)} className="h-8 px-4 bg-[#008CFF] hover:bg-[#0077dd] text-slate-800 dark:text-white rounded text-[12px] font-semibold transition-colors">
            + Add Employee
          </button>
        )}
      </div>

      <div className="px-6 py-5">
        {subTab === "directory" && (
          <>
            {/* Section Title */}
            <h2 className="text-[17px] font-semibold text-slate-800 dark:text-white mb-4">Employee Directory</h2>

            {/* Keka-style Filter Bar */}
            <div className="flex items-center gap-3 mb-5">
              <select className="h-9 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-500 dark:text-slate-400 focus:outline-none focus:border-[#008CFF]/40 min-w-[130px]">
                <option>Business Unit</option>
              </select>
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                className="h-9 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-500 dark:text-slate-400 focus:outline-none focus:border-[#008CFF]/40 min-w-[160px]">
                <option value="">Department</option>
                {departments.map((d: any) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}
                className="h-9 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-500 dark:text-slate-400 focus:outline-none focus:border-[#008CFF]/40 min-w-[120px]">
                <option value="">Location</option>
                {locations.map((l: any) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select className="h-9 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-500 dark:text-slate-400 focus:outline-none focus:border-[#008CFF]/40 min-w-[120px]">
                <option>Cost Center</option>
              </select>
              <select className="h-9 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-500 dark:text-slate-400 focus:outline-none focus:border-[#008CFF]/40 min-w-[120px]">
                <option>Legal Entity</option>
              </select>
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                  className="w-full h-9 pl-9 pr-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none focus:border-[#008CFF]/40" />
              </div>
            </div>

            {/* Count */}
            <div className="flex justify-end mb-3">
              <span className="text-[11px] text-slate-500">Showing {filtered.length} of {employees.length}</span>
            </div>

            {/* Card Grid (Keka exact: 4 cards per row) */}
            <div className="grid grid-cols-4 gap-4">
              {filtered.map((emp: any) => (
                <Link key={emp.id} href={`/dashboard/hr/people/${emp.id}`}
                  className="bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5 hover:border-[#008CFF]/30 transition-all group">
                  <div className="flex items-start gap-4 mb-4">
                    {/* Avatar */}
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-slate-800 dark:text-white text-lg font-bold overflow-hidden ring-2 ring-white/[0.06] shrink-0">
                      {emp.profilePictureUrl ? <img src={emp.profilePictureUrl} className="w-full h-full object-cover" alt="" /> : emp.name?.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white truncate group-hover:text-[#008CFF] transition-colors">{emp.name}</h3>
                        <span className="text-slate-600 text-sm cursor-pointer">⋯</span>
                      </div>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{emp.profile?.designation || "Team Member"}</p>
                    </div>
                  </div>

                  {/* Info Rows */}
                  <div className="space-y-1.5">
                    {emp.profile?.department && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Department :</span>
                        <span className="text-[11px] text-[#008CFF] font-medium">{emp.profile.department}</span>
                      </div>
                    )}
                    {(emp.profile?.workLocation) && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Location :</span>
                        <span className="text-[11px] text-slate-800 dark:text-white">{emp.profile.workLocation}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] text-slate-600 min-w-[80px]">Email :</span>
                      <span className="text-[11px] text-slate-800 dark:text-white truncate">{emp.email}</span>
                    </div>
                    {emp.profile?.phone && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Mobile :</span>
                        <span className="text-[11px] text-slate-800 dark:text-white">{emp.profile.phone}</span>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="text-center py-16">
                <p className="text-[13px] text-slate-500">No employees found matching your filters</p>
              </div>
            )}
          </>
        )}

        {subTab === "tree" && (
          <div className="text-center py-16">
            <p className="text-[14px] text-slate-500 dark:text-slate-400 mb-2">Organization Tree</p>
            <p className="text-[12px] text-slate-600">Hierarchical org chart view coming soon</p>
          </div>
        )}
      </div>

      {/* Add Employee Wizard — 4-step Keka-style flow (Page 1 wired) */}
      {showAdd && (
        <AddEmployeeWizard
          onClose={() => setShowAdd(false)}
          onCreated={() => mutate("/api/hr/employees")}
        />
      )}
    </div>
  );
}
