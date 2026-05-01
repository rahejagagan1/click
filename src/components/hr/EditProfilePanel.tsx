"use client";

// Comprehensive edit form for the user profile page. Mirrors the
// onboarding wizard's section list, but renders inline (no multi-step
// gating) since the user already exists. Each section saves
// independently via PATCH on /api/hr/people/[id] so HR can update one
// area without rewriting the whole row.
//
// Visibility / authorization is gated by the parent page: this panel
// only renders for the HR-admin tier (CEO / dev / admin / special_access
// / hr_manager). Salary section embeds the existing SalaryStructurePanel
// so we don't duplicate that form.

import { useEffect, useMemo, useState } from "react";
import { mutate } from "swr";
import {
  AlertCircle, CheckCircle2, Save, User, Phone, MapPin, Briefcase,
  ShieldCheck, Wallet,
} from "lucide-react";
import SalaryStructurePanel from "@/components/hr/SalaryStructurePanel";
import CustomSelect from "@/components/ui/CustomSelect";
import { DEPARTMENTS } from "@/lib/departments";

type Manager = { id: number; name: string };

type Props = {
  userId: number;
  user: any;        // Result of GET /api/hr/people/[id]
  managers: Manager[];
};

const cls = {
  field:    "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15",
  textarea: "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 resize-none",
  label:    "block text-[11.5px] font-semibold text-slate-600 mb-1",
};

function dateISO(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  try { return new Date(v).toISOString().slice(0, 10); } catch { return ""; }
}

