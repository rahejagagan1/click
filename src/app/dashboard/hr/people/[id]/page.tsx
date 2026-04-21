"use client";
import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getUserRoleLabel } from "@/lib/user-role-options";
import {
  Mail, Phone, MapPin, Briefcase, Calendar, Building2, IdCard, FileText, Laptop,
  Users as UsersIcon, Home, Search, User as UserIcon,
} from "lucide-react";

const TABS = ["About", "Profile", "Job", "Time", "Documents", "Assets"] as const;
type Tab = typeof TABS[number];

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

const prettyEmp = (v: string | null | undefined) => v ? v.replace(/_/g, " ") : null;

function Initials({ name, size = 80, fontSize = 22 }: { name?: string; size?: number; fontSize?: number }) {
  const initials = (name ?? "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      style={{ width: size, height: size, fontSize }}
      className="rounded-full bg-gradient-to-br from-[#008CFF] to-[#0066cc] text-white font-bold flex items-center justify-center"
    >
      {initials}
    </div>
  );
}

function Avatar({ url, name, size = 80, fontSize = 22 }: { url?: string | null; name?: string; size?: number; fontSize?: number }) {
  if (url) return <img src={url} alt={name ?? ""} style={{ width: size, height: size }} className="rounded-full object-cover" />;
  return <Initials name={name} size={size} fontSize={fontSize} />;
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon size={14} className="text-slate-400 mt-0.5 shrink-0" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500 font-semibold">{label}</p>
        <p className="text-[13px] text-slate-800 truncate">{value || "—"}</p>
      </div>
    </div>
  );
}

