"use client";

// Per-template editor. Pick employee → see auto-filled placeholders
// + custom field inputs → live preview → Generate PDF.
// Generate POSTs to /api/hr/letter-templates/[key]/generate with
// action=pdf which renders, saves to the employee's Documents, and
// streams the PDF for inline view.

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useSession } from "next-auth/react";
import { isLeadershipOrHR } from "@/lib/access";
import { Search, Save, FileText, RefreshCw } from "lucide-react";

type CustomFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "textarea";
  required?: boolean;
  placeholder?: string;
};

type Template = {
  id: number;
  key: string;
  title: string;
  category: string;
  bodyHtml: string;
  customFields: CustomFieldDef[] | null;
};

type Employee = {
  id: number;
  name: string;
  email: string;
  profilePictureUrl?: string | null;
  employeeProfile?: { designation?: string | null; department?: string | null } | null;
};

export default function TemplateEditorPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { data: session } = useSession();
  const me = session?.user as any;

  const { data: tpl, mutate: mutateTpl } = useSWR<Template>(
    `/api/hr/letter-templates/${key}`, fetcher,
  );

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ html: string; missing: string[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [savingBody, setSavingBody] = useState(false);

  if (!isLeadershipOrHR(me)) {
    return (
      <div className="p-6">
        <p className="text-[13px] text-slate-500">You don't have access to this page.</p>
      </div>
    );
  }

  if (!tpl) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-7 h-7 border-2 border-[#008CFF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const cats = Array.isArray(tpl.customFields) ? tpl.customFields : [];

  const refreshPreview = async () => {
    if (!employee) { setPreview(null); return; }
    setPreviewing(true);
    try {
      const res = await fetch(`/api/hr/letter-templates/${tpl.key}/generate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          employeeId:   employee.id,
          customFields: customValues,
          action:       "preview",
        }),
      });
      if (!res.ok) { alert("Preview failed"); return; }
      const j = await res.json();
      setPreview({ html: j.html, missing: j.missing ?? [] });
    } finally {
      setPreviewing(false);
    }
  };

  const generatePdf = async () => {
    if (!employee) { alert("Pick an employee first."); return; }
    setGenerating(true);
    try {
      const res = await fetch(`/api/hr/letter-templates/${tpl.key}/generate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          employeeId:   employee.id,
          customFields: customValues,
          action:       "pdf",
        }),
      });
      if (!res.ok) {
        // Try to surface the server's error message; fall back to
        // raw text if the body isn't JSON.
        let msg = `Generate failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          try { msg = (await res.text()).slice(0, 200) || msg; } catch {}
        }
        alert(msg);
        return;
      }
      // Server may return either PDF bytes (the production path —
      // also auto-saved to the employee's Documents) OR HTML when
      // the LibreOffice converter is unavailable. Use the response
      // Content-Type to decide how to deliver to the user. Always
      // trigger a programmatic <a download> click — popup blockers
      // shoot down window.open() since it fires AFTER the network
      // round-trip, but anchored downloads from a user-gesture
      // chain are honoured.
      const ct = (res.headers.get("Content-Type") || "").toLowerCase();
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const isPdf = ct.includes("application/pdf");
      const ext = isPdf ? "pdf" : "html";
      const safeName = tpl.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "letter";
      const filename = `${safeName}-${employee.name.replace(/[^A-Za-z0-9]+/g, "-")}.${ext}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener noreferrer";
      // For PDF, also open in a new tab so HR can preview without
      // a download — but the <a download> attribute still triggers
      // the Save dialog as a fallback if the new tab is blocked.
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Free the blob URL a beat later so the browser had time to
      // start the download.
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      if (!isPdf) {
        alert(
          "LibreOffice isn't available on the server, so a print-ready HTML was downloaded instead. " +
          "Open the file and use the browser's Print → Save as PDF to convert it.",
        );
      }
    } catch (e: any) {
      alert(`Generate failed: ${e?.message ?? e}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="px-6 py-5">
      <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500 mb-2">
        <Link href="/dashboard/hr/admin" className="hover:text-slate-800 transition-colors">HR Dashboard</Link>
        <span>/</span>
        <Link href="/dashboard/hr/admin/templates" className="hover:text-slate-800 transition-colors">Templates</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium">{tpl.title}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h1 className="text-[20px] font-semibold text-slate-800 tracking-tight">{tpl.title}</h1>
          <p className="mt-1 text-[12.5px] text-slate-500">
            Search for an employee, fill any custom inputs, then preview or generate the PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setDraftBody(tpl.bodyHtml); setEditingBody(true); }}
          className="inline-flex items-center gap-1.5 h-9 px-3 border border-slate-200 hover:border-slate-300 rounded-lg text-[12.5px] font-medium text-slate-600 hover:text-slate-800 transition-colors"
        >
          <Save size={14} /> Edit template body
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-5">
        {/* ── Left: form ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Employee</label>
            <EmployeePicker value={employee} onChange={(v) => { setEmployee(v); setPreview(null); }} />
          </section>

          {cats.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <label className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Custom fields</label>
              {cats.map((f) => (
                <div key={f.key}>
                  <label className="text-[11.5px] text-slate-600 mb-1 inline-flex items-center gap-1">
                    {f.label}
                    {f.required && <span className="text-rose-500">*</span>}
                  </label>
                  {f.type === "textarea" ? (
                    <textarea
                      value={customValues[f.key] ?? ""}
                      onChange={(e) => setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      rows={3}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF] resize-none"
                    />
                  ) : (
                    <input
                      type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                      value={customValues[f.key] ?? ""}
                      onChange={(e) => setCustomValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#008CFF]"
                    />
                  )}
                </div>
              ))}
            </section>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshPreview}
              disabled={!employee || previewing}
              className="inline-flex items-center gap-1.5 h-9 px-4 border border-slate-200 hover:border-slate-300 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:text-slate-900 disabled:opacity-50"
            >
              <RefreshCw size={13} className={previewing ? "animate-spin" : ""} />
              Preview
            </button>
            <button
              type="button"
              onClick={generatePdf}
              disabled={!employee || generating}
              className="inline-flex items-center gap-1.5 h-9 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-lg text-[12.5px] font-semibold disabled:opacity-60"
            >
              <FileText size={13} />
              {generating ? "Generating…" : "Generate PDF"}
            </button>
          </div>

          {preview?.missing && preview.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <strong>Heads up</strong> — these placeholders couldn't be resolved:
              <ul className="mt-1 list-disc pl-5">
                {preview.missing.map((m) => <li key={m}><code>{m}</code></li>)}
              </ul>
            </div>
          )}
        </div>

        {/* ── Right: preview pane ───────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[500px]">
          <div className="px-5 py-2.5 border-b border-slate-100 text-[11px] uppercase tracking-wider font-semibold text-slate-500 flex items-center justify-between">
            <span>Preview</span>
            {employee && (
              <span className="text-slate-500 normal-case tracking-normal">for <span className="text-slate-700 font-semibold">{employee.name}</span></span>
            )}
          </div>
          <div className="p-6">
            {!employee ? (
              <p className="text-[13px] text-slate-400 italic text-center py-12">Pick an employee to see a preview.</p>
            ) : !preview ? (
              <p className="text-[13px] text-slate-400 italic text-center py-12">Click "Preview" to render the letter.</p>
            ) : (
              // Sandboxed iframe — `sandbox=""` blocks scripts,
              // forms, same-origin access, top navigation, popups,
              // and plugins. Even if a malicious HR user manages to
              // sneak <script> past the server-side sanitiser, it
              // can't execute here. The server now returns a
              // FULL A4 preview HTML doc (letterhead + logo data
              // URL + watermark + CSS), so we feed it directly into
              // srcDoc as-is.
              <iframe
                title="Letter preview"
                sandbox=""
                referrerPolicy="no-referrer"
                className="w-full border border-slate-100 rounded-md"
                style={{ minHeight: "760px", background: "#f8fafc" }}
                srcDoc={preview.html}
              />
            )}
          </div>
        </div>
      </div>

      {/* Template body editor — appears when HR clicks "Edit template body" */}
      {editingBody && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => !savingBody && setEditingBody(false)} />
          <div className="fixed top-8 left-1/2 -translate-x-1/2 w-[min(960px,calc(100vw-32px))] max-h-[calc(100vh-64px)] bg-white rounded-xl shadow-2xl border border-slate-200 z-50 flex flex-col">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-[14px] font-semibold text-slate-800">Edit template body</h3>
              <button onClick={() => !savingBody && setEditingBody(false)} className="text-slate-400 hover:text-slate-700" disabled={savingBody}>✕</button>
            </div>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              className="flex-1 px-4 py-3 text-[12.5px] font-mono leading-relaxed border-0 focus:outline-none resize-none"
              spellCheck={false}
              style={{ minHeight: "400px" }}
            />
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
              <p className="text-[11.5px] text-slate-500">Use <code>{`{{Section.Field}}`}</code> placeholders — they auto-fill from the picked employee.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => !savingBody && setEditingBody(false)}
                  disabled={savingBody}
                  className="h-8 px-4 text-[12.5px] text-slate-500 hover:text-slate-800 rounded-md disabled:opacity-50"
                >Cancel</button>
                <button
                  onClick={async () => {
                    setSavingBody(true);
                    try {
                      const res = await fetch(`/api/hr/letter-templates/${tpl.key}`, {
                        method:  "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body:    JSON.stringify({ bodyHtml: draftBody }),
                      });
                      if (!res.ok) { alert("Save failed"); return; }
                      await mutateTpl();
                      setEditingBody(false);
                    } finally {
                      setSavingBody(false);
                    }
                  }}
                  disabled={savingBody}
                  className="h-8 px-4 bg-[#008CFF] hover:bg-[#0070cc] text-white rounded-md text-[12.5px] font-semibold disabled:opacity-60"
                >{savingBody ? "Saving…" : "Save"}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Debounced employee search picker. Hits /api/hr/employees and
// renders a small dropdown. Same shape used in AssetsPanel.
function EmployeePicker({
  value, onChange,
}: { value: Employee | null; onChange: (v: Employee | null) => void }) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [debounced, setDebounced] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [] as Employee[], isLoading } = useSWR<Employee[]>(
    open ? `/api/hr/employees?search=${encodeURIComponent(debounced)}&isActive=true` : null,
    fetcher,
    { keepPreviousData: true },
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      {value ? (
        <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-white">
          {value.profilePictureUrl ? (
            <img src={value.profilePictureUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#008CFF] text-[10px] font-bold text-white">
              {value.name.charAt(0)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-slate-800 truncate">{value.name}</p>
            <p className="text-[11px] text-slate-500 truncate">{value.employeeProfile?.designation || value.email}</p>
          </div>
          <button onClick={() => onChange(null)} className="text-slate-400 hover:text-rose-500 text-sm">✕</button>
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg bg-white">
          <Search size={14} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search employee by name or email…"
            className="flex-1 text-[13px] bg-transparent focus:outline-none"
          />
        </div>
      )}

      {open && !value && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
          {isLoading && <p className="px-3 py-3 text-[12px] text-slate-400">Loading…</p>}
          {!isLoading && results.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-slate-400">
              {debounced ? `No matches for "${debounced}"` : "Type at least 2 characters…"}
            </p>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onChange(u); setOpen(false); setQuery(""); }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
            >
              {u.profilePictureUrl ? (
                <img src={u.profilePictureUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#008CFF] text-[10px] font-bold text-white">
                  {u.name.charAt(0)}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-slate-800 truncate">{u.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{u.employeeProfile?.designation || u.email}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
