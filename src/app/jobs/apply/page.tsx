"use client";

// Public job-application form. Lives outside the dashboard auth wall —
// rendered with no sidebar / header by LayoutShell so it can be iframed
// straight into the marketing site at https://nbmedia.co.in/careers.
//
// Field set is dynamic: pulled from /api/jobs/form-fields, which HR
// controls from the Hiring → Form Settings tab. Mandatory fields (name /
// email / job / resume) are always rendered regardless.

import { useEffect, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { CheckCircle2, AlertCircle } from "lucide-react";

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

const inputCls =
  "w-full h-11 px-3.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0f6ecd] focus:ring-2 focus:ring-[#0f6ecd]/15";
const textareaCls =
  "w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-[14px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0f6ecd] focus:ring-2 focus:ring-[#0f6ecd]/15 resize-none";
const labelCls =
  "block text-[12px] font-semibold text-slate-700 mb-1.5";

export default function JobApplyPage() {
  const { data: fields }   = useSWR<Field[]>("/api/jobs/form-fields", fetcher);
  const { data: openings } = useSWR<Opening[]>("/api/jobs/openings",  fetcher);

  const [form, setForm] = useState<Record<string, string>>({});
  const [resume, setResume] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]   = useState(false);
  const [error, setError] = useState("");

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Pre-select an opening if the URL carries ?role=<id>.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");
    if (role && /^\d+$/.test(role)) set("jobOpeningId", role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      for (const [k, v] of Object.entries(form)) fd.append(k, v);
      if (resume) fd.append("resume", resume);
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

  if (done) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-col items-center text-center px-8 py-10">
            <div className="h-14 w-14 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 mb-4">
              <CheckCircle2 size={32} />
            </div>
            <h1 className="text-[20px] font-bold text-slate-800">Application received</h1>
            <p className="mt-2 text-[13.5px] text-slate-500 leading-relaxed">
              Thanks for applying to NB Media. We've forwarded your details to the
              hiring team — you'll hear back if you're shortlisted.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!fields || !openings) {
    return (
      <div className="min-h-screen bg-[#f1f5f9] flex items-center justify-center text-[13px] text-slate-500">
        Loading…
      </div>
    );
  }

  // Build the displayable list — visible fields, sorted, but skip the mandatory
  // ones we always render explicitly (name / email / job / resume) to avoid duplicates.
  const HARDCODED = new Set(["fullName", "email", "jobOpeningId", "resume"]);
  const optionalFields = fields
    .filter(f => f.isVisible && !HARDCODED.has(f.fieldKey))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="min-h-screen bg-[#f1f5f9] py-10 px-4">
      <div className="mx-auto w-full max-w-2xl">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-[#0f6ecd] text-white px-7 py-6">
            <p className="text-[11px] uppercase tracking-[0.18em] opacity-80">
              NB Media · Careers
            </p>
            <h1 className="text-[22px] font-semibold mt-1">Apply for a role</h1>
            <p className="text-[13px] opacity-90 mt-2">
              Fill in your details and upload your resume. We review every
              submission and reach out if there's a match.
            </p>
          </div>

          <form onSubmit={onSubmit} className="px-7 py-7 space-y-5">
            {/* Always-on: Name */}
            <div>
              <label className={labelCls}>Full Name<span className="text-red-500">*</span></label>
              <input
                className={inputCls}
                value={form.fullName ?? ""}
                onChange={e => set("fullName", e.target.value)}
                required
                placeholder="Jane Doe"
              />
            </div>

            {/* Always-on: Email */}
            <div>
              <label className={labelCls}>Email Address<span className="text-red-500">*</span></label>
              <input
                type="email"
                className={inputCls}
                value={form.email ?? ""}
                onChange={e => set("email", e.target.value)}
                required
                placeholder="you@example.com"
              />
            </div>

            {/* Always-on: Job dropdown */}
            <div>
              <label className={labelCls}>Applying For<span className="text-red-500">*</span></label>
              <select
                className={inputCls}
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
              {openings.length === 0 && (
                <p className="mt-1.5 text-[12px] text-amber-600">
                  No roles are currently open. Please check back later.
                </p>
              )}
            </div>

            {/* Optional fields — toggled on/off by HR */}
            {optionalFields.map(f => (
              <div key={f.fieldKey}>
                <label className={labelCls}>
                  {f.label}{f.isRequired ? <span className="text-red-500">*</span> : null}
                </label>
                {f.fieldType === "textarea" ? (
                  <textarea
                    rows={5}
                    className={textareaCls}
                    value={form[f.fieldKey] ?? ""}
                    onChange={e => set(f.fieldKey, e.target.value)}
                    required={f.isRequired}
                  />
                ) : (
                  <input
                    type={f.fieldType === "number" ? "number" : f.fieldType}
                    className={inputCls}
                    value={form[f.fieldKey] ?? ""}
                    onChange={e => set(f.fieldKey, e.target.value)}
                    required={f.isRequired}
                    min={f.fieldType === "number" ? 0 : undefined}
                  />
                )}
              </div>
            ))}

            {/* Always-on: Resume */}
            <div>
              <label className={labelCls}>Resume / CV<span className="text-red-500">*</span></label>
              <input
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={e => setResume(e.target.files?.[0] ?? null)}
                required
                className="block w-full text-[13px] text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-[#0f6ecd] file:text-white file:px-3 file:py-2 file:text-[12.5px] file:font-semibold file:cursor-pointer hover:file:bg-[#0a5fb3] cursor-pointer"
              />
              <p className="mt-1.5 text-[11.5px] text-slate-400">PDF, DOC, or DOCX · 5 MB max</p>
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2.5 rounded-lg">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting || openings.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 bg-[#0f6ecd] hover:bg-[#0a5fb3] disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13.5px] font-semibold px-5 h-11 rounded-lg transition-colors shadow-[0_1px_2px_rgba(15,110,205,0.25)]"
              >
                {submitting ? "Submitting…" : "Submit Application"}
              </button>
            </div>
          </form>
        </div>

        <p className="text-center mt-5 text-[11px] text-slate-400">
          By submitting, you consent to NB Media storing your details for hiring purposes.
        </p>
      </div>
    </div>
  );
}