function Field({ label, value, capitalize = false }: { label: string; value?: string | null; capitalize?: boolean }) {
  return (
    <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
      <p className="text-[10px] text-slate-500 uppercase tracking-[0.1em] font-semibold mb-1">{label}</p>
      <p className={`text-[13px] text-slate-800 ${capitalize ? "capitalize" : ""}`}>{value || "—"}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const { id } = useParams();
  const { data: user, isLoading } = useSWR(`/api/hr/people/${id}`, fetcher);
  const [activeTab, setActiveTab] = useState<Tab>("About");
  const [teamQuery, setTeamQuery] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!user) return <p className="text-center text-slate-500 py-20">Employee not found</p>;

  const p = user.profile || {};
  const isActive = user.isActive !== false;
  const directReports = user.directReports ?? [];
  const filteredReports = teamQuery.trim()
    ? directReports.filter((m: any) => m.name?.toLowerCase().includes(teamQuery.trim().toLowerCase()))
    : directReports;

  return (
    <div className="space-y-0 -mx-6 -mt-6 bg-[#f4f7f8] min-h-screen">
      {/* ── Breadcrumb Bar ── */}
      <div className="bg-white px-6 py-3 border-b border-slate-200">
        <div className="flex items-center text-[12px] text-slate-500 gap-1.5">
          <Link href="/dashboard" className="hover:text-[#008CFF] transition-colors inline-flex items-center gap-1">
            <Home size={12} /> Home
          </Link>
          <span className="text-slate-300">/</span>
          <Link href="/dashboard/hr/people" className="hover:text-[#008CFF] transition-colors">People</Link>
          <span className="text-slate-300">/</span>
          <span className="text-slate-800 font-medium">{user.name}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-0">
        {/* ── Left: Profile Card ── */}
        <aside className="col-span-12 lg:col-span-3 p-5">
          <div className="sticky top-6 bg-white rounded-xl border border-slate-200 shadow-sm">
            {/* Gradient header strip — own rounded corners so overflow-hidden isn't needed on parent */}
            <div className="h-14 bg-gradient-to-br from-[#008CFF] to-[#0066cc] rounded-t-xl relative">
              <span className={`absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold backdrop-blur-sm ${
                isActive ? "bg-white/95 text-emerald-600" : "bg-white/95 text-slate-500"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                {isActive ? "Active" : "Inactive"}
              </span>
            </div>

            {/* Avatar + identity — avatar straddles the gradient edge using a negative margin */}
            <div className="px-5 pb-5">
              <div className="flex flex-col items-center -mt-10 relative">
                <div className="rounded-full bg-white p-1 shadow-md">
                  <Avatar url={user.profilePictureUrl} name={user.name} size={76} fontSize={22} />
                </div>
                <h2 className="text-[16px] font-bold text-slate-800 mt-3 text-center leading-tight">{user.name}</h2>
                <p className="text-[12.5px] text-slate-500 mt-0.5 text-center">
                  {p.designation || getUserRoleLabel(user.role) || "—"}
                </p>

                {p.employeeId && (
                  <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10.5px] font-semibold font-mono">
                    <IdCard size={10} /> {p.employeeId}
                  </span>
                )}
              </div>

              {/* Contact quick actions */}
              <div className="mt-5 flex items-center justify-center gap-2">
                {user.email && (
                  <a href={`mailto:${user.email}`} title={user.email}
                    className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-[#008CFF]/5 hover:text-[#008CFF] hover:border-[#008CFF]/30 transition-colors">
                    <Mail size={14} />
                  </a>
                )}
                {p.phone && (
                  <a href={`tel:${p.phone}`} title={p.phone}
                    className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-[#008CFF]/5 hover:text-[#008CFF] hover:border-[#008CFF]/30 transition-colors">
                    <Phone size={14} />
                  </a>
                )}
              </div>

              {/* Divider */}
              <div className="my-4 h-px bg-slate-100" />

              {/* Info rows */}
              <div className="space-y-0.5">
                <InfoRow icon={Building2} label="Department"  value={p.department} />
                <InfoRow icon={MapPin}    label="Location"    value={p.workLocation} />
                <InfoRow icon={Briefcase} label="Employment"  value={prettyEmp(p.employmentType)} />
                <InfoRow icon={Calendar}  label="Joined"      value={fmtDate(p.joiningDate)} />
              </div>

              {/* Reports to */}
              {user.manager && (
                <>
                  <div className="my-4 h-px bg-slate-100" />
                  <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500 font-semibold mb-2">Reports to</p>
                  <Link href={`/dashboard/hr/people/${user.manager.id}`}
                    className="flex items-center gap-2.5 p-2 -mx-2 rounded-lg hover:bg-slate-50 transition-colors">
                    <Avatar url={user.manager.profilePictureUrl} name={user.manager.name} size={32} fontSize={11} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] text-slate-800 font-semibold truncate">{user.manager.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{getUserRoleLabel(user.manager.role) || "Manager"}</p>
                    </div>
                  </Link>
                </>
              )}
            </div>
          </div>
        </aside>

        {/* ── Center: Tabs + Content ── */}
        <main className="col-span-12 lg:col-span-6 bg-white border-x border-slate-200">
          <div className="flex gap-0 border-b border-slate-200 px-6 overflow-x-auto">
            {TABS.map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-[#008CFF] text-[#008CFF]"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}>
                {tab}
              </button>
            ))}
          </div>

          <div className="p-6">
            {activeTab === "About" && (
              <div className="space-y-6">
                <section>
                  <h3 className="text-[13px] font-bold text-slate-800 mb-3 uppercase tracking-wide">About</h3>
                  <p className="text-[13px] text-slate-600 leading-relaxed">{p.about || "No about information added yet."}</p>
                </section>

                <section>
                  <h3 className="text-[13px] font-bold text-slate-800 mb-3 uppercase tracking-wide">Contact Information</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Email"             value={user.email} />
                    <Field label="Phone"             value={p.phone} />
                    <Field label="Emergency Contact" value={p.emergencyContact} />
                    <Field label="Blood Group"       value={p.bloodGroup} />
                    <Field label="Date of Birth"     value={fmtDate(p.dateOfBirth)} />
                    <Field label="Gender"            value={p.gender} capitalize />
                  </div>
                </section>

                <section>
                  <h3 className="text-[13px] font-bold text-slate-800 mb-3 uppercase tracking-wide">Address</h3>
                  <div className="bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                    <p className="text-[13px] text-slate-800">{p.address || "—"}</p>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "Profile" && (
              <section>
                <h3 className="text-[13px] font-bold text-slate-800 mb-3 uppercase tracking-wide">Personal Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Full Name"         value={user.name} />
                  <Field label="Email"             value={user.email} />
                  <Field label="Employee ID"       value={p.employeeId} />
                  <Field label="Phone"             value={p.phone} />
                  <Field label="Date of Birth"     value={fmtDate(p.dateOfBirth)} />
                  <Field label="Gender"            value={p.gender} capitalize />
                  <Field label="Blood Group"       value={p.bloodGroup} />
                  <Field label="Emergency Contact" value={p.emergencyContact} />
                </div>
                <div className="mt-3">
                  <Field label="Address" value={p.address} />
                </div>
              </section>
            )}

            {activeTab === "Job" && (
              <section>
                <h3 className="text-[13px] font-bold text-slate-800 mb-3 uppercase tracking-wide">Job Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Department"      value={p.department} />
                  <Field label="Designation"     value={p.designation} />
                  <Field label="Employment Type" value={prettyEmp(p.employmentType)} capitalize />
                  <Field label="Work Location"   value={p.workLocation} />
                  <Field label="Joining Date"    value={fmtDate(p.joiningDate)} />
                  <Field label="Role"            value={getUserRoleLabel(user.role) || user.role} capitalize />
                  <Field label="Org Level"       value={prettyEmp(user.orgLevel)} capitalize />
                  <Field label="Team Capsule"    value={user.teamCapsule} />
                </div>
              </section>
            )}

            {activeTab === "Time" && (
              <div className="text-center py-14 px-6">
                <Calendar size={32} className="mx-auto text-slate-300 mb-3" strokeWidth={1.5} />
                <p className="text-[13px] text-slate-600 mb-1">Attendance & time logs live on the Attendance page.</p>
                <Link href="/dashboard/hr/attendance" className="text-[#008CFF] hover:underline text-[13px] font-semibold">
                  Open Attendance →
                </Link>
              </div>
            )}

            {activeTab === "Documents" && (
              <section>
                <h3 className="text-[13px] font-bold text-slate-800 mb-3 uppercase tracking-wide">Employee Documents</h3>
                {user.documents?.length > 0 ? (
                  <div className="space-y-2">
                    {user.documents.map((doc: any) => (
                      <div key={doc.id} className="flex items-center gap-3 bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                        <div className="h-9 w-9 rounded-lg bg-[#008CFF]/10 text-[#008CFF] flex items-center justify-center shrink-0">
                          <FileText size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{doc.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">{doc.category || "Document"} · {fmtDate(doc.createdAt)}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                          doc.verificationStatus === "verified"
                            ? "bg-emerald-50 text-emerald-600"
                            : "bg-amber-50 text-amber-600"
                        }`}>{doc.verificationStatus || "pending"}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon={FileText} label="No documents uploaded yet" />}
              </section>
            )}

            {activeTab === "Assets" && (
              <section>
                <h3 className="text-[13px] font-bold text-slate-800 mb-3 uppercase tracking-wide">Assigned Assets</h3>
                {user.assets?.length > 0 ? (
                  <div className="space-y-2">
                    {user.assets.map((asset: any) => (
                      <div key={asset.id} className="flex items-center gap-3 bg-slate-50 rounded-lg px-4 py-3 border border-slate-100">
                        <div className="h-9 w-9 rounded-lg bg-[#008CFF]/10 text-[#008CFF] flex items-center justify-center shrink-0">
                          <Laptop size={16} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{asset.name}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {asset.category || "Asset"}{asset.serialNumber ? ` · ${asset.serialNumber}` : ""}
                          </p>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
                          asset.condition === "good" || asset.condition === "new"
                            ? "bg-emerald-50 text-emerald-600"
                            : asset.condition === "fair"
                            ? "bg-amber-50 text-amber-600"
                            : "bg-rose-50 text-rose-600"
                        }`}>{asset.condition || "—"}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState icon={Laptop} label="No assets assigned" />}
              </section>
            )}
          </div>
        </main>

        {/* ── Right: Reporting Team ── */}
        <aside className="col-span-12 lg:col-span-3 p-5">
          <div className="sticky top-6 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[13px] font-bold text-slate-800 uppercase tracking-wide inline-flex items-center gap-2">
                <UsersIcon size={14} className="text-[#008CFF]" />
                Reporting Team
              </h3>
              <span className="text-[11px] text-slate-500 font-semibold bg-slate-100 px-2 py-0.5 rounded-full tabular-nums">
                {directReports.length}
              </span>
            </div>

            {directReports.length > 0 && (
              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={teamQuery}
                  onChange={(e) => setTeamQuery(e.target.value)}
                  placeholder="Search by name…"
                  className="w-full h-8 pl-8 pr-3 bg-white border border-slate-200 rounded-lg text-[12px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#008CFF]"
                />
              </div>
            )}

            <div className="space-y-1">
              {filteredReports.length > 0 ? filteredReports.map((member: any) => (
                <Link key={member.id} href={`/dashboard/hr/people/${member.id}`}
                  className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                  <Avatar url={member.profilePictureUrl} name={member.name} size={32} fontSize={11} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] text-slate-800 font-semibold truncate">{member.name}</p>
                    <p className="text-[10.5px] text-slate-500 truncate">
                      {getUserRoleLabel(member.role) || "Team Member"}
                    </p>
                  </div>
                </Link>
              )) : (
                <p className="text-[12px] text-slate-500 text-center py-6">
                  {directReports.length === 0 ? "No direct reports" : "No matches"}
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="text-center py-12 border border-dashed border-slate-200 rounded-lg">
      <Icon size={28} className="mx-auto text-slate-300 mb-2" strokeWidth={1.5} />
      <p className="text-[13px] text-slate-500">{label}</p>
    </div>
  );
}
