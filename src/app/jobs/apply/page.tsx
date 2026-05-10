"use client";

// Public job-application form. Lives outside the dashboard auth wall —
// rendered with no sidebar / header by LayoutShell so it can be iframed
// straight into the marketing site at https://nbmedia.co.in/careers.
//
// Field set is dynamic: pulled from /api/jobs/form-fields, which HR
// controls from the Hiring → Form Settings tab. Mandatory fields (name /
// email / job / resume) are always rendered regardless.

import React, { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { DatePicker } from "@/components/ui/date-picker";
import {
  CheckCircle2, AlertCircle, User, Mail, Phone, Briefcase,
  Building2, Clock, Link as LinkIcon, FileText, Upload, X,
  Sparkles, Send, IndianRupee,
} from "lucide-react";

// Date-picker class tuned to match the form's input height and brand
// blue focus ring so the three Day/Month/Year dropdowns sit naturally
// beside the rest of the form inputs.
const datePickerCls =
  "h-11 px-2.5 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 cursor-pointer transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300";

type Field = {
  fieldKey: string;
  label: string;
  fieldType: string;
  isVisible: boolean;
  isRequired: boolean;
  sortOrder: number;
  isMandatory: boolean;
};
type Opening = { id: number; title: string; department: string | null; location: string | null };

type ExperienceEntry = {
  companyName: string;
  jobTitle: string;
  currentlyWorking: boolean;
  dateOfJoining: string;
  dateOfRelieving: string;
  location: string;
};
type EducationEntry = {
  course: string;
  branch: string;
  startOfCourse: string;
  endOfCourse: string;
  university: string;
  location: string;
};
const emptyExperience: ExperienceEntry = {
  companyName: "", jobTitle: "", currentlyWorking: false,
  dateOfJoining: "", dateOfRelieving: "", location: "",
};
const emptyEducation: EducationEntry = {
  course: "", branch: "", startOfCourse: "", endOfCourse: "",
  university: "", location: "",
};

// Brand-blue (#3b82f6) — same friendlier tone used across the dashboard.
const BRAND       = "#3b82f6";
const BRAND_HOVER = "#2563eb";

const inputCls =
  "w-full h-11 pl-10 pr-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300";
const inputClsNoIcon =
  "w-full h-11 px-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300";
const textareaCls =
  "w-full px-3.5 py-3 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 leading-relaxed transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300 resize-none";

// Per-field icon (only used for the canonical fields). Optional fields
// get a generic icon if we recognise them, otherwise no icon.
const FIELD_ICON: Record<string, any> = {
  fullName:        User,
  email:           Mail,
  phone:           Phone,
  experienceYears: Briefcase,
  currentCompany:  Building2,
  noticePeriod:    Clock,
  linkedinUrl:     LinkIcon,
  portfolioUrl:    LinkIcon,
};

// Group every visible field into a section. Mandatory hardcoded fields
// (name / email / job) live in "Personal info"; resume sits in its own
// "Documents" section at the end. Everything else gets bucketed.
const SECTION_FOR_FIELD: Record<string, "personal" | "professional" | "links" | "story"> = {
  fullName:        "personal",
  email:           "personal",
  phone:           "personal",
  jobOpeningId:    "personal",
  experienceYears: "professional",
  currentCompany:  "professional",
  noticePeriod:    "professional",
  linkedinUrl:     "links",
  portfolioUrl:    "links",
  coverLetter:     "story",
};

export default function JobApplyPage() {
  const { data: fields }   = useSWR<Field[]>("/api/jobs/form-fields", fetcher);
  const { data: openings } = useSWR<Opening[]>("/api/jobs/openings",  fetcher);

  const [form, setForm]     = useState<Record<string, string>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]     = useState(false);
  const [error, setError]   = useState("");
  // Single resume control at the top of the form — drives both the
  // auto-fill (parse) and the actual file submission.
  const smartInputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [parsedFields, setParsedFields] = useState<string[]>([]); // names of fields we auto-filled, used for the success badge
  const [parseWarning, setParseWarning] = useState("");           // shown inline next to the resume so users see it
  const [skills, setSkills] = useState<string[]>([]);             // tag-style skill chips
  const [additionalDoc, setAdditionalDoc] = useState<File | null>(null); // optional second file (cert / portfolio etc.)
  const [consent, setConsent] = useState(false);                  // privacy-consent checkbox
  // Repeatable experience/education sub-forms — each "+ Add" appends a
  // blank entry which the candidate fills in. Serialized to JSON on
  // submit so the existing `experienceDetails` / `educationDetails`
  // text columns can hold the structured data.
  const [experiences, setExperiences] = useState<ExperienceEntry[]>([]);
  const [educations,  setEducations]  = useState<EducationEntry[]>([]);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Pre-select an opening if the URL carries ?role=<id>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");
    if (role && /^\d+$/.test(role)) set("jobOpeningId", role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smart upload: parses the resume server-side and pre-fills the form.
  // Also stores the file as the actual resume submission so the candidate
  // doesn't have to upload it twice.
  const handleSmartUpload = async (file: File | null) => {
    if (!file) return;
    setError("");
    if (file.size > 5 * 1024 * 1024) { setError("Resume must be 5 MB or smaller"); return; }
    const ext = file.name.split(".").pop()?.toLowerCase();
    const ALLOWED = ["pdf", "doc", "docx", "rtf", "odt", "pages", "txt", "md", "html", "htm"];
    if (!ALLOWED.includes(ext || "")) {
      setError("Resume must be a PDF, Word, RTF, ODT, TXT, or HTML file"); return;
    }
    setResume(file);
    setParsing(true);
    setParsedFields([]);
    setParseWarning("");
    try {
      const fd  = new FormData();
      fd.append("resume", file);
      const res = await fetch("/api/jobs/parse-resume", { method: "POST", body: fd });
      const data = await res.json();
      // Surface server-side parse warnings inline next to the resume
      // (visible) — much friendlier than the global error banner at the
      // bottom of the form which the candidate may never scroll to.
      if (data?.warning) setParseWarning(data.warning);
      const p = data?.parsed ?? {};
      const filled: string[] = [];
      const apply = (key: string, val: string | null | undefined, label: string) => {
        if (!val) return;
        setForm((f) => ({ ...f, [key]: String(val) }));
        filled.push(label);
      };
      apply("firstName",         p.firstName,         "First name");
      apply("middleName",        p.middleName,        "Middle name");
      apply("lastName",          p.lastName,          "Last name");
      // Build a fallback fullName for the legacy submit handler.
      if (p.firstName || p.lastName) {
        setForm((f) => ({
          ...f,
          fullName: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ").trim(),
        }));
      }
      apply("email",             p.email,             "Email");
      apply("phone",             p.phone,             "Phone");
      apply("mobileCountryCode", p.mobileCountryCode, "Country code");
      apply("linkedinUrl",       p.linkedinUrl,       "LinkedIn URL");
      apply("portfolioUrl",      p.portfolioUrl,      "Portfolio URL");
      if (p.experienceYears != null) {
        setForm((f) => ({ ...f, experienceYears: String(p.experienceYears) }));
        filled.push("Experience");
      }
      setParsedFields(filled);
    } catch {
      // Non-fatal — the resume file is still attached, the candidate
      // can fill the form manually.
    } finally {
      setParsing(false);
    }
  };


  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      if (resume) fd.append("resume", resume);
      if (additionalDoc) fd.append("additionalDoc", additionalDoc);
      // Serialize repeatable sub-forms into the existing text columns.
      if (experiences.length > 0) {
        fd.set("experienceDetails", JSON.stringify(experiences));
      }
      if (educations.length > 0) {
        fd.set("educationDetails", JSON.stringify(educations));
      }
      // Skills already mirrored into form.skills as a comma-separated
      // string each time the chip list changes; nothing extra here.
      const res  = await fetch("/api/jobs/apply", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Submission failed");
      setDone(true);
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success state ──────────────────────────────────────────────────
  if (done) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-50 flex items-center justify-center px-4 py-12">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 -left-32 h-[420px] w-[420px] rounded-full bg-emerald-300/20 blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 h-[420px] w-[420px] rounded-full bg-[#3b82f6]/20 blur-[120px]" />
        </div>
        <div className="relative w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-[0_8px_24px_rgba(15,23,42,0.06)] overflow-hidden">
          <div className="flex flex-col items-center text-center px-8 py-12">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-emerald-400/30 blur-xl" />
              <div className="relative h-16 w-16 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 ring-4 ring-white">
                <CheckCircle2 size={36} strokeWidth={2.25} />
              </div>
            </div>
            <h1 className="mt-5 text-[22px] font-bold text-slate-800 tracking-tight">Application received</h1>
            <p className="mt-2 text-[13.5px] text-slate-500 leading-relaxed max-w-xs">
              Thanks for applying to NB Media. We've forwarded your details to the
              hiring team — you'll hear back if you're shortlisted.
            </p>
            <p className="mt-4 inline-flex items-center gap-1.5 text-[11.5px] text-slate-400">
              <Sparkles size={12} className="text-amber-400" />
              Watch your inbox in the next 5–7 days
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────
  if (!fields || !openings) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-[#3b82f6] animate-spin" />
          <p className="text-[12.5px] text-slate-400">Loading the application form…</p>
        </div>
      </div>
    );
  }

  // ── Field setup ────────────────────────────────────────────────────
  const HARDCODED = new Set(["fullName", "email", "jobOpeningId", "resume"]);
  const optionalFields = fields
    .filter(f => f.isVisible && !HARDCODED.has(f.fieldKey))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const fieldsBySection = (section: "professional" | "links" | "story") =>
    optionalFields.filter(f => SECTION_FOR_FIELD[f.fieldKey] === section);

  const selectedRole = form.jobOpeningId
    ? openings.find(o => String(o.id) === form.jobOpeningId)
    : null;

  // ── Render a single optional field ────────────────────────────────
  const renderField = (f: Field) => {
    const Icon = FIELD_ICON[f.fieldKey];
    const hasIcon = !!Icon && f.fieldType !== "textarea";
    return (
      <div key={f.fieldKey}>
        <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
          {f.label}{f.isRequired ? <span className="text-rose-500"> *</span> : null}
        </label>
        {f.fieldType === "textarea" ? (
          <textarea
            rows={5}
            className={textareaCls}
            value={form[f.fieldKey] ?? ""}
            onChange={e => set(f.fieldKey, e.target.value)}
            required={f.isRequired}
            placeholder={
              f.fieldKey === "coverLetter"
                ? "Tell us a bit about yourself, what you're looking for, and why NB Media…"
                : ""
            }
          />
        ) : (
          <div className="relative">
            {hasIcon && (
              <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            )}
            <input
              type={f.fieldType === "number" ? "number" : f.fieldType}
              className={hasIcon ? inputCls : inputClsNoIcon}
              value={form[f.fieldKey] ?? ""}
              onChange={e => set(f.fieldKey, e.target.value)}
              required={f.isRequired}
              min={f.fieldType === "number" ? 0 : undefined}
              placeholder={placeholderFor(f.fieldKey)}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden py-10 px-4"
      style={{
        background:
          "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 50%, #e9edf3 100%)",
      }}
    >
      {/* ── Decorative background ───────────────────────────────────
          Light grey / off-white canvas with very subtle grid texture,
          a thin brand accent strip across the top, and faint warm
          glow blobs for depth. Decorative only — pointer-events none. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {/* Soft warm glows kept very faint so the page reads as neutral
            grey/off-white but still has subtle on-brand depth. */}
        <div className="absolute -top-40 -left-32 h-[520px] w-[520px] rounded-full bg-[#f97316]/8 blur-[140px]" />
        <div className="absolute -top-32 -right-40 h-[520px] w-[520px] rounded-full bg-[#ef4444]/7 blur-[140px]" />
        <div className="absolute -bottom-40 left-1/3 h-[520px] w-[520px] rounded-full bg-[#fbbf24]/8 blur-[140px]" />

      </div>

      <div className="relative mx-auto w-full max-w-4xl">
        {/* Card */}
        <div className="relative bg-white border-2 border-slate-300 rounded-2xl shadow-[0_10px_40px_rgba(15,23,42,0.12)] ring-1 ring-slate-900/5 overflow-hidden">
          {/* Watermark — moved up so it sits behind the upper form
              fields, slightly brighter to be clearly visible. */}
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            className="pointer-events-none select-none absolute inset-x-0 mx-auto top-[38%] -translate-y-1/2 w-[280px] max-w-[48%] opacity-[0.18]"
          />

          {/* Header box — coloured banner with NB Media branding, back link,
              and page title. Uses an indigo→blue gradient with subtle
              decorative blobs so it feels professional and on-brand. */}
          <div className="relative z-10 px-7 pt-6">
            <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-white via-[#f8fafc] to-[#f1f5f9] p-5 shadow-[0_4px_18px_rgba(15,23,42,0.06)]">
              {/* Soft warm brand-tinted glows — kept very subtle so the
                  card reads as professional grey/white. */}
              <div aria-hidden="true" className="pointer-events-none absolute -top-12 -right-10 h-40 w-40 rounded-full bg-[#f97316]/10 blur-2xl" />
              <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-[#ef4444]/8 blur-2xl" />
              {/* Thin brand accent line at the very bottom — ties the
                  neutral header back to the NB Media palette. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px]"
                style={{
                  background:
                    "linear-gradient(90deg, #ef4444 0%, #f97316 50%, #fbbf24 100%)",
                }}
              />

              <div className="relative flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
                  <img
                    src="/logo.png"
                    alt="NB Media"
                    className="h-9 w-9 object-contain"
                  />
                </div>
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.2em] text-slate-600">NB Media · Careers</p>
                  <p className="text-[11px] text-slate-500">Application form</p>
                </div>
              </div>

              <div className="relative mt-4 h-px bg-slate-200" />

              <a
                href="https://nbmedia.co.in/careers"
                className="relative mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[#3b82f6] hover:text-[#2563eb]"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                Back to all job openings
              </a>
              <h1 className="relative mt-2 text-[22px] font-bold tracking-tight text-slate-800">Apply for this job</h1>
              <p className="relative mt-1 text-[12.5px] text-slate-500">Upload your resume — we'll auto-fill the rest in seconds.</p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="relative z-10 px-7 py-6 space-y-5">
            {/* ── Resume upload — single canonical control. Auto-fills
                the form AND stores the file for submission. Required. */}
            <input
              ref={smartInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.rtf,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/vnd.oasis.opendocument.text"
              onChange={(e) => handleSmartUpload(e.target.files?.[0] ?? null)}
              required
              className="hidden"
            />
            {!resume ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => smartInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") smartInputRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); handleSmartUpload(e.dataTransfer.files?.[0] ?? null); }}
                className={`cursor-pointer rounded-lg border-2 border-dashed transition-colors px-5 py-5 text-center ${
                  dragOver
                    ? "border-[#3b82f6] bg-[#3b82f6]/10"
                    : "border-[#3b82f6]/40 bg-[#3b82f6]/[0.04] hover:bg-[#3b82f6]/[0.08]"
                }`}
              >
                <p className="text-[13.5px] font-bold text-[#3b82f6]">Upload resume</p>
                <p className="mt-0.5 text-[11.5px] text-slate-500">
                  This will auto-fill the fields below. 5MB max file size · Allowed: .pdf, .doc, .docx, .rtf, .odt
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-[#3b82f6]/40 bg-[#3b82f6]/[0.04] px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-[#3b82f6]/10 flex items-center justify-center text-[#3b82f6] shrink-0">
                    {parsing
                      ? <span className="h-4 w-4 rounded-full border-2 border-[#3b82f6]/30 border-t-[#3b82f6] animate-spin" />
                      : <FileText size={18} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold text-slate-800 truncate">{resume.name}</p>
                    <p className="text-[11.5px] text-slate-500 tabular-nums">{(resume.size / 1024).toFixed(0)} KB</p>
                    {parsing && <p className="mt-1 text-[12px] font-semibold text-[#1d4ed8]">Reading your resume…</p>}
                    {!parsing && parsedFields.length > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
                        <CheckCircle2 size={13} /> Auto-filled {parsedFields.length} fields · {parsedFields.join(" · ")}
                      </p>
                    )}
                    {!parsing && parsedFields.length === 0 && parseWarning && (
                      <p className="mt-1 inline-flex items-start gap-1 text-[12px] font-semibold text-amber-700">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>{parseWarning}</span>
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setResume(null); setParsedFields([]); setParseWarning(""); if (smartInputRef.current) smartInputRef.current.value = ""; }}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Name row ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Plain label="First Name" required value={form.firstName ?? ""} onChange={(v) => { set("firstName", v); set("fullName", [v, form.middleName, form.lastName].filter(Boolean).join(" ")); }} />
              <Plain label="Middle Name"          value={form.middleName ?? ""} onChange={(v) => { set("middleName", v); set("fullName", [form.firstName, v, form.lastName].filter(Boolean).join(" ")); }} />
              <Plain label="Last Name"  required value={form.lastName  ?? ""} onChange={(v) => { set("lastName",  v); set("fullName", [form.firstName, form.middleName, v].filter(Boolean).join(" ")); }} />
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Mobile Phone<span className="text-rose-500"> *</span>
                </label>
                <div className="flex gap-2">
                  <select
                    value={form.mobileCountryCode ?? "+91"}
                    onChange={(e) => set("mobileCountryCode", e.target.value)}
                    className="h-10 px-2 bg-white border border-slate-200 rounded-md text-[13px] text-slate-800 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15"
                  >
                    {["+91","+1","+44","+61","+65","+971","+86"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    type="tel"
                    className={inputClsNoIcon.replace("h-11", "h-10")}
                    value={form.phone ?? ""}
                    onChange={(e) => set("phone", e.target.value)}
                    required
                    placeholder="Mobile Phone"
                  />
                </div>
              </div>
            </div>

            {/* ── Email + Gender row ───────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Plain label="Email" required type="email" value={form.email ?? ""} onChange={(v) => set("email", v)} />
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Gender<span className="text-rose-500"> *</span>
                </label>
                <select
                  value={form.gender ?? ""}
                  onChange={(e) => set("gender", e.target.value)}
                  required
                  className={inputClsNoIcon.replace("h-11", "h-10")}
                >
                  <option value="">Select an option</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
            </div>

            {/* ── Additional documents (optional second file) ─────────── */}
            <div>
              <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Additional Documents</label>
              <AdditionalDocs onChange={setAdditionalDoc} file={additionalDoc} />
            </div>

            {/* ── DOB + Experience row ─────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Date of Birth</label>
                <input
                  type="date"
                  className={inputClsNoIcon.replace("h-11", "h-10")}
                  value={form.dateOfBirth ?? ""}
                  onChange={(e) => set("dateOfBirth", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Experience (in years)</label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="number" min={0} max={60}
                      className={inputClsNoIcon.replace("h-11", "h-10") + " pr-14"}
                      value={form.experienceYears ?? ""}
                      onChange={(e) => set("experienceYears", e.target.value)}
                      placeholder=""
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 pointer-events-none">Years</span>
                  </div>
                  <select
                    value={form.experienceMonths ?? "0"}
                    onChange={(e) => set("experienceMonths", e.target.value)}
                    className="h-10 px-2 bg-white border border-slate-200 rounded-md text-[13px] text-slate-800 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15"
                  >
                    {Array.from({ length: 12 }).map((_, i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                  <span className="self-center text-[12px] text-slate-500 px-1">Months</span>
                </div>
              </div>
            </div>

            {/* ── Salary row ───────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SalaryField
                label="Current Salary"
                amount={form.currentSalary ?? ""}
                currency={form.currentSalaryCurrency ?? "INR"}
                freq={form.currentSalaryFreq ?? "monthly"}
                onAmount={(v) => set("currentSalary", v)}
                onCurrency={(v) => set("currentSalaryCurrency", v)}
                onFreq={(v) => set("currentSalaryFreq", v)}
              />
              <SalaryField
                label="Expected Salary"
                amount={form.expectedSalary ?? ""}
                currency={form.expectedSalaryCurrency ?? "INR"}
                freq={form.expectedSalaryFreq ?? "monthly"}
                onAmount={(v) => set("expectedSalary", v)}
                onCurrency={(v) => set("expectedSalaryCurrency", v)}
                onFreq={(v) => set("expectedSalaryFreq", v)}
              />
            </div>

            {/* ── Available + Preferred Location ──────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Available To Join (in days)</label>
                <input
                  type="number" min={0} max={365}
                  className={inputClsNoIcon.replace("h-11", "h-10")}
                  value={form.availableToJoinDays ?? ""}
                  onChange={(e) => set("availableToJoinDays", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Preferred Location</label>
                <select
                  value={form.preferredLocation ?? ""}
                  onChange={(e) => set("preferredLocation", e.target.value)}
                  className={inputClsNoIcon.replace("h-11", "h-10")}
                >
                  <option value="">Select an option</option>
                  <option value="Mohali">Mohali</option>
                </select>
              </div>
            </div>

            {/* ── Current Location ─────────────────────────────────────── */}
            <Plain label="Current Location" value={form.currentLocation ?? ""} onChange={(v) => set("currentLocation", v)} />

            {/* ── Hidden Applying-For dropdown — stays visible only when
                we don't already know the role from ?role=…. Keeps the
                old apply-from-listing flow working without cluttering
                the polished form. */}
            {!form.jobOpeningId && openings.length > 0 && (
              <div>
                <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
                  Applying For<span className="text-rose-500"> *</span>
                </label>
                <select
                  className={inputClsNoIcon.replace("h-11", "h-10")}
                  value={form.jobOpeningId ?? ""}
                  onChange={e => set("jobOpeningId", e.target.value)}
                  required
                >
                  <option value="">— Pick a role —</option>
                  {openings.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.title}{o.department ? ` · ${o.department}` : ""}{o.location ? ` · ${o.location}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* ── Experience Details (repeatable) ──────────────────────
                Each click of "+ Add Experience Details" appends a blank
                card with company / role / dates / location. Trash icon
                removes the card. Values are serialized to JSON on submit. */}
            <div>
              <p className="text-[13px] font-bold text-slate-800 mb-2">Experience Details</p>
              <div className="space-y-3">
                {experiences.map((exp, i) => (
                  <div
                    key={`exp-${i}`}
                    className="relative rounded-lg border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <button
                      type="button"
                      onClick={() => setExperiences(arr => arr.filter((_, j) => j !== i))}
                      className="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors"
                      aria-label="Remove experience"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Company Name</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Keka"
                          value={exp.companyName}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, companyName: e.target.value } : x))}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Job Title</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Product Designer"
                          value={exp.jobTitle}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, jobTitle: e.target.value } : x))}
                        />
                      </div>
                      <label className="sm:col-span-2 inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={exp.currentlyWorking}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, currentlyWorking: e.target.checked, dateOfRelieving: e.target.checked ? "" : x.dateOfRelieving } : x))}
                          className="h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6]/30"
                        />
                        Currently working here
                      </label>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Date of Joining</label>
                        <DatePicker
                          value={exp.dateOfJoining}
                          onChange={(v) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, dateOfJoining: v } : x))}
                          className={datePickerCls}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Date of Relieving</label>
                        {exp.currentlyWorking ? (
                          <input
                            type="text"
                            disabled
                            value="Currently working here"
                            className={`${inputClsNoIcon} bg-slate-100 cursor-not-allowed text-slate-500 italic`}
                          />
                        ) : (
                          <DatePicker
                            value={exp.dateOfRelieving}
                            onChange={(v) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, dateOfRelieving: v } : x))}
                            className={datePickerCls}
                          />
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Location</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Hyderabad"
                          value={exp.location}
                          onChange={(e) => setExperiences(arr => arr.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {experiences.length === 0 && (
                <button
                  type="button"
                  onClick={() => setExperiences([{ ...emptyExperience }])}
                  className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#3b82f6] hover:text-[#2563eb] transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                  Add Experience Details
                </button>
              )}
            </div>

            {/* ── Education Details (repeatable) ───────────────────────── */}
            <div>
              <p className="text-[13px] font-bold text-slate-800 mb-2">Education Details</p>
              <div className="space-y-3">
                {educations.map((edu, i) => (
                  <div
                    key={`edu-${i}`}
                    className="relative rounded-lg border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <button
                      type="button"
                      onClick={() => setEducations(arr => arr.filter((_, j) => j !== i))}
                      className="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors"
                      aria-label="Remove education"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Course</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="B.Tech"
                          value={edu.course}
                          onChange={(e) => setEducations(arr => arr.map((x, j) => j === i ? { ...x, course: e.target.value } : x))}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Branch / Specialization</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Computer Science"
                          value={edu.branch}
                          onChange={(e) => setEducations(arr => arr.map((x, j) => j === i ? { ...x, branch: e.target.value } : x))}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Start of Course</label>
                        <DatePicker
                          value={edu.startOfCourse}
                          onChange={(v) => setEducations(arr => arr.map((x, j) => j === i ? { ...x, startOfCourse: v } : x))}
                          className={datePickerCls}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">End of Course</label>
                        <DatePicker
                          value={edu.endOfCourse}
                          onChange={(v) => setEducations(arr => arr.map((x, j) => j === i ? { ...x, endOfCourse: v } : x))}
                          className={datePickerCls}
                          futureYears={10}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">University / College</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="IIT, Mumbai"
                          value={edu.university}
                          onChange={(e) => setEducations(arr => arr.map((x, j) => j === i ? { ...x, university: e.target.value } : x))}
                        />
                      </div>
                      <div>
                        <label className="block text-[12px] font-medium text-slate-700 mb-1">Location</label>
                        <input
                          type="text"
                          className={inputClsNoIcon}
                          placeholder="Hyderabad"
                          value={edu.location}
                          onChange={(e) => setEducations(arr => arr.map((x, j) => j === i ? { ...x, location: e.target.value } : x))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {educations.length === 0 && (
                <button
                  type="button"
                  onClick={() => setEducations([{ ...emptyEducation }])}
                  className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#3b82f6] hover:text-[#2563eb] transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 4v16m8-8H4" /></svg>
                  Add Education Details
                </button>
              )}
            </div>

            {/* ── Skills (tag input) ───────────────────────────────────── */}
            <div>
              <p className="text-[13px] font-bold text-slate-800 mb-1.5">Skills</p>
              <SkillsInput
                value={skills}
                onChange={(arr) => { setSkills(arr); set("skills", arr.join(", ")); }}
              />
            </div>

            {/* ── Privacy consent ──────────────────────────────────────── */}
            <label className="flex items-start gap-2.5 cursor-pointer text-[12px] text-slate-600 leading-relaxed">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6] shrink-0"
              />
              <span>
                By applying, you hereby accept the data processing terms under the{" "}
                <a href="#" className="text-[#3b82f6] hover:underline">Privacy Policy</a> and give
                consent to processing of the data as part of this job application.
              </span>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12.5px] px-3 py-2.5">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !consent || !resume}
              className="w-full h-11 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[13.5px] font-semibold transition-colors shadow-[0_1px_2px_rgba(59,130,246,0.25)]"
            >
              {submitting ? "Submitting…" : "Apply Now"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Tiny presentational helpers ─────────────────────────────────────

function Section({
  title, subtitle, children, className = "", first = false,
}: { title: string; subtitle?: string; children: React.ReactNode; className?: string; first?: boolean }) {
  return (
    <section className={`${first ? "" : "pt-7 mt-7 border-t border-slate-100"} ${className}`}>
      <header className="mb-4 flex items-start gap-3">
        {/* Accent bar — small brand-blue stripe to anchor each section
            visually and create rhythm down the form. */}
        <span className="mt-1 h-4 w-1 rounded-full bg-[#3b82f6]" />
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-bold text-slate-800 tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p>}
        </div>
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field2({
  label, required, icon: Icon, type = "text", value, onChange, placeholder,
}: {
  label: string;
  required?: boolean;
  icon: any;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      <div className="relative">
        <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type={type}
          className="w-full h-11 pl-10 pr-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

// Composite salary input — currency dropdown + amount + frequency toggle.
// Used for both Current Salary and Expected Salary so the layout stays
// consistent and the candidate doesn't have to learn it twice.
function SalaryField({
  label, amount, currency, freq,
  onAmount, onCurrency, onFreq,
}: {
  label: string;
  amount: string; currency: string; freq: string;
  onAmount: (v: string) => void; onCurrency: (v: string) => void; onFreq: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-2">
        <select
          value={currency}
          onChange={(e) => onCurrency(e.target.value)}
          className="h-11 px-3 bg-white border border-slate-200 rounded-lg text-[13.5px] text-slate-800 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15"
        >
          {["INR","USD","EUR","GBP","AED","SGD"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative flex-1 min-w-[160px]">
          <IndianRupee size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="number" min={0}
            className="w-full h-11 pl-10 pr-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300 transition-colors"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
            placeholder="Amount"
          />
        </div>
        <select
          value={freq}
          onChange={(e) => onFreq(e.target.value)}
          className="h-11 px-3 bg-white border border-slate-200 rounded-lg text-[13.5px] text-slate-800 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15"
        >
          <option value="monthly">Monthly</option>
          <option value="annual">Annual</option>
        </select>
      </div>
    </div>
  );
}

// Plain labelled input — no icon. Used in the slim form layout where
// fields are stacked tightly without per-field iconography.
function Plain({
  label, required, type = "text", value, onChange, placeholder,
}: {
  label: string; required?: boolean; type?: string;
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full h-10 px-3 bg-white border border-slate-200 rounded-md text-[13.5px] text-slate-800 placeholder-slate-400 transition-colors focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/15 hover:border-slate-300"
      />
    </div>
  );
}

// Tag-style skills input — Enter or comma adds a chip; backspace on
// empty input removes the last chip; click × on a chip to remove it.
function SkillsInput({
  value, onChange,
}: {
  value: string[]; onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const commit = (s: string) => {
    const t = s.trim();
    if (!t) return;
    if (value.includes(t)) { setDraft(""); return; }
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2 py-1.5 flex flex-wrap items-center gap-1.5 focus-within:border-[#3b82f6] focus-within:ring-2 focus-within:ring-[#3b82f6]/15">
      {value.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 rounded-full bg-[#3b82f6]/10 text-[#1d4ed8] text-[12px] font-semibold px-2.5 py-0.5">
          {s}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v !== s))}
            className="text-[#3b82f6] hover:text-rose-600"
            aria-label={`Remove ${s}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(draft); }
          else if (e.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={value.length === 0 ? "Add new skill" : ""}
        className="flex-1 min-w-[120px] h-7 px-1 text-[13px] text-slate-800 placeholder-slate-400 bg-transparent border-none focus:outline-none"
      />
    </div>
  );
}

// "+ Add attachment" tile for the optional Additional Documents slot.
// Single file, 10 MB cap (slightly larger than the resume's 5 MB so
// HR can take a portfolio PDF or scanned certificate).
function AdditionalDocs({
  file, onChange,
}: {
  file: File | null; onChange: (f: File | null) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5">
        <FileText size={16} className="text-[#3b82f6] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-800 truncate">{file.name}</p>
          <p className="text-[11px] text-slate-500 tabular-nums">{(file.size / 1024).toFixed(0)} KB</p>
        </div>
        <button
          type="button"
          onClick={() => { onChange(null); if (ref.current) ref.current.value = ""; }}
          className="h-7 w-7 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50"
        >
          <X size={14} />
        </button>
      </div>
    );
  }
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) return;
          onChange(f);
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-full rounded-md border-2 border-dashed border-slate-200 hover:border-[#3b82f6]/40 bg-slate-50/40 hover:bg-[#3b82f6]/[0.04] transition-colors px-4 py-3.5 flex items-center gap-3 text-left"
      >
        <div className="h-9 w-9 rounded-md bg-white border border-slate-200 flex items-center justify-center text-[#3b82f6]">
          <Upload size={15} />
        </div>
        <div>
          <p className="text-[12.5px] font-semibold text-[#3b82f6]">Add attachment</p>
          <p className="text-[10.5px] text-slate-500">10MB max size</p>
        </div>
      </button>
    </>
  );
}

function placeholderFor(key: string): string {
  switch (key) {
    case "phone":           return "+91 98xxxxxxxx";
    case "experienceYears": return "e.g. 3";
    case "currentCompany":  return "Where do you work right now?";
    case "noticePeriod":    return "e.g. 30 days";
    case "linkedinUrl":     return "https://linkedin.com/in/yourname";
    case "portfolioUrl":    return "https://your-portfolio.com";
    default:                return "";
  }
}