// One reusable card per section — keeps spacing / save-button styling
// uniform across all five sections without duplicating the chrome.
function Section({
  title, icon: Icon, accent, saving, error, savedAt, onSave, children,
}: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
  saving: boolean;
  error: string;
  savedAt: number | null;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <span aria-hidden className="block h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}80 60%, transparent)` }} />
      <div className="flex items-center gap-3 border-b border-slate-100 px-6 py-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1"
          style={{ background: `${accent}14`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}33` }}
        >
          <Icon size={16} />
        </div>
        <h3 className="text-[14.5px] font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="space-y-4 px-6 py-5">
        {children}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {savedAt && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>Saved.</span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={13} />
            {saving ? "Saving…" : "Save section"}
          </button>
        </div>
      </div>
    </section>
  );
}

// Hook for a section's save lifecycle — keeps every section's UX
// identical (saving/error/savedAt) without copy-paste.
function useSaveSection(userId: number) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true); setError(""); setSavedAt(null);
    try {
      const res = await fetch(`/api/hr/people/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setSavedAt(Date.now());
      mutate(`/api/hr/people/${userId}`);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return { saving, error, savedAt, save };
}

export default function EditProfilePanel({ userId, user, managers }: Props) {
  const p = user.profile || {};

  // ── Section: Basic Details ─────────────────────────────────────────
  const [basic, setBasic] = useState({
    displayName:   user.name ?? "",
    dateOfBirth:   dateISO(p.dateOfBirth),
    gender:        p.gender ?? "",
    bloodGroup:    p.bloodGroup ?? "",
    maritalStatus: p.maritalStatus ?? "",
  });
  const basicHook = useSaveSection(userId);

  // ── Section: Contact ──────────────────────────────────────────────
  const [contact, setContact] = useState({
    personalEmail:    p.personalEmail ?? "",
    phone:            p.phone ?? "",
    workPhone:        p.workPhone ?? "",
    emergencyContact: p.emergencyContact ?? "",
    emergencyPhone:   p.emergencyPhone ?? "",
  });
  const contactHook = useSaveSection(userId);

  // ── Section: Address ──────────────────────────────────────────────
  const [address, setAddress] = useState({
    address: p.address ?? "",
    city:    p.city ?? "",
    state:   p.state ?? "",
  });
  const addressHook = useSaveSection(userId);

  // ── Section: Job & Work ───────────────────────────────────────────
  const [job, setJob] = useState({
    designation:        p.designation ?? "",
    secondaryJobTitle:  p.secondaryJobTitle ?? "",
    department:         p.department ?? "",
    businessUnit:       p.businessUnit ?? "NB Media",
    legalEntity:        p.legalEntity ?? "NB Media Productions",
    employmentType:     p.employmentType ?? "fulltime",
    workLocation:       p.workLocation ?? "office",
    jobLocation:        p.jobLocation ?? "Mohali",
    workCountry:        p.workCountry ?? "India",
    nationality:        p.nationality ?? "India",
    joiningDate:        dateISO(p.joiningDate),
    internshipEndDate:  dateISO(p.internshipEndDate),
    noticePeriodDays:   String(p.noticePeriodDays ?? "30"),
    probationPolicy:    p.probationPolicy ?? "Regular Employees",
    role:               user.role ?? "member",
    orgLevel:           user.orgLevel ?? "member",
    managerId:          user.manager?.id ? String(user.manager.id) : "",
    inlineManagerId:    user.inlineManager?.id ? String(user.inlineManager.id) : "",
    teamCapsule:        user.teamCapsule ?? "",
  });
  const jobHook = useSaveSection(userId);

  // ── Section: Work Settings (step 3 of the onboarding wizard) ──────
  const [work, setWork] = useState({
    leavePlan:          p.leavePlan ?? "Regular Leave Plan",
    holidayList:        p.holidayList ?? "Default Holiday List",
    weeklyOff:          p.weeklyOff ?? "Standard Weekly Off",
    attendanceNumber:   p.attendanceNumber ?? "",
    timeTrackingPolicy: p.timeTrackingPolicy ?? "On-Site Capture",
    penalizationPolicy: p.penalizationPolicy ?? "Default",
  });
  const workHook = useSaveSection(userId);

  // ── Section: Identity (sensitive — empty by default; HR re-enters) ─
  const [identity, setIdentity] = useState({
    panNumber:         "",
    aadhaarNumber:     "",
    aadhaarEnrollment: "",
    parentName:        p.parentName ?? "",
  });
  const identityHook = useSaveSection(userId);

  // Re-sync local state when the SWR record id changes (i.e. after a
  // refresh) so HR sees the canonical values, not stale local edits.
  useEffect(() => {
    setBasic({
      displayName:   user.name ?? "",
      dateOfBirth:   dateISO(p.dateOfBirth),
      gender:        p.gender ?? "",
      bloodGroup:    p.bloodGroup ?? "",
      maritalStatus: p.maritalStatus ?? "",
    });
    setContact({
      personalEmail:    p.personalEmail ?? "",
      phone:            p.phone ?? "",
      workPhone:        p.workPhone ?? "",
      emergencyContact: p.emergencyContact ?? "",
      emergencyPhone:   p.emergencyPhone ?? "",
    });
    setAddress({
      address: p.address ?? "", city: p.city ?? "", state: p.state ?? "",
    });
    setJob({
      designation:        p.designation ?? "",
      secondaryJobTitle:  p.secondaryJobTitle ?? "",
      department:         p.department ?? "",
      businessUnit:       p.businessUnit ?? "NB Media",
      legalEntity:        p.legalEntity ?? "NB Media Productions",
      employmentType:     p.employmentType ?? "fulltime",
      workLocation:       p.workLocation ?? "office",
      jobLocation:        p.jobLocation ?? "Mohali",
      workCountry:        p.workCountry ?? "India",
      nationality:        p.nationality ?? "India",
      joiningDate:        dateISO(p.joiningDate),
      internshipEndDate:  dateISO(p.internshipEndDate),
      noticePeriodDays:   String(p.noticePeriodDays ?? "30"),
      probationPolicy:    p.probationPolicy ?? "Regular Employees",
      role:               user.role ?? "member",
      orgLevel:           user.orgLevel ?? "member",
      managerId:          user.manager?.id ? String(user.manager.id) : "",
      inlineManagerId:    user.inlineManager?.id ? String(user.inlineManager.id) : "",
      teamCapsule:        user.teamCapsule ?? "",
    });
    setWork({
      leavePlan:          p.leavePlan ?? "Regular Leave Plan",
      holidayList:        p.holidayList ?? "Default Holiday List",
      weeklyOff:          p.weeklyOff ?? "Standard Weekly Off",
      attendanceNumber:   p.attendanceNumber ?? "",
      timeTrackingPolicy: p.timeTrackingPolicy ?? "On-Site Capture",
      penalizationPolicy: p.penalizationPolicy ?? "Default",
    });
    setIdentity((s) => ({ ...s, parentName: p.parentName ?? "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, p.id]);

  // Manager dropdown — exclude self.
  const managerOpts = useMemo(
    () => managers.filter((m) => m.id !== userId),
    [managers, userId],
  );

  return (
    <div className="space-y-5">
      {/* ── Basic Details ── */}
      <Section
        title="Basic Details"
        icon={User}
        accent="#3b82f6"
        saving={basicHook.saving}
        error={basicHook.error}
        savedAt={basicHook.savedAt}
        onSave={() => basicHook.save({
          displayName:   basic.displayName.trim(),
          dateOfBirth:   basic.dateOfBirth || null,
          gender:        basic.gender || null,
          bloodGroup:    basic.bloodGroup || null,
          maritalStatus: basic.maritalStatus || null,
        })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Display Name</label>
            <input className={cls.field} value={basic.displayName}
              onChange={(e) => setBasic({ ...basic, displayName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Date of Birth</label>
            <input type="date" className={cls.field} value={basic.dateOfBirth}
              onChange={(e) => setBasic({ ...basic, dateOfBirth: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Gender</label>
            <CustomSelect
              listKey="gender"
              defaults={["Male", "Female", "Other", "Prefer not to say"]}
              value={basic.gender}
              onChange={(v) => setBasic({ ...basic, gender: v })}
              placeholder="—"
            />
          </div>
          <div>
            <label className={cls.label}>Blood Group</label>
            <CustomSelect
              listKey="bloodGroup"
              defaults={["A+","A-","B+","B-","O+","O-","AB+","AB-"]}
              value={basic.bloodGroup}
              onChange={(v) => setBasic({ ...basic, bloodGroup: v })}
              placeholder="—"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={cls.label}>Marital Status</label>
            <CustomSelect
              listKey="maritalStatus"
              defaults={["Single", "Married", "Divorced", "Widowed"]}
              value={basic.maritalStatus}
              onChange={(v) => setBasic({ ...basic, maritalStatus: v })}
              placeholder="—"
            />
          </div>
        </div>
      </Section>

      {/* ── Contact ── */}
      <Section
        title="Contact Details"
        icon={Phone}
        accent="#0d9488"
        saving={contactHook.saving}
        error={contactHook.error}
        savedAt={contactHook.savedAt}
        onSave={() => contactHook.save({
          personalEmail:    contact.personalEmail.trim() || null,
          phone:            contact.phone.trim() || null,
          workPhone:        contact.workPhone.trim() || null,
          emergencyContact: contact.emergencyContact.trim() || null,
          emergencyPhone:   contact.emergencyPhone.trim() || null,
        })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={cls.label}>Personal Email</label>
            <input type="email" className={cls.field} value={contact.personalEmail}
              onChange={(e) => setContact({ ...contact, personalEmail: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Mobile Number</label>
            <input className={cls.field} value={contact.phone}
              onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Work Number</label>
            <input className={cls.field} value={contact.workPhone}
              onChange={(e) => setContact({ ...contact, workPhone: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Emergency Contact</label>
            <input className={cls.field} value={contact.emergencyContact}
              onChange={(e) => setContact({ ...contact, emergencyContact: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Emergency Phone</label>
            <input className={cls.field} value={contact.emergencyPhone}
              onChange={(e) => setContact({ ...contact, emergencyPhone: e.target.value })} />
          </div>
        </div>
      </Section>

      {/* ── Address ── */}
      <Section
        title="Address"
        icon={MapPin}
        accent="#7c3aed"
        saving={addressHook.saving}
        error={addressHook.error}
        savedAt={addressHook.savedAt}
        onSave={() => addressHook.save({
          address: address.address.trim() || null,
          city:    address.city.trim() || null,
          state:   address.state.trim() || null,
        })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={cls.label}>Street Address</label>
            <textarea rows={2} className={cls.textarea} value={address.address}
              onChange={(e) => setAddress({ ...address, address: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>City</label>
            <input className={cls.field} value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>State</label>
            <input className={cls.field} value={address.state}
              onChange={(e) => setAddress({ ...address, state: e.target.value })} />
          </div>
        </div>
      </Section>

      {/* ── Job & Work ── */}
      <Section
        title="Job & Work Details"
        icon={Briefcase}
        accent="#d97706"
        saving={jobHook.saving}
        error={jobHook.error}
        savedAt={jobHook.savedAt}
        onSave={() => jobHook.save({
          designation:        job.designation.trim() || null,
          secondaryJobTitle:  job.secondaryJobTitle.trim() || null,
          department:         job.department.trim() || null,
          businessUnit:       job.businessUnit.trim() || "NB Media",
          legalEntity:        job.legalEntity.trim() || null,
          employmentType:     job.employmentType,
          workLocation:       job.workLocation,
          jobLocation:        job.jobLocation.trim() || null,
          workCountry:        job.workCountry.trim() || "India",
          nationality:        job.nationality.trim() || "India",
          joiningDate:        job.joiningDate || null,
          internshipEndDate:  job.internshipEndDate || null,
          noticePeriodDays:   job.noticePeriodDays === "" ? null : Number(job.noticePeriodDays),
          probationPolicy:    job.probationPolicy.trim() || null,
          role:               job.role,
          orgLevel:           job.orgLevel,
          managerId:          job.managerId === "" ? null : Number(job.managerId),
          inlineManagerId:    job.inlineManagerId === "" ? null : Number(job.inlineManagerId),
          teamCapsule:        job.teamCapsule.trim() || null,
        })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Designation</label>
            <input className={cls.field} value={job.designation}
              onChange={(e) => setJob({ ...job, designation: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Secondary Job Title</label>
            <input className={cls.field} value={job.secondaryJobTitle}
              onChange={(e) => setJob({ ...job, secondaryJobTitle: e.target.value })} placeholder="Optional" />
          </div>
          <div>
            <label className={cls.label}>Department</label>
            <CustomSelect
              listKey="department"
              defaults={DEPARTMENTS}
              value={job.department}
              onChange={(v) => setJob({ ...job, department: v })}
              placeholder="Select a department"
            />
          </div>
          <div>
            <label className={cls.label}>Business Unit</label>
            <CustomSelect
              listKey="businessUnit"
              defaults={["NB Media"]}
              value={job.businessUnit}
              onChange={(v) => setJob({ ...job, businessUnit: v })}
              placeholder="Select business unit"
            />
          </div>
          <div>
            <label className={cls.label}>Legal Entity</label>
            <CustomSelect
              listKey="legalEntity"
              defaults={["NB Media Productions"]}
              value={job.legalEntity}
              onChange={(v) => setJob({ ...job, legalEntity: v })}
              placeholder="Select legal entity"
            />
          </div>
          <div>
            <label className={cls.label}>Employment Type</label>
            <select className={cls.field} value={job.employmentType}
              onChange={(e) => setJob({ ...job, employmentType: e.target.value })}>
              <option value="fulltime">Full-time</option>
              <option value="parttime">Part-time</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
            </select>
          </div>
          <div>
            <label className={cls.label}>Work Location</label>
            <select className={cls.field} value={job.workLocation}
              onChange={(e) => setJob({ ...job, workLocation: e.target.value })}>
              <option value="office">Office</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className={cls.label}>Job Location (City)</label>
            <CustomSelect
              listKey="jobLocation"
              defaults={["Mohali", "Delhi", "Mumbai", "Remote"]}
              value={job.jobLocation}
              onChange={(v) => setJob({ ...job, jobLocation: v })}
              placeholder="Select city"
            />
          </div>
          <div>
            <label className={cls.label}>Work Country</label>
            <CustomSelect
              listKey="workCountry"
              defaults={["India", "USA", "UK", "UAE", "Singapore"]}
              value={job.workCountry}
              onChange={(v) => setJob({ ...job, workCountry: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Nationality</label>
            <CustomSelect
              listKey="nationality"
              defaults={["India", "USA", "UK", "Other"]}
              value={job.nationality}
              onChange={(v) => setJob({ ...job, nationality: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Joining Date</label>
            <input type="date" className={cls.field} value={job.joiningDate}
              onChange={(e) => setJob({ ...job, joiningDate: e.target.value })} />
          </div>
          {job.employmentType === "intern" && (
            <div>
              <label className={cls.label}>Internship End Date</label>
              <input type="date" className={cls.field} value={job.internshipEndDate}
                onChange={(e) => setJob({ ...job, internshipEndDate: e.target.value })} />
            </div>
          )}
          <div>
            <label className={cls.label}>Notice Period (days)</label>
            <input type="number" min={0} className={cls.field} value={job.noticePeriodDays}
              onChange={(e) => setJob({ ...job, noticePeriodDays: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Probation Policy</label>
            <CustomSelect
              listKey="probationPolicy"
              defaults={["Interns (3 Months)", "Interns (6 Months)", "Interns (12 Months)", "Regular Employees"]}
              value={job.probationPolicy}
              onChange={(v) => setJob({ ...job, probationPolicy: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Role</label>
            <select className={cls.field} value={job.role}
              onChange={(e) => setJob({ ...job, role: e.target.value })}>
              {[
                "admin","manager","lead","sub_lead","writer","editor","qa","researcher","gc",
                "vo_artist","publisher","production_manager","hr_manager","researcher_manager","member",
              ].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className={cls.label}>Org Level</label>
            <select className={cls.field} value={job.orgLevel}
              onChange={(e) => setJob({ ...job, orgLevel: e.target.value })}>
              {["ceo","special_access","hod","manager","hr_manager","lead","sub_lead","production_team","member"]
                .map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className={cls.label}>Reporting Manager</label>
            <select className={cls.field} value={job.managerId}
              onChange={(e) => setJob({ ...job, managerId: e.target.value })}>
              <option value="">— No manager —</option>
              {managerOpts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className={cls.label}>Inline Manager</label>
            <select className={cls.field} value={job.inlineManagerId}
              onChange={(e) => setJob({ ...job, inlineManagerId: e.target.value })}>
              <option value="">— No inline manager —</option>
              {managerOpts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className={cls.label}>Team Capsule</label>
            <input className={cls.field} value={job.teamCapsule}
              onChange={(e) => setJob({ ...job, teamCapsule: e.target.value })} />
          </div>
        </div>
      </Section>

      {/* ── Work Settings (mirrors step 3 of the onboarding wizard) ── */}
      <Section
        title="Work Settings"
        icon={Wallet}
        accent="#0ea5e9"
        saving={workHook.saving}
        error={workHook.error}
        savedAt={workHook.savedAt}
        onSave={() => workHook.save({
          leavePlan:          work.leavePlan.trim()          || null,
          holidayList:        work.holidayList.trim()        || null,
          weeklyOff:          work.weeklyOff.trim()          || null,
          attendanceNumber:   work.attendanceNumber.trim()   || null,
          timeTrackingPolicy: work.timeTrackingPolicy.trim() || null,
          penalizationPolicy: work.penalizationPolicy.trim() || null,
        })}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Leave Plan</label>
            <CustomSelect
              listKey="leavePlan"
              defaults={["Regular Leave Plan", "Regular Leave Plan_2026", "Intern Leave Plan", "None"]}
              value={work.leavePlan}
              onChange={(v) => setWork({ ...work, leavePlan: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Holiday List</label>
            <CustomSelect
              listKey="holidayList"
              defaults={["Default Holiday List", "India Public Holidays"]}
              value={work.holidayList}
              onChange={(v) => setWork({ ...work, holidayList: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Weekly Off</label>
            <CustomSelect
              listKey="weeklyOff"
              defaults={["Standard Weekly Off", "Saturday + Sunday", "Sunday Only", "Custom"]}
              value={work.weeklyOff}
              onChange={(v) => setWork({ ...work, weeklyOff: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Attendance Number</label>
            <input className={cls.field} value={work.attendanceNumber}
              onChange={(e) => setWork({ ...work, attendanceNumber: e.target.value })}
              placeholder="e.g. HRM-69" />
          </div>
          <div>
            <label className={cls.label}>Time Tracking Policy</label>
            <CustomSelect
              listKey="timeTrackingPolicy"
              defaults={["On-Site Capture", "Remote Capture", "Hybrid Capture", "None"]}
              value={work.timeTrackingPolicy}
              onChange={(v) => setWork({ ...work, timeTrackingPolicy: v })}
            />
          </div>
          <div>
            <label className={cls.label}>Penalization Policy</label>
            <CustomSelect
              listKey="penalizationPolicy"
              defaults={["Default", "Strict", "Lenient", "None"]}
              value={work.penalizationPolicy}
              onChange={(v) => setWork({ ...work, penalizationPolicy: v })}
            />
          </div>
        </div>
      </Section>

      {/* ── Identity (sensitive) ── */}
      <Section
        title="Identity Documents"
        icon={ShieldCheck}
        accent="#dc2626"
        saving={identityHook.saving}
        error={identityHook.error}
        savedAt={identityHook.savedAt}
        onSave={() => {
          const patch: Record<string, unknown> = { parentName: identity.parentName.trim() || null };
          // Sensitive fields are write-only — only sent when HR has typed
          // a value. Empty strings are skipped so saving the section
          // doesn't accidentally clear an existing PAN/Aadhaar.
          if (identity.panNumber.trim())         patch.panNumber         = identity.panNumber.trim();
          if (identity.aadhaarNumber.trim())     patch.aadhaarNumber     = identity.aadhaarNumber.trim();
          if (identity.aadhaarEnrollment.trim()) patch.aadhaarEnrollment = identity.aadhaarEnrollment.trim();
          identityHook.save(patch);
        }}
      >
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
          PAN and Aadhaar values are write-only: enter a new value to update; leave blank to keep the existing one untouched.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>PAN Number</label>
            <input className={cls.field} value={identity.panNumber} placeholder="Leave blank to keep existing"
              onChange={(e) => setIdentity({ ...identity, panNumber: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Parent's Name</label>
            <input className={cls.field} value={identity.parentName}
              onChange={(e) => setIdentity({ ...identity, parentName: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Aadhaar Number</label>
            <input className={cls.field} value={identity.aadhaarNumber} placeholder="Leave blank to keep existing"
              onChange={(e) => setIdentity({ ...identity, aadhaarNumber: e.target.value })} />
          </div>
          <div>
            <label className={cls.label}>Aadhaar Enrollment</label>
            <input className={cls.field} value={identity.aadhaarEnrollment} placeholder="Leave blank to keep existing"
              onChange={(e) => setIdentity({ ...identity, aadhaarEnrollment: e.target.value })} />
          </div>
        </div>
      </Section>

      {/* ── Compensation (reuses the dedicated panel) ── */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-transparent">
        <SalaryStructurePanel userId={userId} canEdit />
      </div>
    </div>
  );
}
