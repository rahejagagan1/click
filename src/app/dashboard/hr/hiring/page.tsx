"use client";

// HR Hiring console — three tabs:
//   • Applications  — incoming candidate submissions, status workflow, notes
//   • Openings      — CRUD for JobOpening rows, toggle Open / Closed
//   • Form Settings — toggle visibility / required-ness of the public form fields
//
// All data flows through `/api/hr/jobs/*` endpoints which are gated to
// CEO / HR managers / role=admin / developers.

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { isHRAdmin } from "@/lib/access";
import {
  Briefcase, Mail, Phone, ExternalLink, FileText, Plus, X, Trash2,
  CheckCircle2, Clock, Star, MessageSquare, XCircle, Trophy,
  Pencil, Save, Copy, ToggleLeft, ToggleRight,
} from "lucide-react";
import { JOB_TITLES } from "@/lib/job-titles";

type Application = {
  id: number; status: string; fullName: string; email: string; phone: string | null;
  coverLetter: string | null; linkedinUrl: string | null; portfolioUrl: string | null;
  experienceYears: number | null; currentCompany: string | null; noticePeriod: string | null;
  resumeFileName: string | null; resumeUrl: string | null; hrNotes: string | null;
  createdAt: string; jobOpeningId: number; roleTitle: string;
};
type Opening = {
  id: number; title: string; department: string | null; location: string | null;
  description: string | null; isOpen: boolean; createdAt: string;
};
type FormField = {
  id: number; fieldKey: string; label: string; fieldType: string;
  isVisible: boolean; isRequired: boolean; sortOrder: number; isMandatory: boolean;
};

