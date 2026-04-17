"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import Link from "next/link";
import { useParams } from "next/navigation";

const TABS = ["About", "Profile", "Job", "Time", "Documents", "Assets"];

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const { data: user, isLoading } = useSWR(`/api/hr/people/${id}`, fetcher);
  const [activeTab, setActiveTab] = useState("About");

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return <p className="text-center text-slate-500 py-20">Employee not found</p>;

  const p = user.profile || {};

  return (
    <div className="space-y-0 -mx-6 -mt-6">
      {/* ── Breadcrumb Bar ── */}
      <div className="bg-[#f4f7f8] dark:bg-[#001529] px-6 py-2.5 border-b border-slate-200 dark:border-white/[0.06]">
        <div className="flex items-center text-xs text-slate-500 gap-1.5">
          <Link href="/dashboard" className="hover:text-slate-800 dark:text-white transition-colors">Home</Link><span>/</span>
          <Link href="/dashboard/hr/people" className="hover:text-slate-800 dark:text-white transition-colors">People</Link><span>/</span>
          <span className="text-slate-800 dark:text-white">{user.name}</span>
        </div>
      </div>

      <div className="grid grid-cols-12">
        {/* ── Left: Profile Card (Keka-style) ── */}
        <div className="col-span-3 border-r border-slate-200 dark:border-white/[0.06] p-6">
          <div className="sticky top-6">
            {/* Status Badge */}
            <div className="flex justify-start mb-4">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">IN</span>
            </div>

            {/* Avatar */}
            <div className="flex flex-col items-center">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-slate-800 dark:text-white text-3xl font-medium mb-4 overflow-hidden ring-4 ring-white/[0.04]">
                {user.profilePictureUrl ? <img src={user.profilePictureUrl} className="w-full h-full object-cover" /> : user.name?.charAt(0)}
              </div>
              <h2 className="text-[17px] font-semibold text-slate-800 dark:text-white text-center">{user.name}</h2>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">{p.designation || "—"}</p>
              <p className="text-[12px] text-slate-600 mt-0.5">{p.employeeId || "—"}</p>
            </div>

            {/* Reporting To */}
            {p.manager && (
              <div className="mt-6 pt-5 border-t border-white/[0.04]">
                <p className="text-[11px] text-slate-600 mb-2">Reporting to</p>
                <Link href={`/dashboard/hr/people/${p.managerId}`} className="flex items-center gap-2.5 hover:bg-slate-50 dark:bg-white/[0.02] rounded-lg p-2 -mx-2 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-slate-800 dark:text-white text-xs font-bold overflow-hidden">
                    {p.manager?.profilePictureUrl ? <img src={p.manager.profilePictureUrl} className="w-full h-full object-cover" /> : p.manager?.name?.charAt(0)}
                  </div>
                  <div>
                    <p className="text-[12px] text-slate-800 dark:text-white font-medium">{p.manager?.name}</p>
                    <p className="text-[10px] text-slate-500">{p.manager?.profile?.designation || "Manager"}</p>
                  </div>
                </Link>
              </div>
            )}

            {/* Quick Info */}
            <div className="mt-5 pt-5 border-t border-white/[0.04] space-y-3">
              {[
                { label: "Department", value: p.department },
                { label: "Location", value: p.workLocation || "Head Office" },
                { label: "Employment", value: p.employmentType?.replace("_", " ") },
                { label: "Joined", value: p.joiningDate ? new Date(p.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null },
              ].map((info) => info.value && (
                <div key={info.label}>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider">{info.label}</p>
                  <p className="text-[12px] text-slate-800 dark:text-white capitalize">{info.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Center: Tabs + Content ── */}
        <div className="col-span-6 border-r border-slate-200 dark:border-white/[0.06]">
          {/* Tabs */}
          <div className="flex gap-0 border-b border-slate-200 dark:border-white/[0.06] px-6">
            {TABS.map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-3 text-[13px] font-medium border-b-2 transition-colors ${activeTab === tab ? "border-[#008CFF] text-slate-800 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:text-white"}`}>{tab}</button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === "About" && (
              <div className="space-y-6">
                {/* Sub-tabs */}
                <div className="flex gap-4 border-b border-white/[0.04] pb-0">
                  <button className="text-[13px] text-[#008CFF] font-medium border-b-2 border-[#008CFF] pb-2">Summary</button>
                  <button className="text-[13px] text-slate-500 hover:text-slate-800 dark:text-white pb-2">Timeline</button>
                  <button className="text-[13px] text-slate-500 hover:text-slate-800 dark:text-white pb-2">Wall activity</button>
                </div>

                <div>
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-3">About</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">{p.about || "No about information added yet."}</p>
                </div>

                <div>
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-3">Contact Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: "Email", value: user.email },
                      { label: "Phone", value: p.phone },
                      { label: "Emergency Contact", value: p.emergencyContact },
                      { label: "Blood Group", value: p.bloodGroup },
                      { label: "Date of Birth", value: p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString("en-IN") : null },
                      { label: "Gender", value: p.gender },
                    ].map((f) => (
                      <div key={f.label} className="py-2">
                        <p className="text-[11px] text-slate-500 mb-0.5">{f.label}</p>
                        <p className="text-[13px] text-slate-800 dark:text-white">{f.value || "—"}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-3">Address</h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">{p.address || "No address on file"}</p>
                </div>
              </div>
            )}

            {activeTab === "Profile" && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-3">Personal Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Full Name", value: user.name },
                    { label: "Email", value: user.email },
                    { label: "Employee ID", value: p.employeeId },
                    { label: "Phone", value: p.phone },
                    { label: "Date of Birth", value: p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString("en-IN") : null },
                    { label: "Gender", value: p.gender },
                    { label: "Blood Group", value: p.bloodGroup },
                    { label: "Emergency Contact", value: p.emergencyContact },
                    { label: "Address", value: p.address },
                  ].map((f) => (
                    <div key={f.label} className="bg-slate-50 dark:bg-white/[0.02] rounded-lg px-4 py-3">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{f.label}</p>
                      <p className="text-[13px] text-slate-800 dark:text-white">{f.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "Job" && (
              <div className="space-y-4">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-3">Job Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Department", value: p.department },
                    { label: "Designation", value: p.designation },
                    { label: "Employment Type", value: p.employmentType?.replace("_", " ") },
                    { label: "Work Location", value: p.workLocation },
                    { label: "Joining Date", value: p.joiningDate ? new Date(p.joiningDate).toLocaleDateString("en-IN") : null },
                    { label: "Role", value: user.role },
                    { label: "Org Level", value: user.orgLevel },
                  ].map((f) => (
                    <div key={f.label} className="bg-slate-50 dark:bg-white/[0.02] rounded-lg px-4 py-3">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{f.label}</p>
                      <p className="text-[13px] text-slate-800 dark:text-white capitalize">{f.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "Time" && (
              <div className="text-center py-12">
                <p className="text-[13px] text-slate-500">Attendance & time data available on the </p>
                <Link href="/dashboard/hr/attendance" className="text-[#008CFF] hover:underline text-[13px]">Attendance page →</Link>
              </div>
            )}

            {activeTab === "Documents" && (
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-3">Employee Documents</h3>
                {user.documents?.length > 0 ? (
                  <div className="space-y-2">
                    {user.documents.map((doc: any) => (
                      <div key={doc.id} className="flex items-center gap-3 bg-slate-50 dark:bg-white/[0.02] rounded-lg px-4 py-3">
                        <span className="material-icons-outlined text-[#008CFF]">description</span>
                        <div className="flex-1"><p className="text-[13px] text-slate-800 dark:text-white">{doc.name}</p><p className="text-[11px] text-slate-500">{doc.category} · {new Date(doc.createdAt).toLocaleDateString("en-IN")}</p></div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${doc.verificationStatus === "verified" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{doc.verificationStatus}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-[13px] text-slate-500">No documents uploaded</p>}
              </div>
            )}

            {activeTab === "Assets" && (
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-3">Assigned Assets</h3>
                {user.assets?.length > 0 ? (
                  <div className="space-y-2">
                    {user.assets.map((asset: any) => (
                      <div key={asset.id} className="flex items-center gap-3 bg-slate-50 dark:bg-white/[0.02] rounded-lg px-4 py-3">
                        <span className="material-icons-outlined text-[#008CFF]">laptop_mac</span>
                        <div className="flex-1"><p className="text-[13px] text-slate-800 dark:text-white">{asset.name}</p><p className="text-[11px] text-slate-500">{asset.type} · {asset.serialNumber}</p></div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${asset.condition === "good" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>{asset.condition}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-[13px] text-slate-500">No assets assigned</p>}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Reporting Team ── */}
        <div className="col-span-3 p-6">
          <div className="sticky top-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">Reporting team <span className="text-[12px] text-slate-500 font-normal ml-1">{user.directReports?.length || 0}</span></h3>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input placeholder="Search by name..." className="w-full h-8 pl-8 pr-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] text-slate-800 dark:text-white placeholder-slate-600 focus:outline-none" />
            </div>

            {/* Team Members */}
            <div className="space-y-2">
              {user.directReports?.length > 0 ? user.directReports.map((member: any) => {
                const statuses = ["In", "Leave", "WFH"];
                const status = statuses[Math.floor(Math.random() * 3)]; // Placeholder
                const statusColors: any = { In: "bg-emerald-500/10 text-emerald-400", Leave: "bg-red-500/10 text-red-400", WFH: "bg-blue-500/10 text-blue-400" };
                return (
                  <Link key={member.id} href={`/dashboard/hr/people/${member.id}`} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 dark:bg-white/[0.02] transition-colors">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-slate-800 dark:text-white text-xs font-bold overflow-hidden shrink-0">
                      {member.profilePictureUrl ? <img src={member.profilePictureUrl} className="w-full h-full object-cover" /> : member.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-slate-800 dark:text-white font-medium truncate">{member.name}</p>
                      <p className="text-[10px] text-slate-500 truncate">{member.profile?.designation || "Team Member"}</p>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${statusColors[status]}`}>{status}</span>
                  </Link>
                );
              }) : (
                <p className="text-[12px] text-slate-600 text-center py-4">No direct reports</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
