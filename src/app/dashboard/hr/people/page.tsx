"use client";
import { useMemo, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import AddEmployeeWizard from "@/components/hr/add-employee-wizard";
import OrgTreeView from "@/components/hr/OrgTreeView";
import FilterDropdown from "@/components/hr/FilterDropdown";
import {
  deriveEntity,
  deriveDepartment,
  deriveLocation,
  deriveRole,
  entityOptions,
  departmentOptions,
  locationOptions,
  roleOptions,
} from "@/lib/hr-taxonomy";
import { getUserRoleLabel } from "@/lib/user-role-options";
import { isHRAdmin } from "@/lib/access";

const ORG_TABS = [
  { key: "employees", label: "EMPLOYEES" },
  { key: "documents", label: "DOCUMENTS" },
  { key: "engage", label: "ENGAGE" },
];

export default function PeoplePage() {
  const { data: session } = useSession();
  const user = session?.user as any;
  const isAdmin = isHRAdmin(user);
  const [subTab, setSubTab] = useState<"directory" | "tree">("directory");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const [fBizUnit,  setFBizUnit]  = useState<Set<string>>(new Set());
  const [fDept,     setFDept]     = useState<Set<string>>(new Set());
  const [fLocation, setFLocation] = useState<Set<string>>(new Set());
  const [fCost,     setFCost]     = useState<Set<string>>(new Set());
  const [fLegal,    setFLegal]    = useState<Set<string>>(new Set());
  const [fRole,     setFRole]     = useState<Set<string>>(new Set());

  const { data: employees = [] } = useSWR("/api/hr/employees", fetcher);

  const { bizUnitOpts, deptOpts, locOpts, costOpts, legalOpts, rolesOpts } = useMemo(() => {
    const ents = entityOptions(employees);
    return {
      bizUnitOpts: ents,
      legalOpts:   ents,
      costOpts:    ents,
      deptOpts:    departmentOptions(employees),
      locOpts:     locationOptions(employees),
      rolesOpts:   roleOptions(employees),
    };
  }, [employees]);

  const filtered = useMemo(() => {
    // When a filter has any selection, only users whose derived value is in
    // the set pass. Users with empty values are excluded (no more UNASSIGNED
    // pseudo-match since the option itself was removed).
    const matches = (selected: Set<string>, derived: string) => {
      if (selected.size === 0) return true;
      return !!derived && selected.has(derived);
    };
    return employees.filter((e: any) => {
      const en = deriveEntity(e);
      const dp = deriveDepartment(e);
      const lc = deriveLocation(e);
      const rl = deriveRole(e);
      if (!matches(fBizUnit,  en)) return false;
      if (!matches(fLegal,    en)) return false;
      if (!matches(fCost,     en)) return false;
      if (!matches(fDept,     dp)) return false;
      if (!matches(fLocation, lc)) return false;
      if (!matches(fRole,     rl)) return false;
      if (search && !(
        e.name?.toLowerCase().includes(search.toLowerCase()) ||
        (e.email || "").toLowerCase().includes(search.toLowerCase())
      )) return false;
      return true;
    });
  }, [employees, fBizUnit, fDept, fLocation, fCost, fLegal, fRole, search]);

  const anyFilter = fBizUnit.size || fDept.size || fLocation.size || fCost.size || fLegal.size || fRole.size;
  const clearFilters = () => { setFBizUnit(new Set()); setFDept(new Set()); setFLocation(new Set()); setFCost(new Set()); setFLegal(new Set()); setFRole(new Set()); };

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

            {/* Filter bar (themed multi-select dropdowns) */}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
              <FilterDropdown label="Business Unit" options={bizUnitOpts} selected={fBizUnit}  onChange={setFBizUnit}  />
              <FilterDropdown label="Department"    options={deptOpts}    selected={fDept}     onChange={setFDept}     width={280} />
              <FilterDropdown label="Location"      options={locOpts}     selected={fLocation} onChange={setFLocation} />
              <FilterDropdown label="Cost Center"   options={costOpts}    selected={fCost}     onChange={setFCost}     />
              <FilterDropdown label="Legal Entity"  options={legalOpts}   selected={fLegal}    onChange={setFLegal}    />
              <FilterDropdown label="Role"          options={rolesOpts}   selected={fRole}     onChange={setFRole}     width={220} />
              {anyFilter ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="h-9 px-3 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-[#008CFF] dark:hover:text-[#4a9cff] transition-colors"
                >
                  Clear filters
                </button>
              ) : null}
              <div className="relative flex-1 min-w-[200px]">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
                  className="w-full h-9 pl-9 pr-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-500 focus:outline-none focus:border-[#008CFF]/40" />
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
                      <p className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{emp.employeeProfile?.designation || getUserRoleLabel(emp.role)}</p>
                    </div>
                  </div>

                  {/* Info Rows */}
                  <div className="space-y-1.5">
                    {emp.employeeProfile?.department && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Department :</span>
                        <span className="text-[11px] text-[#008CFF] font-medium">{emp.employeeProfile.department}</span>
                      </div>
                    )}
                    {(emp.employeeProfile?.workLocation) && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Location :</span>
                        <span className="text-[11px] text-slate-800 dark:text-white">{emp.employeeProfile.workLocation}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <span className="text-[11px] text-slate-600 min-w-[80px]">Email :</span>
                      <span className="text-[11px] text-slate-800 dark:text-white truncate">{emp.email}</span>
                    </div>
                    {emp.employeeProfile?.phone && (
                      <div className="flex items-start gap-2">
                        <span className="text-[11px] text-slate-600 min-w-[80px]">Mobile :</span>
                        <span className="text-[11px] text-slate-800 dark:text-white">{emp.employeeProfile.phone}</span>
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

        {subTab === "tree" && <OrgTreeView />}
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
