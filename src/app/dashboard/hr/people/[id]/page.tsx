"use client";
import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getUserRoleLabel } from "@/lib/user-role-options";
import { parseAttLoc, type AttLoc } from "@/lib/attendance-location";
import {
  Mail, Phone, MapPin, Briefcase, Calendar, Building2, IdCard, FileText, Laptop,
  Users as UsersIcon, Home, Search, User as UserIcon, ShieldCheck, X, Plus, Pencil,
} from "lucide-react";
import { DatePicker as SharedDatePicker } from "@/components/ui/date-picker";
import { isHRAdmin as canViewAsHRAdmin } from "@/lib/access";

const TABS = ["About", "Profile", "Job", "Attendance", "Documents", "Assets"] as const;
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
  const userId = Number(id);
  const { data: user, isLoading } = useSWR(`/api/hr/people/${id}`, fetcher);
  const [activeTab, setActiveTab] = useState<Tab>("About");
  const [teamQuery, setTeamQuery] = useState("");
  const { data: session } = useSession();
  const me = session?.user as any;
  // Same gate the PUT endpoint enforces — anyone in this set can edit other
  // employees' profiles via the people detail page. Includes ceo / dev /
  // special_access / role=admin / hr_manager.
  const isHRAdmin = canViewAsHRAdmin(me);
  const canEdit = isHRAdmin;
  const [editSection, setEditSection] = useState<null | "primary" | "contact" | "address" | "identity">(null);

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
    <div className="-mx-6 -mt-6 min-h-screen bg-[#f4f7fb]">
      {/* ── Identity card — banner + avatar + identity + contact + dept + tabs all in one rounded card ── */}
      <div className="px-6 pt-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.06)]">
          {/* Identity panel — clean white with a thin brand accent stripe up top */}
          <div className="relative">
            {/* Thin brand-blue accent stripe at the very top of the card */}
            <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#0f6ecd] via-[#008CFF] to-[#0f6ecd]" />

            <div className="flex items-center gap-6 px-8 pb-6 pt-8">
              <div className="rounded-full bg-white p-1 shadow-[0_4px_18px_rgba(15,23,42,0.10)] ring-1 ring-slate-200">
                <Avatar url={user.profilePictureUrl} name={user.name} size={104} fontSize={32} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-[24px] font-bold leading-none tracking-[-0.01em] text-slate-800">
                    {user.name}
                  </h1>
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-inset ring-emerald-200"
                    title="India"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    IN
                  </span>
                  {!isActive ? (
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-inset ring-slate-200">
                      Inactive
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
                  <Briefcase className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
                  {p.designation || getUserRoleLabel(user.role) || "Employee"}
                </p>
                {p.employeeId ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11.5px] text-slate-400">
                    <IdCard className="h-3 w-3" />
                    {p.employeeId}
                  </p>
                ) : null}
              </div>

              {/* Right-side micro action bar (kebab + status) — keeps the right side from feeling empty */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider ring-1 ring-inset ${
                  isActive
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-slate-50 text-slate-500 ring-slate-200"
                }`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                  {isActive ? "Active" : "Inactive"}
                </span>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="More"
                  aria-label="More actions"
                >
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="5" cy="12" r="1.6" />
                    <circle cx="12" cy="12" r="1.6" />
                    <circle cx="19" cy="12" r="1.6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Contact strip */}
          <div className="border-t border-slate-100 px-7 py-4">
            <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5">
              {user.email ? (
                <a href={`mailto:${user.email}`} className="inline-flex items-center gap-2 text-[12.5px] text-[#008CFF] hover:underline">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  <span>{user.email}</span>
                </a>
              ) : null}
              {p.phone ? (
                <a href={`tel:${p.phone}`} className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 hover:text-[#008CFF]">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <span>{p.phone}</span>
                </a>
              ) : null}
              {(p.city || p.workLocation) ? (
                <span className="inline-flex items-center gap-2 text-[12.5px] text-slate-700">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span>{p.city || p.workLocation}</span>
                </span>
              ) : null}
              {p.employeeId ? (
                <span className="inline-flex items-center gap-2 font-mono text-[12.5px] text-slate-700">
                  <IdCard className="h-3.5 w-3.5 text-slate-400" />
                  {p.employeeId}
                </span>
              ) : null}
            </div>
          </div>

          {/* Department strip */}
          <div className="border-t border-slate-100 px-7 py-4">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Business Unit</p>
                <p className="mt-1 text-[13px] font-medium text-slate-800">{user.teamCapsule || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Department</p>
                <p className="mt-1 text-[13px] font-medium text-slate-800">{p.department || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Reporting Manager</p>
                {user.manager ? (
                  <Link href={`/dashboard/hr/people/${user.manager.id}`}
                    className="mt-1 inline-flex items-center gap-2 text-[13px] font-medium text-[#008CFF] hover:underline">
                    <Avatar url={user.manager.profilePictureUrl} name={user.manager.name} size={22} fontSize={9} />
                    <span>{user.manager.name}</span>
                  </Link>
                ) : (
                  <p className="mt-1 text-[13px] font-medium text-slate-400">—</p>
                )}
              </div>
            </div>
          </div>

          {/* Tab bar — sits at the bottom of the identity card */}
          <div className="border-t border-slate-100 px-7">
            <div className="flex gap-0 overflow-x-auto">
              {TABS.map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-3.5 text-[11.5px] font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                    activeTab === tab
                      ? "text-[#008CFF]"
                      : "text-slate-500 hover:text-slate-800"
                  }`}>
                  {tab}
                  {activeTab === tab && (
                    <>
                      <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#008CFF]" />
                      <span className="pointer-events-none absolute left-1/2 -bottom-[5px] -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#008CFF]" />
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* About sub-tabs (decorative — single Summary view backed by data) */}
        {activeTab === "About" ? (
          <div className="mb-5 flex items-center gap-4 border-b border-slate-200">
            <span className="border-b-2 border-slate-700 pb-2.5 text-[13px] font-semibold text-slate-800">Summary</span>
            <span className="pb-2.5 text-[13px] font-medium text-slate-400">Timeline</span>
            <span className="pb-2.5 text-[13px] font-medium text-slate-400">Wall Activity</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <main className="min-w-0 space-y-5">
            {activeTab === "About" && (
              <>
                {/* About card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <h3 className="mb-3 inline-flex items-center gap-2 text-[15px] font-semibold text-slate-800">
                    About <span className="text-slate-300">✏️</span>
                  </h3>
                  <p className="text-[13px] leading-relaxed text-slate-600">
                    {p.about || `Hi I am ${user.name}.`}
                  </p>

                  <h4 className="mt-5 inline-flex items-center gap-2 text-[14px] font-semibold text-slate-800">
                    What I love about my job? <span className="text-slate-300">✏️</span>
                  </h4>
                  <p className="mt-1 text-[12.5px] text-slate-600">{p.jobLove || "—"}</p>

                  <h4 className="mt-5 inline-flex items-center gap-2 text-[14px] font-semibold text-slate-800">
                    My interests and hobbies <span className="text-slate-300">✏️</span>
                  </h4>
                  <p className="mt-1 text-[12.5px] text-slate-600">{p.hobbies || "N/A"}</p>
                </section>

                {/* Primary Details card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <h3 className="mb-4 text-[15px] font-semibold text-slate-800">Primary Details</h3>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Compact label="First Name"   value={p.firstName || (user.name?.split(" ")[0] ?? user.name)} />
                    <Compact label="Last Name"    value={p.lastName  || user.name?.split(" ").slice(1).join(" ")} />
                    <Compact label="Gender"       value={p.gender} capitalize />
                    <Compact label="Date of Birth" value={fmtDate(p.dateOfBirth)} />
                    <Compact label="Marital Status" value={p.maritalStatus} capitalize />
                    <Compact label="Physically Handicapped" value={p.physicallyHandicapped ? "Yes" : "No"} />
                    <Compact label="Nationality"  value={p.nationality} />
                    <Compact label="Blood Group"  value={p.bloodGroup} />
                  </div>
                </section>

                {/* Contact card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                  <h3 className="mb-4 text-[15px] font-semibold text-slate-800">Contact</h3>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                    <Compact label="Email"             value={user.email} />
                    <Compact label="Phone"             value={p.phone} />
                    <Compact label="Emergency Contact" value={p.emergencyContact} />
                    <Compact label="Emergency Phone"   value={p.emergencyPhone} />
                    <div className="col-span-2">
                      <Compact label="Address" value={[p.address, p.city, p.state].filter(Boolean).join(", ")} />
                    </div>
                  </div>
                </section>
              </>
            )}

            {activeTab === "Profile" && (
              <div className="space-y-5">
                {/* ── Primary Details ── */}
                <DetailCard title="Primary Details" onEdit={canEdit ? () => setEditSection("primary") : undefined}>
                  <Grid3>
                    <KV label="First Name"            value={p.firstName ?? user.name?.split(" ")[0]} />
                    <KV label="Middle Name"           value={p.middleName} />
                    <KV label="Last Name"             value={p.lastName ?? user.name?.split(" ").slice(1).join(" ")} />
                    <KV label="Display Name"          value={user.name} />
                    <KV label="Date of Birth"         value={fmtDate(p.dateOfBirth)} />
                    <KV label="Gender"                value={p.gender} capitalize />
                    <KV label="Blood Group"           value={p.bloodGroup} />
                    <KV label="Marital Status"        value={p.maritalStatus} capitalize />
                    <KV label="Nationality"           value={p.nationality} />
                  </Grid3>
                </DetailCard>

                {/* ── Contact Details ── */}
                <DetailCard title="Contact Details" onEdit={canEdit ? () => setEditSection("contact") : undefined}>
                  <Grid3>
                    <KV label="Work Email"     value={user.email} />
                    <KV label="Personal Email" value={p.personalEmail} />
                    <KV label="Mobile Number"  value={p.phone} />
                    <KV label="Work Number"    value={p.workPhone} />
                    <KV label="Emergency Contact" value={p.emergencyContact} />
                    <KV label="Emergency Phone"   value={p.emergencyPhone} />
                  </Grid3>
                </DetailCard>

                {/* ── Addresses ── */}
                <DetailCard title="Addresses" onEdit={canEdit ? () => setEditSection("address") : undefined}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400 font-semibold mb-1.5">Current Address</p>
                      <p className="text-[13px] text-slate-800 leading-relaxed">
                        {p.address || "—"}
                      </p>
                      {(p.city || p.state) && (
                        <p className="text-[12.5px] text-slate-600 mt-1">
                          {[p.city, p.state, p.nationality].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400 font-semibold mb-1.5">Permanent Address</p>
                      <p className="text-[13px] text-slate-800 leading-relaxed">
                        {p.address || "—"}
                      </p>
                      {(p.city || p.state) && (
                        <p className="text-[12.5px] text-slate-600 mt-1">
                          {[p.city, p.state, p.nationality].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                </DetailCard>

                {/* ── Identity Information (PAN / Aadhaar) ── */}
                {(p.panNumber || p.aadhaarNumber || p.parentName || canEdit) && (
                  <DetailCard
                    title="Identity Information"
                    onEdit={canEdit ? () => setEditSection("identity") : undefined}
                  >
                    <Grid3>
                      <KV label="PAN Number"     value={maskPan(p.panNumber)} />
                      <KV label="Aadhaar Number" value={maskAadhaar(p.aadhaarNumber)} />
                      <KV label="Parent's Name"  value={p.parentName} />
                    </Grid3>
                    <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                      <ShieldCheck size={12} />
                      Sensitive data — visible only to HR / CEO / admins.
                    </p>
                  </DetailCard>
                )}
              </div>
            )}

            {activeTab === "Job" && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <h3 className="mb-4 text-[15px] font-semibold text-slate-800">Job Details</h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                  <Compact label="Department"      value={p.department} />
                  <Compact label="Designation"     value={p.designation} />
                  <Compact label="Employment Type" value={prettyEmp(p.employmentType)} capitalize />
                  <Compact label="Work Location"   value={p.workLocation} />
                  <Compact label="Joining Date"    value={fmtDate(p.joiningDate)} />
                  <Compact label="Role"            value={getUserRoleLabel(user.role) || user.role} capitalize />
                  <Compact label="Org Level"       value={prettyEmp(user.orgLevel)} capitalize />
                  <Compact label="Team Capsule"    value={user.teamCapsule} />
                </div>
              </section>
            )}

            {activeTab === "Attendance" && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <EmployeeTimePanel userId={userId} userName={user.name} isHRAdmin={isHRAdmin} />
              </section>
            )}

            {activeTab === "Documents" && (
              <DocumentsPanel profile={p} documents={user.documents || []} />
            )}

            {activeTab === "Assets" && (
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <h3 className="mb-4 text-[15px] font-semibold text-slate-800">Assigned Assets</h3>
                {user.assets?.length > 0 ? (
                  <div className="space-y-2">
                    {user.assets.map((asset: any) => (
                      <div key={asset.id} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
                          <Laptop size={16} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-slate-800">{asset.name}</p>
                          <p className="truncate text-[11px] text-slate-500">
                            {asset.category || "Asset"}{asset.serialNumber ? ` · ${asset.serialNumber}` : ""}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
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
          </main>

          {/* ── Right rail: Reporting Team (sticky on lg+) ── */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-slate-800">
                  <UsersIcon size={14} className="text-[#008CFF]" />
                  Reporting Team
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-500">
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
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[12px] text-slate-800 placeholder-slate-400 focus:border-[#008CFF] focus:outline-none"
                  />
                </div>
              )}

              <div className="space-y-1">
                {filteredReports.length > 0 ? filteredReports.map((member: any) => (
                  <Link key={member.id} href={`/dashboard/hr/people/${member.id}`}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50">
                    <Avatar url={member.profilePictureUrl} name={member.name} size={32} fontSize={11} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-slate-800">{member.name}</p>
                      <p className="truncate text-[10.5px] text-slate-500">
                        {getUserRoleLabel(member.role) || "Team Member"}
                      </p>
                    </div>
                  </Link>
                )) : (
                  <p className="py-6 text-center text-[12px] text-slate-500">
                    {directReports.length === 0 ? "No direct reports" : "No matches"}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Edit modal — only mounted while a section is being edited. */}
      {editSection && (
        <ProfileEditModal
          section={editSection}
          userId={userId}
          user={user}
          onClose={() => setEditSection(null)}
        />
      )}
    </div>
  );
}

// Compact stacked label/value used inside Keka-style detail cards.
function Compact({ label, value, capitalize = false }: { label: string; value?: string | null; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 text-[13px] text-slate-800 ${capitalize ? "capitalize" : ""}`}>{value || "—"}</p>
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

// ─────────────────────────────────────────────────────────────────────────────
//  Profile / Documents — Keka-style detail building blocks
// ─────────────────────────────────────────────────────────────────────────────

function DetailCard({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-slate-100">
        <h3 className="text-[14px] font-semibold text-slate-800">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#008CFF] hover:underline"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-5">{children}</div>;
}

function KV({ label, value, capitalize = false }: { label: string; value?: string | null; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className={`mt-1 text-[13px] text-slate-800 ${capitalize ? "capitalize" : ""}`}>{value || "—"}</p>
    </div>
  );
}

// Mask helpers — show only the trailing 4 chars/digits.
function maskAadhaar(v?: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.length < 4) return v;
  return `XXXX-XXXX-${digits.slice(-4)}`;
}
function maskPan(v?: string | null): string | null {
  if (!v) return null;
  const t = v.toUpperCase();
  if (t.length < 4) return t;
  return `XXXXXX${t.slice(-4)}`;
}

// Folder labels match the categories used in /api/hr/profile uploads.
const DOC_FOLDERS: { key: string; label: string; cats: string[] }[] = [
  { key: "identity",    label: "Identity Docs",          cats: ["id_proof", "aadhar", "pan_card"] },
  { key: "letters",     label: "Employee Letters",       cats: ["offer_letter", "experience_letter", "contract"] },
  { key: "previous",    label: "Previous Experience",    cats: ["experience_letter", "payslip"] },
  { key: "other",       label: "Other",                  cats: ["other"] },
];

function DocumentsPanel({ profile, documents }: { profile: any; documents: any[] }) {
  const [folder, setFolder] = useState<string>("identity");
  const active = DOC_FOLDERS.find((f) => f.key === folder)!;
  const filesInFolder = documents.filter((d) => active.cats.includes((d.category || "").toLowerCase()));

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-[14px] font-semibold text-slate-800">Employee Documents</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr]">
        {/* Folder sidebar */}
        <div className="border-b md:border-b-0 md:border-r border-slate-100 py-2 bg-slate-50/40">
          <p className="px-4 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Folders</p>
          {DOC_FOLDERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFolder(f.key)}
              className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center gap-2 transition-colors ${
                folder === f.key
                  ? "bg-[#008CFF]/10 text-[#008CFF] font-semibold"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <FileText size={14} className="shrink-0" />
              {f.label}
            </button>
          ))}
        </div>
        {/* Folder body */}
        <div className="p-6 space-y-5">
          {folder === "identity" && (
            <>
              {/* Aadhaar Card panel — built from EmployeeProfile fields */}
              {(profile.aadhaarNumber || profile.aadhaarEnrollment) && (
                <IdDocCard
                  flag="🇮🇳"
                  title="Aadhaar Card"
                  status={profile.aadhaarNumber ? "verified" : "pending"}
                  rows={[
                    ["Aadhaar Number",     maskAadhaar(profile.aadhaarNumber) || "—"],
                    ["Enrollment Number",  profile.aadhaarEnrollment || "Not Available"],
                    ["Date of Birth",      fmtDate(profile.dateOfBirth)],
                    ["Name",               [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "—"],
                    ["Address",            (profile.address || "—").slice(0, 28) + ((profile.address || "").length > 28 ? "…" : "")],
                    ["Gender",             profile.gender ? profile.gender[0].toUpperCase() + profile.gender.slice(1) : "—"],
                  ]}
                />
              )}
              {/* PAN Card panel */}
              {(profile.panNumber || profile.parentName) && (
                <IdDocCard
                  flag="🇮🇳"
                  title="Pan Card"
                  status={profile.panNumber ? "verified" : "pending"}
                  rows={[
                    ["Permanent Account Number", maskPan(profile.panNumber) || "—"],
                    ["Name",                     [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "—"],
                    ["Date of Birth",            fmtDate(profile.dateOfBirth)],
                    ["Parent's Name",            profile.parentName || "—"],
                  ]}
                />
              )}
              {!profile.aadhaarNumber && !profile.panNumber && filesInFolder.length === 0 && (
                <EmptyState icon={IdCard} label="No identity documents on file" />
              )}
            </>
          )}

          {/* File list — appears in every folder for files that match the folder's categories */}
          {filesInFolder.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
                Uploaded files
              </p>
              <div className="space-y-2">
                {filesInFolder.map((doc: any) => (
                  <a
                    key={doc.id}
                    href={doc.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-[#008CFF]/40 hover:bg-[#008CFF]/[0.02] transition-colors"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
                      <FileText size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-slate-800">{doc.fileName || doc.name}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {(doc.category || "Document").replace(/_/g, " ")} · {fmtDate(doc.createdAt)}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      doc.isVerified
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-amber-50 text-amber-600"
                    }`}>
                      {doc.isVerified ? "Verified" : "Pending"}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Folder-empty fallback for non-identity folders */}
          {folder !== "identity" && filesInFolder.length === 0 && (
            <EmptyState icon={FileText} label={`No documents in ${active.label}`} />
          )}
        </div>
      </div>
    </section>
  );
}

// Single edit modal that swaps its field set based on the section being
// edited. PUTs to /api/hr/people/:id, then revalidates the SWR cache so
// the page reflects the change without a full reload.
function ProfileEditModal({
  section, userId, user, onClose,
}: {
  section: "primary" | "contact" | "address" | "identity";
  userId: number;
  user: any;
  onClose: () => void;
}) {
  const p = user.profile || {};
  const dateISO = (v: any) =>
    v ? (typeof v === "string" ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10)) : "";
  const initial: Record<string, string> = {
    displayName: user.name ?? "",
    firstName:   p.firstName ?? "",
    middleName:  p.middleName ?? "",
    lastName:    p.lastName ?? "",
    dateOfBirth: dateISO(p.dateOfBirth),
    gender:      p.gender ?? "",
    bloodGroup:  p.bloodGroup ?? "",
    maritalStatus: p.maritalStatus ?? "",
    personalEmail: p.personalEmail ?? "",
    phone:       p.phone ?? "",
    workPhone:   p.workPhone ?? "",
    emergencyContact: p.emergencyContact ?? "",
    emergencyPhone:   p.emergencyPhone ?? "",
    address:     p.address ?? "",
    city:        p.city ?? "",
    state:       p.state ?? "",
    panNumber:   "",  // Plaintext field — empty by default; HR can re-enter to update.
    aadhaarNumber: "",
    aadhaarEnrollment: "",
    parentName:  p.parentName ?? "",
  };
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const set = (k: keyof typeof initial, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const SECTIONS: Record<typeof section, { title: string; fields: Array<{ key: keyof typeof initial; label: string; type?: string; options?: string[]; fullWidth?: boolean }> }> = {
    primary: {
      title: "Primary Details",
      fields: [
        { key: "firstName",  label: "First Name" },
        { key: "middleName", label: "Middle Name" },
        { key: "lastName",   label: "Last Name" },
        { key: "dateOfBirth", label: "Date of Birth", type: "dob" },
        { key: "gender",      label: "Gender",        options: ["Male", "Female", "Other", "Prefer not to say"] },
        { key: "bloodGroup",  label: "Blood Group",   options: ["A+","A-","B+","B-","O+","O-","AB+","AB-"] },
        { key: "maritalStatus", label: "Marital Status", options: ["Single","Married","Divorced","Widowed"] },
      ],
    },
    contact: {
      title: "Contact Details",
      fields: [
        { key: "personalEmail",    label: "Personal Email", type: "email", fullWidth: true },
        { key: "phone",            label: "Mobile Number",  type: "tel" },
        { key: "workPhone",        label: "Work Number",    type: "tel" },
        { key: "emergencyContact", label: "Emergency Contact" },
        { key: "emergencyPhone",   label: "Emergency Phone", type: "tel" },
      ],
    },
    address: {
      title: "Addresses",
      fields: [
        { key: "address", label: "Street Address", fullWidth: true },
        { key: "city",    label: "City" },
        { key: "state",   label: "State" },
      ],
    },
    identity: {
      title: "Identity Information",
      fields: [
        { key: "panNumber",         label: "PAN Number" },
        { key: "aadhaarNumber",     label: "Aadhaar Number" },
        { key: "aadhaarEnrollment", label: "Aadhaar Enrollment" },
        { key: "parentName",        label: "Parent's Name" },
      ],
    },
  };
  const cfg = SECTIONS[section];

  const onSave = async () => {
    setSaving(true);
    setError("");
    // Only send the fields relevant to the active section. Empty strings
    // for identity are skipped so HR doesn't accidentally wipe a stored
    // PAN by opening the modal and saving with the field blank.
    const patch: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      const v = form[f.key];
      if (section === "identity" && (!v || v.trim().length === 0)) continue;
      patch[f.key] = v;
    }
    if (section === "primary") {
      const fullName = [form.firstName, form.middleName, form.lastName]
        .filter(Boolean).join(" ").trim();
      if (fullName) patch.displayName = fullName;
    }
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      await mutate(`/api/hr/people/${userId}`);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">{cfg.title}</h3>
          <button onClick={onClose}>
            <X size={18} className="text-slate-400 hover:text-slate-700" />
          </button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          {cfg.fields.map((f) => (
            <div key={f.key as string} className={f.fullWidth || f.type === "dob" ? "col-span-2" : ""}>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">{f.label}</label>
              {f.type === "dob" ? (
                <SharedDatePicker value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
              ) : f.options ? (
                <select
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                >
                  <option value="">Select…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                />
              )}
            </div>
          ))}
        </div>
        {error && <p className="px-6 pb-2 text-[12px] text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-500 hover:text-slate-800">Cancel</button>
          <button
            onClick={onSave}
            disabled={saving}
            className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IdDocCard({
  flag, title, status, rows,
}: {
  flag: string;
  title: string;
  status: "verified" | "pending";
  rows: [string, string][];
}) {
  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="text-[16px]">{flag}</span>
          <span className="text-[13px] font-semibold text-slate-800">{title}</span>
          <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            status === "verified"
              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              : "bg-amber-50  text-amber-700  ring-1 ring-amber-200"
          }`}>
            {status}
          </span>
        </div>
      </div>
      <div className="px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-4">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{label}</p>
            <p className="mt-1 text-[13px] text-slate-800">{value || "—"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Time tab — admin-facing attendance log + on-behalf actions
// ─────────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

function fmtMins(m: number): string {
  if (!m || m <= 0) return "—";
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${mm}m`;
}

function statusPill(status: string) {
  const map: Record<string, string> = {
    present:   "bg-emerald-50 text-emerald-700 ring-emerald-200",
    late:      "bg-amber-50  text-amber-700  ring-amber-200",
    absent:    "bg-red-50    text-red-700    ring-red-200",
    half_day:  "bg-orange-50 text-orange-700 ring-orange-200",
    on_leave:  "bg-violet-50 text-violet-700 ring-violet-200",
    holiday:   "bg-sky-50    text-sky-700    ring-sky-200",
    weekly_off:"bg-slate-100 text-slate-600  ring-slate-200",
    pending:   "bg-slate-100 text-slate-600  ring-slate-200",
  };
  const cls = map[status] || "bg-slate-100 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${cls}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// Shift window for the timeline bar: 9 AM → 6 PM IST (540 minutes).
const SHIFT_START_MIN = 9 * 60;   // minutes since midnight IST
const SHIFT_END_MIN   = 18 * 60;
const SHIFT_LEN       = SHIFT_END_MIN - SHIFT_START_MIN;

// Convert a UTC clock-time to minutes-since-midnight IST.
function toIstMin(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(d).reduce<Record<string, string>>((a, p) => { a[p.type] = p.value; return a; }, {});
  return parseInt(parts.hour || "0", 10) * 60 + parseInt(parts.minute || "0", 10);
}

function LocationLink({ raw }: { raw: string | null | undefined }) {
  const loc: AttLoc = parseAttLoc(raw);
  // Nothing to show if the row never captured a location.
  if (!raw || (loc.lat === undefined && !loc.address && !loc.mode)) return null;

  const hasCoords = typeof loc.lat === "number" && typeof loc.lng === "number";
  const href = hasCoords
    ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
    : loc.address
      ? `https://www.google.com/maps/search/${encodeURIComponent(loc.address)}`
      : null;

  // Tooltip — shows the captured address (best-effort reverse-geocode) plus
  // mode/coords as a fallback if no address resolved.
  const tooltip = [
    loc.mode === "remote" ? "Remote" : loc.mode === "office" ? "Office" : null,
    loc.address,
    hasCoords ? `${loc.lat?.toFixed(5)}, ${loc.lng?.toFixed(5)}` : null,
  ].filter(Boolean).join(" · ");

  // Soft mode-tinted dot underneath the pin so HR can scan office vs remote.
  const tone =
    loc.mode === "remote" ? "text-sky-600 hover:bg-sky-50" :
    loc.mode === "office" ? "text-emerald-600 hover:bg-emerald-50" :
                            "text-slate-500 hover:bg-slate-100";

  if (!href) {
    return (
      <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${tone}`} title={tooltip || "Location"}>
        <MapPin className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip || "Open in Google Maps"}
      className={`inline-flex h-6 w-6 items-center justify-center rounded transition ${tone}`}
      onClick={(e) => e.stopPropagation()}
    >
      <MapPin className="h-3.5 w-3.5" />
    </a>
  );
}

type BarTone = "default" | "pending" | "approved";

function TimelineBar({
  clockIn, clockOut, tone = "default",
}: { clockIn: string | Date | null; clockOut: string | Date | null; tone?: BarTone }) {
  // 9-to-6 shift window. Clamp the filled bar to the window edges.
  const inMin  = clockIn  ? toIstMin(new Date(clockIn))  : null;
  const outMin = clockOut ? toIstMin(new Date(clockOut)) : null;
  const startPct = inMin  != null ? Math.max(0,   ((inMin  - SHIFT_START_MIN) / SHIFT_LEN) * 100) : 0;
  const endPct   = outMin != null ? Math.min(100, ((outMin - SHIFT_START_MIN) / SHIFT_LEN) * 100) : 0;
  const widthPct = Math.max(0, endPct - startPct);
  const hasBar   = !!(clockIn && clockOut);

  const fmt = (d: Date | null) => d
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    : "—";
  const title = clockIn
    ? `${fmt(new Date(clockIn))} → ${fmt(clockOut ? new Date(clockOut) : null)}${
        tone === "pending"  ? " · Regularization pending"  :
        tone === "approved" ? " · Regularization approved" : ""}`
    : undefined;

  // Tone palette: default (sky), pending (amber-striped), approved (emerald)
  const toneCls =
    tone === "pending"
      ? { fill: "from-[#fbbf24] to-[#f59e0b]", glow: "0 2px 5px rgba(245,158,11,0.35)", ring: "#f59e0b" }
      : tone === "approved"
        ? { fill: "from-[#34d399] to-[#10b981]", glow: "0 2px 5px rgba(16,185,129,0.35)", ring: "#10b981" }
        : { fill: "from-[#38bdf8] to-[#0ea5e9]", glow: "0 2px 5px rgba(14,165,233,0.35)", ring: "#0ea5e9" };

  return (
    <div className="group relative h-5 w-full" title={title}>
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/60" />

      {hasBar ? (
        <>
          {/* Filled bar */}
          <div
            className={`absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full bg-gradient-to-r ${toneCls.fill} ${tone === "pending" ? "opacity-80" : ""}`}
            style={{ left: `${startPct}%`, width: `${widthPct}%`, boxShadow: toneCls.glow }}
          />
          {/* Diagonal stripe overlay on PENDING bars — signals "tentative" without
              shouting. Pure CSS, no extra DOM. */}
          {tone === "pending" ? (
            <div
              className="absolute top-1/2 h-[8px] -translate-y-1/2 rounded-full"
              style={{
                left: `${startPct}%`,
                width: `${widthPct}%`,
                backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,0.35) 0 4px, transparent 4px 8px)",
              }}
            />
          ) : null}
          {/* Endpoint dots */}
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${startPct}%`, boxShadow: `0 0 0 2px ${toneCls.ring}` }}
          />
          <span
            className="absolute top-1/2 h-[12px] w-[12px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.20)]"
            style={{ left: `${endPct}%`, boxShadow: `0 0 0 2px ${toneCls.ring}` }}
          />
        </>
      ) : null}
    </div>
  );
}

function EmployeeTimePanel({ userId, userName, isHRAdmin }: { userId: number; userName: string; isHRAdmin: boolean }) {
  const today = new Date();

  // Period selector: "30d" | "YYYY-MM"
  type Period = "30d" | string;
  const [period, setPeriod] = useState<Period>("30d");

  // API URL based on period.
  const url = (() => {
    if (period === "30d") {
      const end = new Date();
      const start = new Date(end); start.setDate(start.getDate() - 29);
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      return `/api/hr/attendance?userId=${userId}&from=${iso(start)}&to=${iso(end)}`;
    }
    return `/api/hr/attendance?userId=${userId}&month=${period}`;
  })();
  const { data, isLoading } = useSWR(url, fetcher);
  const records: any[] = data?.records ?? [];

  // Status rank for "best" choice when multiple requests exist for the same date.
  // Pending > partially_approved > approved > rejected/cancelled.
  const statusRank = (s: string) =>
    s === "pending" ? 4 : s === "partially_approved" ? 3 : s === "approved" ? 2 : 1;

  // Regularization requests — admins fetch all then filter client-side; users get view=my.
  const regsUrl = isHRAdmin ? "/api/hr/attendance/regularize?view=all" : "/api/hr/attendance/regularize?view=my";
  const { data: regsData = [] } = useSWR<any[]>(regsUrl, fetcher);

  // WFH requests
  const wfhUrl = isHRAdmin ? "/api/hr/attendance/wfh?view=all" : "/api/hr/attendance/wfh?view=my";
  const { data: wfhData = [] } = useSWR<any[]>(wfhUrl, fetcher);

  // Leave applications
  const leavesUrl = isHRAdmin ? "/api/hr/leaves?view=all" : "/api/hr/leaves?view=my";
  const { data: leavesRaw } = useSWR<any>(leavesUrl, fetcher);
  const leavesData: any[] = Array.isArray(leavesRaw)
    ? leavesRaw
    : (leavesRaw?.applications ?? leavesRaw?.items ?? []);

  // Build per-date maps for THIS user.
  const regByDate = (() => {
    const map = new Map<string, any>();
    if (!Array.isArray(regsData)) return map;
    for (const r of regsData) {
      if (r.userId !== userId) continue;
      const k = String(r.date).slice(0, 10);
      const prev = map.get(k);
      if (!prev || statusRank(r.status) > statusRank(prev.status)) map.set(k, r);
    }
    return map;
  })();

  const wfhByDate = (() => {
    const map = new Map<string, any>();
    if (!Array.isArray(wfhData)) return map;
    for (const w of wfhData) {
      if (w.userId !== userId) continue;
      const k = String(w.date).slice(0, 10);
      const prev = map.get(k);
      if (!prev || statusRank(w.status) > statusRank(prev.status)) map.set(k, w);
    }
    return map;
  })();

  // Leaves are date-RANGES — find the best applicable leave for a given day.
  const userLeaves = leavesData.filter((l: any) => l.userId === userId);
  const findLeaveForDate = (dateOnly: string): any | null => {
    let best: any = null;
    for (const l of userLeaves) {
      const from = String(l.fromDate).slice(0, 10);
      const to   = String(l.toDate).slice(0, 10);
      if (dateOnly >= from && dateOnly <= to) {
        if (!best || statusRank(l.status) > statusRank(best.status)) best = l;
      }
    }
    return best;
  };

  // Build a complete day-by-day series (incl. weekends + absent gaps), newest first.
  const fullSeries = (() => {
    let start: Date, end: Date;
    if (period === "30d") {
      end = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
      start = new Date(end.getTime()); start.setUTCDate(start.getUTCDate() - 29);
    } else {
      const [y, m] = period.split("-").map(Number);
      start = new Date(Date.UTC(y, m - 1, 1));
      end   = new Date(Date.UTC(y, m, 0));
      const todayUtc = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
      if (end.getTime() > todayUtc.getTime()) end = todayUtc;
    }
    const byDate = new Map<string, any>();
    for (const r of records) byDate.set(String(r.date).slice(0, 10), r);
    const out: any[] = [];
    for (let d = new Date(start.getTime()); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const rec = byDate.get(iso);
      if (rec) out.push(rec);
      else {
        const dow = d.getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        out.push({
          id: `synth-${iso}`,
          date: `${iso}T00:00:00.000Z`,
          clockIn: null, clockOut: null, totalMinutes: 0,
          status: isWeekend ? "weekly_off" : "absent",
        });
      }
    }
    out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return out;
  })();

  // Period button list — matches the Keka layout (30 DAYS + last 6 months).
  const periodButtons: { key: Period; label: string }[] = [
    { key: "30d", label: "30 DAYS" },
    ...Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return { key: k as Period, label: MONTH_NAMES[d.getMonth()].toUpperCase() };
    }),
  ];

  const periodLabel = period === "30d"
    ? "Last 30 Days"
    : (() => {
        const [y, m] = period.split("-").map(Number);
        return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
      })();

  // ── Regularize-on-behalf modal state ────────────────────────────────
  const [regOpen, setRegOpen] = useState(false);
  const [regForm, setRegForm] = useState<{ date: string; requestedIn: string; requestedOut: string; reason: string }>({
    date: "", requestedIn: "", requestedOut: "", reason: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const openRegFor = (rec: any) => {
    const dateOnly = String(rec.date).slice(0, 10);
    setRegForm({
      date: dateOnly,
      requestedIn:  rec.clockIn  ? new Date(rec.clockIn).toISOString().slice(0, 16)  : `${dateOnly}T09:00`,
      requestedOut: rec.clockOut ? new Date(rec.clockOut).toISOString().slice(0, 16) : `${dateOnly}T18:00`,
      reason: "",
    });
    setRegOpen(true);
  };

  const submitReg = async () => {
    if (!regForm.reason.trim()) { alert("Reason is required."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/attendance/regularize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: regForm.date,
          requestedIn:  regForm.requestedIn  ? new Date(regForm.requestedIn).toISOString()  : null,
          requestedOut: regForm.requestedOut ? new Date(regForm.requestedOut).toISOString() : null,
          reason: regForm.reason.trim(),
          userId,
          forceGrant: true,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Regularize failed.");
        return;
      }
      setRegOpen(false);
      mutate(url);
      mutate(regsUrl);
      mutate(wfhUrl);
      mutate(leavesUrl);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      {/* Period bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <h3 className="text-[14px] font-semibold text-slate-800">{periodLabel}</h3>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5">
          {periodButtons.map((b) => (
            <button
              key={b.key}
              onClick={() => setPeriod(b.key)}
              className={`h-7 rounded px-3 text-[10.5px] font-bold uppercase tracking-wider transition ${
                period === b.key
                  ? "bg-[#008CFF] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Attendance table */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="w-[150px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Date</th>
              <th className="w-[280px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Attendance Visual</th>
              <th className="w-[120px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Effective Hours</th>
              <th className="w-[110px] px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Gross Hours</th>
              <th className="w-[60px] px-5 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-[#0f6ecd]">Log</th>
              {isHRAdmin ? <th className="w-[40px] px-3 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={isHRAdmin ? 6 : 5} className="px-4 py-10 text-center text-[12px] text-slate-400">Loading…</td></tr>
            ) : fullSeries.length === 0 ? (
              <tr><td colSpan={isHRAdmin ? 6 : 5} className="px-4 py-10 text-center text-[12px] text-slate-400">No attendance for this period.</td></tr>
            ) : fullSeries.map((rec) => {
              const dateOnly = String(rec.date).slice(0, 10);
              const dt = new Date(rec.date);
              const dateLabel = dt.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
              const isToday   = dateOnly === today.toISOString().slice(0, 10);
              const isWeekend = rec.status === "weekly_off";
              const isHoliday = rec.status === "holiday";
              const isPresent = rec.status === "present" || rec.status === "late" || rec.status === "half_day";

              const reg   = regByDate.get(dateOnly);
              const wfh   = wfhByDate.get(dateOnly);
              const leave = findLeaveForDate(dateOnly);

              const isRegPending  = reg && (reg.status === "pending" || reg.status === "partially_approved");
              const isRegApproved = reg && reg.status === "approved";
              const isWfhPending  = wfh && (wfh.status === "pending" || wfh.status === "partially_approved");
              const isWfhApproved = wfh && wfh.status === "approved";
              const isLeavePending  = leave && (leave.status === "pending" || leave.status === "partially_approved");
              const isLeaveApproved = leave && leave.status === "approved";
              // True if the row should be rendered as a centered "On <X> Leave" banner.
              const isLeaveRow = rec.status === "on_leave" || isLeaveApproved;
              const leaveTypeName = leave?.leaveType?.name || (rec.status === "on_leave" ? "Leave" : null);

              // Admins can regularize any past/today row that doesn't already
              // have a regularization in flight — including leave days (employee
              // actually showed up while on leave) and weekends/holidays
              // (worked on a day off). Future dates are skipped.
              const isFuture = dateOnly > today.toISOString().slice(0, 10);
              const canRegularize = isHRAdmin && !isRegPending && !isFuture;

              // Row background tinting per status — matches the Keka light theme.
              const rowBg =
                isToday      ? "bg-sky-50/50"
                : isLeaveRow ? "bg-violet-50/40"
                : isWeekend  ? "bg-slate-100/60"
                : isHoliday  ? "bg-amber-50/40"
                : "bg-white hover:bg-slate-50/60";

              const totalMin = rec.totalMinutes ?? 0;
              const effectiveDot = totalMin >= 480 ? "bg-emerald-500" : totalMin >= 240 ? "bg-amber-500" : totalMin > 0 ? "bg-red-500" : "bg-slate-300";

              return (
                <tr key={rec.id} className={`border-b border-slate-100 transition-colors ${rowBg}`}>
                  {/* Date + badges */}
                  <td className="px-5 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <p className="text-[12.5px] font-medium text-slate-800">{dateLabel}</p>
                      {isToday        ? <span className="inline-flex items-center rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">Today</span> : null}
                      {isLeaveRow     ? <span className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">Leave</span> : null}
                      {isWeekend      ? <span className="inline-flex items-center rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">W-Off</span> : null}
                      {isHoliday      ? <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">Holiday</span> : null}
                      {isWfhApproved && !isLeaveRow ? <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700">WFH</span> : null}
                    </div>
                  </td>

                  {/* Attendance Visual / centered text — used for all "no real
                      punches" cases (leave / w-off / holiday / pending requests
                      / regularization). Reads cleaner than a striped bar. */}
                  {(() => {
                    const hasActualPunches = !!(rec.clockIn && rec.clockOut);
                    const isRegOnly = !hasActualPunches && (isRegPending || isRegApproved);
                    const showCentered = isWeekend || isLeaveRow || isHoliday
                      || (isLeavePending && !isPresent)
                      || (isWfhPending && !isPresent && !isWfhApproved)
                      || isRegOnly;
                    if (!showCentered) return null;
                    const fmt = (d: string | Date | null | undefined) => d
                      ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
                      : null;
                    const regWindow = reg?.requestedIn && reg?.requestedOut
                      ? `${fmt(reg.requestedIn)} → ${fmt(reg.requestedOut)}`
                      : null;
                    const label = isLeaveRow
                      ? `On ${leaveTypeName || "Leave"}${leave?.totalDays && leave.totalDays > 1 ? ` (${leave.totalDays} days)` : ""}`
                      : isLeavePending  ? `Leave Pending — ${leave?.leaveType?.name || "Leave"}`
                      : isWfhPending    ? "WFH Pending Approval"
                      : isWeekend       ? "Full day Weekly-off"
                      : isHoliday       ? (rec.notes || "Public Holiday")
                      : isRegPending    ? `Regularization Pending${regWindow ? ` · ${regWindow}` : ""}`
                      : isRegApproved   ? `Regularized${regWindow ? ` · ${regWindow}` : ""}`
                      : "";
                    const tone =
                      isLeavePending || isWfhPending || isRegPending ? "text-amber-700"
                      : isLeaveRow                                    ? "text-violet-700"
                      : isRegApproved                                 ? "text-emerald-700"
                      : isHoliday                                     ? "text-amber-700"
                      :                                                 "text-slate-500";
                    return (
                      <td className="px-5 py-3 text-center align-middle" colSpan={3}>
                        <span className={`text-[12.5px] font-medium ${tone}`}>{label}</span>
                      </td>
                    );
                  })() || (
                    <>
                      <td className="px-5 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            {/* If actual punches are missing but a regularization
                                is in flight or approved, draw the bar from the
                                regularization's requested times instead — so the
                                row visualises what attendance would look like once
                                approved. Tone changes color: amber-striped while
                                pending, emerald when approved, sky when actual. */}
                            {(() => {
                              const hasActual = !!(rec.clockIn && rec.clockOut);
                              const useReg = !hasActual && reg && (reg.requestedIn || reg.requestedOut);
                              const barIn  = useReg ? reg.requestedIn  : rec.clockIn;
                              const barOut = useReg ? reg.requestedOut : rec.clockOut;
                              const barTone: BarTone = useReg
                                ? (isRegPending ? "pending" : isRegApproved ? "approved" : "default")
                                : "default";
                              return <TimelineBar clockIn={barIn} clockOut={barOut} tone={barTone} />;
                            })()}
                          </div>
                          <LocationLink raw={rec.location} />
                        </div>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        {(() => {
                          // Compute regularization-based hours when actual punches are missing.
                          const hasActual = !!(rec.clockIn && rec.clockOut);
                          let mins = totalMin;
                          if (!hasActual && reg && reg.requestedIn && reg.requestedOut) {
                            mins = Math.max(0, Math.round((new Date(reg.requestedOut).getTime() - new Date(reg.requestedIn).getTime()) / 60000));
                          }
                          const dot = isRegPending  ? "bg-amber-500" :
                                      isRegApproved ? "bg-emerald-500" :
                                      mins >= 480 ? "bg-emerald-500" : mins >= 240 ? "bg-amber-500" : mins > 0 ? "bg-red-500" : "bg-slate-300";
                          if (isPresent || (reg && (isRegPending || isRegApproved))) {
                            return (
                              <div className="flex items-center gap-2">
                                <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                                <span className={`text-[12.5px] ${isRegPending ? "italic text-amber-700" : "text-slate-700"}`}>
                                  {fmtMins(mins) || "0h 0m"}{rec.status === "half_day" ? " +" : ""}
                                </span>
                              </div>
                            );
                          }
                          return <span className="text-[12.5px] text-slate-400">—</span>;
                        })()}
                      </td>
                      <td className="px-5 py-3 align-middle">
                        {(() => {
                          const hasActual = !!(rec.clockIn && rec.clockOut);
                          let mins = totalMin;
                          if (!hasActual && reg && reg.requestedIn && reg.requestedOut) {
                            mins = Math.max(0, Math.round((new Date(reg.requestedOut).getTime() - new Date(reg.requestedIn).getTime()) / 60000));
                          }
                          if (isPresent || (reg && (isRegPending || isRegApproved))) {
                            return (
                              <span className={`text-[12.5px] ${isRegPending ? "italic text-amber-700" : "text-slate-700"}`}>
                                {fmtMins(mins) || "0h 0m"}
                              </span>
                            );
                          }
                          return <span className="text-[12.5px] text-slate-400">—</span>;
                        })()}
                      </td>
                    </>
                  )}

                  {/* Log status — pending requests take priority over the attendance icon */}
                  <td className="px-5 py-3 text-center align-middle">
                    {isLeavePending ? (
                      <span
                        title="Leave application pending approval"
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Leave
                      </span>
                    ) : isWfhPending ? (
                      <span
                        title="WFH request pending approval"
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        WFH
                      </span>
                    ) : isRegPending ? (
                      <span
                        title={reg.status === "partially_approved" ? "Partially approved — awaiting final approver" : "Regularization pending approval"}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Reg.
                      </span>
                    ) : isLeaveRow ? (
                      <span
                        title={`On ${leaveTypeName || "Leave"}`}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-inset ring-violet-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                        Leave
                      </span>
                    ) : isWfhApproved ? (
                      <span
                        title="Approved Work From Home"
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        WFH
                      </span>
                    ) : isRegApproved ? (
                      <span
                        title="Regularization approved"
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 ring-1 ring-inset ring-emerald-200"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Reg.
                      </span>
                    ) : isPresent ? (
                      <span
                        title="Clock-in completed"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-200 shadow-[0_1px_2px_rgba(16,185,129,0.18)]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      </span>
                    ) : isToday && !rec.clockIn ? (
                      <span
                        title="Not clocked in yet"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200 shadow-[0_1px_2px_rgba(245,158,11,0.18)]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      </span>
                    ) : rec.status === "absent" ? (
                      <span
                        title="No attendance recorded"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-red-50 text-red-500 ring-1 ring-inset ring-red-200 shadow-[0_1px_2px_rgba(239,68,68,0.18)]"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      </span>
                    ) : null}
                  </td>

                  {/* Admin kebab */}
                  {isHRAdmin ? (
                    <td className="px-3 py-3 text-right align-middle">
                      {canRegularize ? (
                        <button
                          onClick={() => openRegFor(rec)}
                          title="Regularize on behalf"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
                        >
                          <ShieldCheck className="h-4 w-4" />
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Regularize-on-behalf modal — admin only */}
      {regOpen && isHRAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-[14px] font-semibold text-slate-800">Regularize attendance</h3>
                <p className="text-[11.5px] text-slate-500">For {userName} · {regForm.date}</p>
              </div>
              <button onClick={() => setRegOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clock-in</label>
                  <input
                    type="datetime-local"
                    value={regForm.requestedIn}
                    onChange={(e) => setRegForm((f) => ({ ...f, requestedIn: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clock-out</label>
                  <input
                    type="datetime-local"
                    value={regForm.requestedOut}
                    onChange={(e) => setRegForm((f) => ({ ...f, requestedOut: e.target.value }))}
                    className="mt-1 w-full rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reason (visible in audit log)</label>
                <textarea
                  value={regForm.reason}
                  onChange={(e) => setRegForm((f) => ({ ...f, reason: e.target.value }))}
                  rows={3}
                  placeholder="Why is this regularization being granted?"
                  className="mt-1 w-full resize-none rounded border border-slate-200 px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:ring-1 focus:ring-[#008CFF]"
                />
              </div>

              <div className="rounded bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 ring-1 ring-inset ring-amber-200">
                Submitting marks this regularization as <strong>admin-granted</strong>. It still needs L1 / L2 approval to apply to attendance.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                onClick={() => setRegOpen(false)}
                className="h-8 rounded border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={submitReg}
                disabled={submitting || !regForm.reason.trim()}
                className="h-8 rounded bg-[#008CFF] px-4 text-[12px] font-semibold text-white hover:bg-[#0070d4] disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Grant regularization"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
