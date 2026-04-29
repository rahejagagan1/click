"use client";
import { useState, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { Loader2, Pencil, X, ChevronDown } from "lucide-react";
import { DatePicker as SharedDatePicker } from "@/components/ui/date-picker";

const F = "w-full h-9 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] bg-white dark:bg-[#0a1526] text-slate-800 dark:text-white focus:outline-none focus:border-[#008CFF]";

const PROFILE_TABS = ["ABOUT", "PROFILE", "JOB", "DOCUMENTS", "ASSETS"] as const;
type ProfileTab = typeof PROFILE_TABS[number];

function EditModal({ title, fields, values, onSave, onClose }: {
  title: string;
  fields: { key: string; label: string; type?: string; options?: string[]; min?: string; max?: string; fullWidth?: boolean; readOnly?: boolean }[];
  values: Record<string, string>;
  onSave: (v: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(values);
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.08] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.06]">
          <h3 className="text-[15px] font-semibold text-slate-800 dark:text-white">{title}</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700 dark:hover:text-white" /></button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-4">
          {fields.map(f => (
            <div key={f.key} className={f.fullWidth || f.type === "dob" ? "col-span-2" : ""}>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">{f.label}</label>
              {f.type === "dob" ? (
                <SharedDatePicker value={form[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
              ) : f.options ? (
                <select value={form[f.key] ?? ""} onChange={e => set(f.key, e.target.value)} className={F}>
                  <option value="">Select…</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.type ?? "text"}
                  value={form[f.key] ?? ""}
                  onChange={e => set(f.key, e.target.value)}
                  min={f.min}
                  max={f.max}
                  readOnly={f.readOnly}
                  onClick={(e) => { if (f.type === "date" && !f.readOnly) (e.currentTarget as HTMLInputElement).showPicker?.(); }}
                  onFocus={(e) => { if (f.type === "date" && !f.readOnly) (e.currentTarget as HTMLInputElement).showPicker?.(); }}
                  className={`${F} ${f.readOnly ? "bg-slate-50 dark:bg-white/[0.02] text-slate-500 cursor-not-allowed" : ""}`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-white/[0.06]">
          <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-500 hover:text-slate-800 dark:text-white">Cancel</button>
          <button onClick={async () => {
              setSaving(true);
              // Strip read-only / underscore-prefixed display-only fields
              // (e.g. `_workEmail`) so they aren't sent to the API.
              const ro = new Set(fields.filter((f) => f.readOnly).map((f) => f.key));
              const cleaned: Record<string, string> = {};
              for (const k of Object.keys(form)) {
                if (k.startsWith("_") || ro.has(k)) continue;
                cleaned[k] = form[k];
              }
              await onSave(cleaned);
              setSaving(false);
              onClose();
            }}
            disabled={saving} className="h-9 px-5 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[13px] font-semibold disabled:opacity-50">
            {saving ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { data: session } = useSession();
  const { data: profile, isLoading } = useSWR("/api/hr/profile", fetcher);
  const [tab, setTab] = useState<ProfileTab>("ABOUT");

  // Persist whether the user has ever opened the PROFILE tab so the red
  // "incomplete profile" dot can be cleared once acknowledged. Lives in
  // localStorage (per-browser; not synced across devices) — that's the
  // right scope for a "you've seen this" indicator.
  const PROFILE_SEEN_KEY = "nbm:profile-tab-seen";
  const [profileSeen, setProfileSeen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(PROFILE_SEEN_KEY) === "1") setProfileSeen(true);
  }, []);
  // Mark as seen the moment the user actually opens the PROFILE tab.
  useEffect(() => {
    if (tab !== "PROFILE" || profileSeen) return;
    setProfileSeen(true);
    try { window.localStorage.setItem(PROFILE_SEEN_KEY, "1"); } catch {}
  }, [tab, profileSeen]);
  const [editModal, setEditModal] = useState<null | "primary" | "contact" | "address" | "emergency" | "photo">(null);
  const [bioAbout, setBioAbout] = useState("");
  const [bioLove, setBioLove]   = useState("");
  const [bioHobbies, setBioHobbies] = useState("");

  const user = session?.user as any;
  const ep   = profile?.employeeProfile;

  const [form, setForm] = useState({
    phone: "", dateOfBirth: "", gender: "", bloodGroup: "", maritalStatus: "",
    emergencyContact: "", emergencyPhone: "",
    address: "", city: "", state: "",
    profilePictureUrl: "",
    personalEmail: "", workPhone: "",
    // Onboarding-set fields — read-only on the profile but surfaced
    // here so the UI can show them right away without a separate fetch.
    employeeId: "", firstName: "", middleName: "", lastName: "",
    designation: "", department: "", workLocation: "", employmentType: "",
    joiningDate: "", workCountry: "", nationality: "",
  });

  useEffect(() => {
    if (profile) {
      const p = profile.employeeProfile ?? {};
      // Dates come back as ISO strings or Date — coerce to YYYY-MM-DD.
      const dateISO = (v: any): string => {
        if (!v) return "";
        const s = typeof v === "string" ? v : new Date(v).toISOString();
        return s.slice(0, 10);
      };
      setForm({
        phone: p.phone ?? "", workPhone: p.workPhone ?? "", personalEmail: p.personalEmail ?? "",
        dateOfBirth: dateISO(p.dateOfBirth),
        gender: p.gender ?? "", bloodGroup: p.bloodGroup ?? "", maritalStatus: p.maritalStatus ?? "",
        emergencyContact: p.emergencyContact ?? "", emergencyPhone: p.emergencyPhone ?? "",
        address: p.address ?? "", city: p.city ?? "", state: p.state ?? "",
        profilePictureUrl: profile.profilePictureUrl ?? "",
        // Onboarding-set fields straight from the EmployeeProfile row.
        employeeId: p.employeeId ?? "",
        firstName: p.firstName ?? "", middleName: p.middleName ?? "", lastName: p.lastName ?? "",
        designation: p.designation ?? "", department: p.department ?? "",
        workLocation: p.workLocation ?? "", employmentType: p.employmentType ?? "",
        joiningDate: dateISO(p.joiningDate),
        workCountry: p.workCountry ?? "", nationality: p.nationality ?? "",
      });
    }
  }, [profile]);

  const save = async (patch: Record<string, string>) => {
    const merged = { ...form, ...patch };
    setForm(merged);
    // Combine firstName + lastName into displayName for the backend.
    // User.name (the org-wide display name) is the only thing the API
    // stores — first/last are just the editing surface.
    const payload: Record<string, unknown> = { ...merged };
    if (patch.firstName !== undefined || patch.lastName !== undefined) {
      const first = (patch.firstName ?? "").trim();
      const last  = (patch.lastName ?? "").trim();
      const combined = [first, last].filter(Boolean).join(" ");
      if (combined) payload.displayName = combined;
    }
    const res = await fetch("/api/hr/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Read the body twice — first as text (always works), then try JSON.
      // Empty objects in the dev console mean the body wasn't JSON.
      const text = await res.text().catch(() => "");
      let err: any = {};
      try { err = JSON.parse(text); } catch { /* leave err empty */ }
      // eslint-disable-next-line no-console
      console.error("[profile] save failed", res.status, res.statusText, "body:", text);
      alert(`Couldn't save profile (HTTP ${res.status}): ${err.error || text.slice(0, 200) || res.statusText}`);
      return;
    }
    // Force-refetch the profile so the FIRST/LAST NAME view picks up the
    // new User.name immediately. Pass `undefined` data + revalidate so SWR
    // hits the network instead of just clearing the cache.
    await mutate("/api/hr/profile", undefined, { revalidate: true });
  };

  const completeness = (() => {
    const fields = [form.phone, form.dateOfBirth, form.gender, form.bloodGroup, form.address, form.city];
    return Math.round((fields.filter(Boolean).length / fields.length) * 100);
  })();

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 text-[#008CFF] animate-spin" />
    </div>
  );

  const nameInitials = (profile?.name ?? "?").split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="min-h-screen bg-[#f4f7f8] dark:bg-[#011627]">

      {/* ── Hero Banner ── */}
      <div className="bg-white dark:bg-[#001529] border-b border-slate-200 dark:border-white/[0.06]">
        <div className="px-6 py-5">
          <div className="flex items-start gap-5">

            {/* Avatar — falls back to Google OAuth profile picture
                (session.user.image) when the DB profilePictureUrl is empty,
                so users always see their photo without manually setting it. */}
            <div className="relative shrink-0">
              <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-[#008CFF] to-[#0055bb] flex items-center justify-center text-white text-[22px] font-bold overflow-hidden border-2 border-white dark:border-white/10 shadow-md">
                {(form.profilePictureUrl || user?.image)
                  ? <img src={form.profilePictureUrl || user?.image} alt={profile?.name || "Profile"} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                  : nameInitials}
              </div>
            </div>

            {/* Name + info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-[20px] font-bold text-slate-800 dark:text-white tracking-tight">{profile?.name}</h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/10 text-red-500 border border-red-200 dark:border-red-500/20">NOT IN YET</span>
              </div>
              <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                {ep?.officeLocation && <span className="flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>{ep.officeLocation}</span>}
                <span className="flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>{profile?.email}</span>
                {form.phone && <span className="flex items-center gap-1 text-[12px] text-slate-500 dark:text-slate-400"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.948V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>{form.phone}</span>}
              </div>
            </div>

            {/* Right: job bar */}
            <div className="flex items-center gap-6 text-[12px] shrink-0">
              {ep?.designation && <div className="text-center"><p className="text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">JOB TITLE</p><p className="font-semibold text-slate-800 dark:text-white">{ep.designation}</p></div>}
              {ep?.department  && <div className="text-center"><p className="text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">DEPARTMENT</p><p className="font-semibold text-slate-800 dark:text-white">{ep.department}</p></div>}
              {ep?.employeeId  && <div className="text-center"><p className="text-slate-400 text-[10px] uppercase tracking-wider mb-0.5">EMP NO</p><p className="font-semibold text-slate-800 dark:text-white">{ep.employeeId}</p></div>}
              <button className="h-8 px-3 border border-slate-200 dark:border-white/[0.08] rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 flex items-center gap-1">
                Actions <ChevronDown size={12} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mt-5 border-b border-slate-200 dark:border-white/[0.06]">
            {PROFILE_TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-[12px] font-semibold tracking-wider border-b-2 transition-colors flex items-center gap-1.5 ${
                  tab === t ? "border-[#008CFF] text-[#008CFF]" : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
                }`}>
                {t}
                {t === "PROFILE" && completeness < 100 && !profileSeen && (
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="px-6 py-6">

        {/* ═══ ABOUT ═══ */}
        {tab === "ABOUT" && (
          <div className="grid grid-cols-[1fr_300px] gap-6">
            {/* Left */}
            <div className="space-y-5">
              {/* Summary / About */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">About</h3>
                  <button onClick={() => {}} className="text-slate-400 hover:text-[#008CFF]"><Pencil size={14} /></button>
                </div>
                {bioAbout ? (
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{bioAbout}</p>
                ) : (
                  <button onClick={() => setBioAbout(" ")} className="text-[13px] text-[#008CFF] hover:underline">Add your response</button>
                )}
              </div>

              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">What I love about my job?</h3>
                  <button className="text-slate-400 hover:text-[#008CFF]"><Pencil size={14} /></button>
                </div>
                {bioLove ? (
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{bioLove}</p>
                ) : (
                  <button onClick={() => setBioLove(" ")} className="text-[13px] text-[#008CFF] hover:underline">Add your response</button>
                )}
              </div>

              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">My interests and hobbies</h3>
                  <button className="text-slate-400 hover:text-[#008CFF]"><Pencil size={14} /></button>
                </div>
                {bioHobbies ? (
                  <p className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">{bioHobbies}</p>
                ) : (
                  <button onClick={() => setBioHobbies(" ")} className="text-[13px] text-[#008CFF] hover:underline">Add your response</button>
                )}
              </div>

              {/* Primary Details (view only on About) */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white mb-4">Primary Details</h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {[
                    { label: "FIRST NAME",    value: profile?.name?.split(" ")[0] },
                    { label: "LAST NAME",     value: profile?.name?.split(" ").slice(1).join(" ") },
                    { label: "GENDER",        value: form.gender },
                    { label: "DOB",           value: form.dateOfBirth },
                    { label: "BLOOD GROUP",   value: form.bloodGroup },
                    { label: "MARITAL STATUS",value: form.maritalStatus },
                  ].map(f => (
                    <div key={f.label}>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                      <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value || "—"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right */}
            <div className="space-y-4">
              {/* Reporting Team */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white mb-3">Reporting Team</h3>
                <p className="text-[12px] text-slate-400">No direct reports</p>
              </div>

              {/* Praise */}
              <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl p-5">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white mb-3">Praise</h3>
                <p className="text-[12px] text-slate-400">No praise received yet</p>
              </div>
            </div>
          </div>
        )}

        {/* ═══ PROFILE ═══ */}
        {tab === "PROFILE" && (
          <div className="space-y-5 max-w-4xl">
            {/* Completeness bar */}
            {completeness < 100 && (
              <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[12px] font-semibold text-amber-700 dark:text-amber-400">Incomplete profile</p>
                  <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-0.5">* All fields marked in red color below are mandatory</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full" style={{ width: `${completeness}%` }} />
                  </div>
                  <span className="text-[12px] font-bold text-amber-600 dark:text-amber-400">{completeness}%</span>
                </div>
              </div>
            )}

            {/* Primary Details */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white flex items-center gap-2">
                  Primary Details
                  <span className="text-[10px] text-slate-400">(i)</span>
                </h3>
                <button onClick={() => setEditModal("primary")}
                  className="text-[12px] font-medium text-[#008CFF] hover:underline flex items-center gap-1">
                  <Pencil size={12} /> Edit
                </button>
              </div>
              <div className="px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-4">
                {[
                  { label: "FIRST NAME",     value: profile?.name?.split(" ")[0] || "—" },
                  { label: "LAST NAME",      value: profile?.name?.split(" ").slice(1).join(" ") || "—" },
                  { label: "GENDER",         value: form.gender || "—" },
                  { label: "DOB",            value: form.dateOfBirth || "—" },
                  { label: "MARITAL STATUS", value: form.maritalStatus || "—" },
                  { label: "BLOOD GROUP",    value: form.bloodGroup || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Contact Details */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white flex items-center gap-2">Contact Details <span className="text-[10px] text-slate-400">(i)</span></h3>
                <button onClick={() => setEditModal("contact")} className="text-[12px] font-medium text-[#008CFF] hover:underline flex items-center gap-1"><Pencil size={12} /> Edit</button>
              </div>
              <div className="px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-4">
                {[
                  { label: "WORK EMAIL",      value: profile?.email },
                  { label: "PERSONAL EMAIL",  value: form.personalEmail || "—" },
                  { label: "MOBILE PHONE",    value: form.phone || "—" },
                  { label: "WORK PHONE",      value: form.workPhone || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Addresses */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Addresses</h3>
                <button onClick={() => setEditModal("address")} className="text-[12px] font-medium text-[#008CFF] hover:underline flex items-center gap-1"><Pencil size={12} /> Edit</button>
              </div>
              <div className="px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-4">
                {[
                  { label: "STREET",  value: form.address || "—" },
                  { label: "CITY",    value: form.city    || "—" },
                  { label: "STATE",   value: form.state   || "—" },
                ].map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 mt-0.5">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Profile Picture */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Profile Picture</h3>
                <button onClick={() => setEditModal("photo")} className="text-[12px] font-medium text-[#008CFF] hover:underline flex items-center gap-1"><Pencil size={12} /> Edit</button>
              </div>
              <div className="px-5 py-4 flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#008CFF] to-[#0055bb] flex items-center justify-center text-white text-lg font-bold overflow-hidden">
                  {(form.profilePictureUrl || user?.image)
                    ? <img src={form.profilePictureUrl || user?.image} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                    : nameInitials}
                </div>
                <div>
                  <p className="text-[13px] text-slate-700 dark:text-slate-200">
                    {form.profilePictureUrl ? "Profile picture set" : user?.image ? "Using Google account picture" : "No profile picture"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Paste a direct image URL to override</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ JOB ═══ */}
        {tab === "JOB" && (
          <div className="grid grid-cols-2 gap-6 max-w-4xl">
            {/* Job Details */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Job Details</h3>
              </div>
              <div className="px-5 py-4 space-y-4">
                {[
                  { label: "EMPLOYEE NUMBER",    value: ep?.employeeId },
                  { label: "DATE OF JOINING",    value: ep?.joiningDate ? new Date(ep.joiningDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null },
                  { label: "JOB TITLE",          value: ep?.designation },
                  { label: "EMPLOYMENT TYPE",    value: ep?.employmentType },
                  { label: "WORK LOCATION",      value: ep?.workLocation },
                  { label: "NOTICE PERIOD",      value: ep?.noticePeriodDays ? `${ep.noticePeriodDays} Days` : null },
                ].map(f => f.value ? (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value}</p>
                  </div>
                ) : null)}
              </div>
            </div>

            {/* Organisation */}
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[13px] font-semibold text-slate-800 dark:text-white">Organisation</h3>
              </div>
              <div className="px-5 py-4 space-y-4">
                {[
                  { label: "DEPARTMENT",  value: ep?.department },
                  { label: "LOCATION",    value: ep?.officeLocation },
                ].map(f => f.value ? (
                  <div key={f.label}>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{f.label}</p>
                    <p className="text-[13px] text-slate-700 dark:text-slate-200 font-medium mt-0.5">{f.value}</p>
                  </div>
                ) : null)}
              </div>
            </div>
          </div>
        )}

        {/* ═══ DOCUMENTS ═══ */}
        {tab === "DOCUMENTS" && (
          <div className="max-w-4xl">
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">Employee Documents</h3>
              </div>
              <div className="grid grid-cols-[220px_1fr]">
                {/* Folder sidebar */}
                <div className="border-r border-slate-100 dark:border-white/[0.05] py-2">
                  <p className="px-4 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider font-semibold">EMPLOYEE DOCUMENT FOLDERS</p>
                  {["Identity Docs", "Degrees & Certificates", "Previous Experience", "Employee Letters", "Other"].map((f, i) => (
                    <button key={f} className={`w-full text-left px-4 py-2.5 text-[13px] flex items-center gap-2 transition-colors ${i === 0 ? "bg-[#008CFF]/10 text-[#008CFF]" : "text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"}`}>
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                      {f}
                    </button>
                  ))}
                </div>
                {/* Document list */}
                <div className="p-5">
                  <div className="mb-3">
                    <h4 className="text-[13px] font-semibold text-slate-800 dark:text-white">Identity Docs</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">An identity document is any document which may be used to verify aspects of a person's personal identity</p>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
                      SECURE — Only selected people can view this information
                    </p>
                  </div>
                  <p className="text-[13px] text-slate-400 text-center py-8">No documents uploaded yet</p>
                  <button className="h-8 px-4 border border-[#008CFF] text-[#008CFF] rounded-lg text-[12px] font-medium hover:bg-[#008CFF]/5">+ Add details</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ ASSETS ═══ */}
        {tab === "ASSETS" && (
          <div className="max-w-4xl">
            <div className="bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06] rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.05]">
                <h3 className="text-[14px] font-semibold text-slate-800 dark:text-white">Assigned Assets</h3>
              </div>
              <p className="text-[13px] text-slate-400 text-center py-12">No assets assigned</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit Modals ── */}
      {editModal === "primary" && (() => {
        // Split the user's display name (User.name) into first + last for
        // editing. The save handler recombines them into User.name.
        const fullName = (user?.name ?? "").trim();
        const firstSpace = fullName.indexOf(" ");
        const initialFirst = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
        const initialLast  = firstSpace === -1 ? ""       : fullName.slice(firstSpace + 1);
        return (
        <EditModal title="Primary Details" onClose={() => setEditModal(null)}
          fields={[
            { key: "firstName", label: "First Name" },
            { key: "lastName",  label: "Last Name"  },
            { key: "gender", label: "Gender", options: ["Male","Female","Other","Prefer not to say"] },
            { key: "dateOfBirth", label: "Date of Birth", type: "dob" },
            { key: "bloodGroup", label: "Blood Group", options: ["A+","A-","B+","B-","O+","O-","AB+","AB-"] },
            { key: "maritalStatus", label: "Marital Status", options: ["Single","Married","Divorced","Widowed"] },
          ]}
          values={{
            firstName: initialFirst,
            lastName:  initialLast,
            gender: form.gender,
            dateOfBirth: form.dateOfBirth,
            bloodGroup: form.bloodGroup,
            maritalStatus: form.maritalStatus,
          }}
          onSave={save}
        />
        );
      })()}
      {editModal === "contact" && (
        <EditModal title="Contact Details" onClose={() => setEditModal(null)}
          fields={[
            { key: "_workEmail",    label: "Work Email", readOnly: true, fullWidth: true },
            { key: "phone",         label: "Mobile Phone", type: "tel" },
            { key: "workPhone",     label: "Work Phone",   type: "tel" },
            { key: "personalEmail", label: "Personal Email", type: "email", fullWidth: true },
          ]}
          values={{
            _workEmail:    profile?.email ?? "",
            phone:         form.phone,
            workPhone:     form.workPhone,
            personalEmail: form.personalEmail,
          }}
          onSave={save}
        />
      )}
      {editModal === "address" && (
        <EditModal title="Address" onClose={() => setEditModal(null)}
          fields={[
            { key: "address", label: "Street Address" },
            { key: "city",    label: "City" },
            { key: "state",   label: "State" },
          ]}
          values={{ address: form.address, city: form.city, state: form.state }}
          onSave={save}
        />
      )}
      {editModal === "photo" && (
        <EditModal title="Profile Picture URL" onClose={() => setEditModal(null)}
          fields={[{ key: "profilePictureUrl", label: "Image URL" }]}
          values={{ profilePictureUrl: form.profilePictureUrl }}
          onSave={save}
        />
      )}
    </div>
  );
}