const STATUS_OPTIONS: Array<{ value: Application["status"]; label: string; tone: string; Icon: any }> = [
  { value: "new",          label: "New",          tone: "bg-blue-50 text-blue-700 ring-blue-200",       Icon: Clock },
  { value: "reviewed",     label: "Reviewed",     tone: "bg-slate-50 text-slate-700 ring-slate-200",     Icon: CheckCircle2 },
  { value: "shortlisted",  label: "Shortlisted",  tone: "bg-amber-50 text-amber-700 ring-amber-200",     Icon: Star },
  { value: "interviewing", label: "Interviewing", tone: "bg-violet-50 text-violet-700 ring-violet-200",  Icon: MessageSquare },
  { value: "rejected",     label: "Rejected",     tone: "bg-rose-50 text-rose-700 ring-rose-200",        Icon: XCircle },
  { value: "hired",        label: "Hired",        tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", Icon: Trophy },
];

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function HiringPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  // Mirrors src/lib/access.ts:isHRAdmin so adding a role to the
  // admin tier elsewhere doesn't drift this page.
  const canManage = isHRAdmin(me);

  const [tab, setTab] = useState<"apps" | "openings" | "form">("apps");

  if (!canManage) {
    return (
      <div className="px-6 py-12 text-center text-slate-500 text-[14px]">
        You don't have access to the Hiring console.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-6xl">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-slate-800 inline-flex items-center gap-2">
            <Briefcase size={20} className="text-[#0f6ecd]" /> Hiring
          </h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Review applications, manage openings, and tweak the public form template.
          </p>
        </div>
        <CopyEmbedButton />
      </header>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {[
          { k: "apps",     l: "Applications" },
          { k: "openings", l: "Openings" },
          { k: "form",     l: "Form Settings" },
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k as any)}
            className={`px-4 py-2.5 text-[12.5px] font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.k
                ? "border-[#0f6ecd] text-[#0f6ecd]"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {tab === "apps"     && <ApplicationsTab />}
      {tab === "openings" && <OpeningsTab     />}
      {tab === "form"     && <FormSettingsTab />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Applications tab
 * ─────────────────────────────────────────────────────────────────── */

function ApplicationsTab() {
  const { data: rows, isLoading } = useSWR<Application[]>("/api/hr/jobs/applications", fetcher);
  const [open, setOpen] = useState<Application | null>(null);
  const [filter, setFilter] = useState<string>("all");

  if (isLoading) return <p className="text-[13px] text-slate-400 py-6 text-center">Loading…</p>;
  const list = rows ?? [];
  const filtered = filter === "all" ? list : list.filter(a => a.status === filter);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 h-8 rounded-full text-[12px] font-semibold transition-colors ${
            filter === "all" ? "bg-[#0f6ecd] text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-[#0f6ecd]"
          }`}
        >
          All ({list.length})
        </button>
        {STATUS_OPTIONS.map(s => {
          const count = list.filter(a => a.status === s.value).length;
          return (
            <button
              key={s.value}
              onClick={() => setFilter(s.value)}
              className={`px-3 h-8 rounded-full text-[12px] font-semibold transition-colors inline-flex items-center gap-1.5 ${
                filter === s.value ? "bg-[#0f6ecd] text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-[#0f6ecd]"
              }`}
            >
              <s.Icon size={11} /> {s.label} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl py-12 text-center text-slate-400 text-[13px]">
          No applications yet.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">
                <th className="text-left px-4 py-3">Candidate</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Applied</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const s = STATUS_OPTIONS.find(x => x.value === a.status) ?? STATUS_OPTIONS[0];
                return (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                    <td className="px-4 py-3 align-top">
                      <p className="text-[13.5px] font-semibold text-slate-800">{a.fullName}</p>
                      <p className="text-[11.5px] text-slate-500">{a.email}</p>
                    </td>
                    <td className="px-4 py-3 align-top text-[12.5px] text-slate-700">{a.roleTitle}</td>
                    <td className="px-4 py-3 align-top text-[12.5px] text-slate-500 tabular-nums">{fmtDate(a.createdAt)}</td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ring-1 ring-inset ${s.tone}`}>
                        <s.Icon size={11} /> {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <button
                        onClick={() => setOpen(a)}
                        className="text-[12px] font-semibold text-[#0f6ecd] hover:underline"
                      >
                        Review →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <ApplicationModal
          app={open}
          onClose={() => setOpen(null)}
          onChanged={() => { mutate("/api/hr/jobs/applications"); }}
        />
      )}
    </div>
  );
}

function ApplicationModal({ app, onClose, onChanged }: { app: Application; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState(app.status);
  const [notes, setNotes]   = useState(app.hrNotes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/hr/jobs/applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, hrNotes: notes }),
      });
      if (!res.ok) throw new Error("Save failed");
      onChanged();
      onClose();
    } catch (e) { /* surface inline if needed */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-[16px] font-semibold text-slate-800">{app.fullName}</h3>
            <p className="text-[12px] text-slate-500">{app.roleTitle} · applied {fmtDate(app.createdAt)}</p>
          </div>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Contact */}
          <section>
            <h4 className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-slate-500 mb-2">Contact</h4>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <p className="inline-flex items-center gap-1.5 text-slate-700"><Mail size={13} className="text-slate-400" /> {app.email}</p>
              {app.phone && <p className="inline-flex items-center gap-1.5 text-slate-700"><Phone size={13} className="text-slate-400" /> {app.phone}</p>}
              {app.linkedinUrl && (
                <a href={app.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[#0f6ecd] hover:underline">
                  <ExternalLink size={13} /> LinkedIn
                </a>
              )}
              {app.portfolioUrl && (
                <a href={app.portfolioUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[#0f6ecd] hover:underline">
                  <ExternalLink size={13} /> Portfolio
                </a>
              )}
            </div>
          </section>

          {/* Profile snapshot */}
          {(app.experienceYears != null || app.currentCompany || app.noticePeriod) && (
            <section>
              <h4 className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-slate-500 mb-2">Profile</h4>
              <div className="grid grid-cols-3 gap-4 text-[13px]">
                {app.experienceYears != null && <Kv label="Experience"     value={`${app.experienceYears} yrs`} />}
                {app.currentCompany       && <Kv label="Current company" value={app.currentCompany} />}
                {app.noticePeriod         && <Kv label="Notice period"   value={app.noticePeriod} />}
              </div>
            </section>
          )}

          {/* Resume */}
          {app.resumeUrl && (
            <section>
              <h4 className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-slate-500 mb-2">Resume</h4>
              <a
                href={app.resumeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-[#0f6ecd]/5 hover:border-[#0f6ecd]/30 px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition-colors"
              >
                <FileText size={14} className="text-[#0f6ecd]" />
                {app.resumeFileName || "Open resume"}
                <ExternalLink size={12} className="text-slate-400" />
              </a>
            </section>
          )}

          {/* Cover letter */}
          {app.coverLetter && (
            <section>
              <h4 className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-slate-500 mb-2">Cover letter</h4>
              <p className="text-[13px] text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                {app.coverLetter}
              </p>
            </section>
          )}

          {/* HR controls */}
          <section className="border-t border-slate-200 pt-4">
            <h4 className="text-[10.5px] uppercase tracking-[0.1em] font-bold text-slate-500 mb-2">HR Workflow</h4>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Status</label>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {STATUS_OPTIONS.map(s => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  className={`inline-flex items-center gap-1 px-3 h-7 rounded-full text-[11.5px] font-semibold ring-1 ring-inset transition-colors ${
                    status === s.value ? s.tone : "bg-white text-slate-600 ring-slate-200 hover:ring-[#0f6ecd]"
                  }`}
                >
                  <s.Icon size={11} /> {s.label}
                </button>
              ))}
            </div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Private notes (HR only)</label>
            <textarea
              rows={4}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
              placeholder="What stood out, follow-up required, etc."
            />
          </section>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="h-9 px-5 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] text-white text-[13px] font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            <Save size={13} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-slate-800">{value}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Openings tab — toggle Open/Closed, add new, delete unused
 * ─────────────────────────────────────────────────────────────────── */

function OpeningsTab() {
  const { data: rows } = useSWR<Opening[]>("/api/hr/jobs/openings", fetcher);
  const [showAdd, setShowAdd] = useState(false);
  const list = rows ?? [];

  const togglePatch = async (id: number, isOpen: boolean) => {
    await fetch(`/api/hr/jobs/openings/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isOpen }),
    });
    mutate("/api/hr/jobs/openings");
    mutate("/api/jobs/openings");
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this opening?")) return;
    const res = await fetch(`/api/hr/jobs/openings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data?.error || "Could not delete");
      return;
    }
    mutate("/api/hr/jobs/openings");
    mutate("/api/jobs/openings");
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] px-3.5 h-9 text-white text-[13px] font-semibold"
        >
          <Plus size={14} /> Add Role
        </button>
      </div>

      {list.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl py-12 text-center text-slate-400 text-[13px]">
          No openings yet — click "Add Role".
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Department</th>
                <th className="text-left px-4 py-3">Location</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(o => (
                <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                  <td className="px-4 py-3 align-middle">
                    <p className="text-[13.5px] font-semibold text-slate-800">{o.title}</p>
                    {o.description && <p className="text-[11.5px] text-slate-500 line-clamp-1">{o.description}</p>}
                  </td>
                  <td className="px-4 py-3 align-middle text-[12.5px] text-slate-700">{o.department || "—"}</td>
                  <td className="px-4 py-3 align-middle text-[12.5px] text-slate-700">{o.location || "—"}</td>
                  <td className="px-4 py-3 align-middle">
                    <button
                      onClick={() => togglePatch(o.id, !o.isOpen)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset transition-colors ${
                        o.isOpen
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:ring-emerald-400"
                          : "bg-slate-100 text-slate-500 ring-slate-200 hover:ring-slate-400"
                      }`}
                    >
                      {o.isOpen ? <ToggleRight size={12} /> : <ToggleLeft size={12} />}
                      {o.isOpen ? "Open" : "Closed"}
                    </button>
                  </td>
                  <td className="px-4 py-3 align-middle text-right">
                    <button
                      onClick={() => remove(o.id)}
                      className="inline-flex items-center gap-1 text-[12px] text-rose-600 hover:underline"
                      title="Delete"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddOpeningModal onClose={() => setShowAdd(false)} onCreated={() => { mutate("/api/hr/jobs/openings"); mutate("/api/jobs/openings"); }} />}
    </div>
  );
}

function AddOpeningModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  // When the dropdown value is "__custom" the user wants to type a brand
  // new title that isn't in the canonical list — useful for one-off roles
  // we haven't formalised yet.
  const isCustom = title === "__custom";
  const effectiveTitle = isCustom ? customTitle.trim() : title;

  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/hr/jobs/openings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: effectiveTitle, department, location, description, isOpen: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Save failed");
      onCreated();
      onClose();
    } catch (e: any) { setError(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-[15px] font-semibold text-slate-800">Add Role</h3>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <Lbl label="Title*">
            <select className={ipt} value={title} onChange={e => setTitle(e.target.value)}>
              <option value="">— Select a role —</option>
              {JOB_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
              <option value="__custom">Other (type custom title)…</option>
            </select>
            {isCustom && (
              <input
                className={`${ipt} mt-2`}
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                placeholder="Enter a one-off role title"
                autoFocus
              />
            )}
          </Lbl>
          <div className="grid grid-cols-2 gap-3">
            <Lbl label="Department">
              <input className={ipt} value={department} onChange={e => setDepartment(e.target.value)} placeholder="Content" />
            </Lbl>
            <Lbl label="Location">
              <input className={ipt} value={location} onChange={e => setLocation(e.target.value)} placeholder="Mohali" />
            </Lbl>
          </div>
          <Lbl label="Description">
            <textarea
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Brief one-liner shown to candidates"
            />
          </Lbl>
          {error && <p className="text-[12px] text-rose-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !effectiveTitle}
            className="h-9 px-5 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] text-white text-[13px] font-semibold disabled:opacity-60"
          >
            {saving ? "Saving…" : "Add Role"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ipt = "w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd]";
function Lbl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Form Settings tab — toggle visibility / required for each field
 * ─────────────────────────────────────────────────────────────────── */

function FormSettingsTab() {
  const { data: rows } = useSWR<FormField[]>("/api/hr/jobs/form-fields", fetcher);
  const [draft, setDraft] = useState<Record<string, { isVisible: boolean; isRequired: boolean }>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  if (!rows) return <p className="text-[13px] text-slate-400 py-6 text-center">Loading…</p>;

  const get = (f: FormField, key: "isVisible" | "isRequired") =>
    draft[f.fieldKey]?.[key] ?? f[key];

  const set = (f: FormField, key: "isVisible" | "isRequired", val: boolean) => {
    setDraft(d => ({
      ...d,
      [f.fieldKey]: { ...d[f.fieldKey], isVisible: get(f, "isVisible"), isRequired: get(f, "isRequired"), [key]: val },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const fields = Object.entries(draft).map(([fieldKey, v]) => ({ fieldKey, ...v }));
      await fetch("/api/hr/jobs/form-fields", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      mutate("/api/hr/jobs/form-fields");
      mutate("/api/jobs/form-fields");
      setDraft({});
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  };

  const dirty = Object.keys(draft).length > 0;

  return (
    <div>
      <div className="bg-amber-50/60 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-[12.5px] text-amber-800">
        Mandatory fields (Full Name, Email, Applying For, Resume) are always visible and required.
        You can toggle the rest, and rename their labels here too.
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">
              <th className="text-left px-4 py-3">Field</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-center px-4 py-3">Visible</th>
              <th className="text-center px-4 py-3">Required</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(f => (
              <tr key={f.fieldKey} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 align-middle">
                  <p className="text-[13.5px] font-semibold text-slate-800">{f.label}</p>
                  <p className="text-[11px] text-slate-400 font-mono">{f.fieldKey}{f.isMandatory ? " · system" : ""}</p>
                </td>
                <td className="px-4 py-3 align-middle text-[12px] text-slate-600">{f.fieldType}</td>
                <td className="px-4 py-3 align-middle text-center">
                  <Switch
                    checked={get(f, "isVisible")}
                    onChange={(v) => set(f, "isVisible", v)}
                    disabled={f.isMandatory}
                  />
                </td>
                <td className="px-4 py-3 align-middle text-center">
                  <Switch
                    checked={get(f, "isRequired")}
                    onChange={(v) => set(f, "isRequired", v)}
                    disabled={f.isMandatory || !get(f, "isVisible")}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] px-4 h-9 text-white text-[13px] font-semibold disabled:opacity-50"
        >
          <Save size={13} /> {saving ? "Saving…" : "Save changes"}
        </button>
        {savedAt && !dirty && (
          <span className="text-[12px] text-emerald-600 inline-flex items-center gap-1">
            <CheckCircle2 size={13} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
        checked ? "bg-[#0f6ecd]" : "bg-slate-300"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white transition-transform ${checked ? "translate-x-[20px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Embed snippet copy button — gives HR a one-click iframe snippet for
 *  their main website / careers page.
 * ─────────────────────────────────────────────────────────────────── */

function CopyEmbedButton() {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/jobs/apply`;
    const snippet = `<iframe src="${url}" style="width:100%;min-height:900px;border:0;" loading="lazy"></iframe>`;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — silently ignore */ }
  };
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 hover:border-[#0f6ecd] bg-white px-3 h-9 text-[12px] font-semibold text-slate-700"
      title="Copy iframe embed for your website"
    >
      <Copy size={13} /> {copied ? "Copied!" : "Copy embed snippet"}
    </button>
  );
}
