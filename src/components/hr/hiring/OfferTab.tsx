"use client";

// Offer tab — list of OfferLetter rows + a "New offer" wizard that
// auto-fills CTC from the job's salary range, lets HR edit the job
// role, and generates an offer letter body from NB Media's verbatim
// template (Offer Letter section in docs/HR_EMAIL_TEMPLATES.md).
//
// The generated body is editable — HR can tweak before saving. Print
// to PDF works via the browser's native print dialog on the rendered
// preview, so no PDF library dependency is needed.

import { useMemo, useState } from "react";
import {
  FileText, Plus, Send, Check, X as XIcon, Ban, Download,
  Calendar, IndianRupee, AlertCircle, Mail, Sparkles, Printer, Eye, Pencil,
} from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { offerLetterEmail } from "@/lib/email/hr-templates";
import { buildOfferLetterHTML, computePayBreakdown } from "@/lib/offer-letter";

type Offer = {
  id: number;
  status: "draft" | "sent" | "accepted" | "declined" | "revoked" | "expired";
  ctcAnnual: number | string | null;   // Postgres numeric → string in JSON
  joiningDate: string | null;
  expiresAt: string | null;
  attachmentFileName: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
};

const STATUS_TONE: Record<Offer["status"], string> = {
  draft:    "bg-slate-100   text-slate-700",
  sent:     "bg-blue-100    text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  declined: "bg-rose-100    text-rose-700",
  revoked:  "bg-amber-100   text-amber-700",
  expired:  "bg-slate-200   text-slate-600",
};

// Parse "5 LPA" / "5 - 7 LPA" / "₹50,000 monthly" / "600000" into an
// annual ₹ figure. Best-effort — when nothing parses, returns null and
// HR types the CTC manually.
function parseSalaryToAnnualINR(range: string | null, unit: string | null): number | null {
  if (!range) return null;
  const text  = String(range).toLowerCase();
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  if (unit === "monthly" || /per\s*month|p\.?m\.?|\/month|\/m\b/.test(text)) {
    return Math.round(n * 12);
  }
  if (unit === "lpa" || /lpa|lakh|\bl\b/.test(text)) {
    return Math.round(n * 100000);
  }
  if (unit === "annual" || /per\s*annum|p\.?a\.?|annual|\/year|\/yr/.test(text)) {
    return Math.round(n);
  }
  // No unit hint — small numbers are likely LPA; large numbers are ₹.
  return n < 100 ? Math.round(n * 100000) : Math.round(n);
}

export default function OfferTab({
  candidate, offers, onMutated,
}: {
  candidate: {
    id: number; fullName: string; email: string; roleTitle: string | null;
    /** From JobOpening.salaryRange — used to auto-fill the CTC field. */
    jobSalaryRange?: string | null;
    /** From JobOpening.salaryUnit — disambiguates "5" as 5 LPA vs ₹5/month. */
    jobSalaryUnit?:  string | null;
  };
  offers: Offer[];
  onMutated: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [busyId,   setBusyId]   = useState<number | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const act = async (offerId: number, action: "send" | "accept" | "decline" | "revoke") => {
    setBusyId(offerId); setError(null);
    try {
      let extra: any = {};
      if (action === "send") {
        // Short cover note — full offer letter goes as PDF attachment
        // (server auto-generates it from the stored OfferLetter row).
        const firstName = candidate.fullName.split(" ")[0] ?? candidate.fullName;
        const role      = candidate.roleTitle ?? "the role";
        const cover = `Dear ${firstName},

Greetings from NB Media!

We are pleased to extend an offer of employment to you for the position of "${role}". Your formal offer letter is attached to this email.

Kindly review the attached document, sign it, and confirm your acceptance by the deadline specified in the letter. Failure to accept by the deadline will render this offer null and void automatically.

For any questions, feel free to reach out to the HR Department.

Warms Regards,
HR Department
NB-Media`;
        extra = {
          emailSubject:    `Congratulations on Your Selection as "${role}" at NB Media`,
          emailBody:       cover.replace(/\n/g, "<br/>"),
          autoGeneratePdf: true,
          jobRole:         role,
        };
      }
      const res = await fetch(`/api/hr/hiring/offers/${offerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Action failed");
      }
      onMutated();
    } catch (e: any) {
      setError(e?.message ?? "Failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-slate-500">
          {offers.length === 0
            ? "No offer letters yet."
            : `${offers.length} offer${offers.length === 1 ? "" : "s"} on record.`}
        </p>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[12.5px] font-semibold shadow-sm"
        >
          <Plus size={13} /> New offer
        </button>
      </div>

      {error && (
        <div className="inline-flex items-center gap-1.5 text-[12px] text-rose-600">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {offers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <FileText size={28} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-[14px] font-semibold text-slate-800">No offers drafted yet</h3>
          <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">
            Click <strong>New offer</strong> to draft one. The CTC + joining date auto-fill from this job; you can edit before saving.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {offers.map((o) => (
            <li key={o.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex items-center h-5 px-2 rounded-md ${STATUS_TONE[o.status]} text-[10.5px] font-bold uppercase tracking-wider`}>
                      {o.status}
                    </span>
                    {o.ctcAnnual != null && (
                      <span className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-slate-900">
                        <IndianRupee size={13} className="text-emerald-600" />
                        {fmtINR(Number(o.ctcAnnual))} <span className="text-[11px] text-slate-500 font-medium">/ year</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-500">
                    {o.joiningDate && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={11} /> Joining {fmtDate(o.joiningDate)}
                      </span>
                    )}
                    {o.expiresAt && (
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={11} /> Expires {fmtDate(o.expiresAt)}
                      </span>
                    )}
                    {o.acceptedAt && (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <Check size={11} /> Accepted {fmtDate(o.acceptedAt)}
                      </span>
                    )}
                    {o.declinedAt && (
                      <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                        <XIcon size={11} /> Declined {fmtDate(o.declinedAt)}
                      </span>
                    )}
                    {o.attachmentFileName && (
                      <a
                        href={`/api/hr/hiring/offers/${o.id}?file=1`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#3b82f6] hover:underline"
                      >
                        <FileText size={11} /> {o.attachmentFileName}
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {o.attachmentFileName && (
                    <a
                      href={`/api/hr/hiring/offers/${o.id}?file=1`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-slate-200 hover:border-[#3b82f6] hover:text-[#3b82f6] text-slate-700 text-[11.5px] font-semibold"
                    ><Download size={12} /> Download</a>
                  )}
                  {o.status === "draft" && (
                    <button
                      disabled={busyId === o.id}
                      onClick={() => act(o.id, "send")}
                      className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[11.5px] font-semibold"
                    ><Mail size={12} /> Send to candidate</button>
                  )}
                  {o.status === "sent" && (
                    <>
                      <button
                        disabled={busyId === o.id}
                        onClick={() => act(o.id, "accept")}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-[11.5px] font-semibold"
                      ><Check size={12} /> Mark accepted</button>
                      <button
                        disabled={busyId === o.id}
                        onClick={() => act(o.id, "decline")}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-rose-700 text-[11.5px] font-semibold"
                      ><XIcon size={12} /> Mark declined</button>
                      <button
                        disabled={busyId === o.id}
                        onClick={() => act(o.id, "revoke")}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-white hover:bg-slate-50 border border-slate-200 text-amber-700 text-[11.5px] font-semibold"
                      ><Ban size={12} /> Revoke</button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-2 text-[10.5px] text-slate-400">
                Drafted {fmtDate(o.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewOfferModal
          candidate={candidate}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); onMutated(); }}
        />
      )}
    </div>
  );
}

// ── New offer modal — auto-fill + Generate ─────────────────────────

function NewOfferModal({
  candidate, onClose, onCreated,
}: {
  candidate: {
    id: number; fullName: string; email: string; roleTitle: string | null;
    jobSalaryRange?: string | null; jobSalaryUnit?: string | null;
  };
  onClose: () => void;
  onCreated: () => void;
}) {
  // ── Sensible defaults ────────────────────────────────────────────
  // CTC: parsed from the JobOpening.salaryRange — HR usually offers
  // what they advertised.
  const initialCtc = useMemo(() => {
    const n = parseSalaryToAnnualINR(candidate.jobSalaryRange ?? null, candidate.jobSalaryUnit ?? null);
    return n != null ? String(n) : "";
  }, [candidate.jobSalaryRange, candidate.jobSalaryUnit]);

  // Joining: +14 days from now (typical 2-week notice buffer).
  // Expiry:  +7 days from now (offer window).
  const today      = new Date();
  const inDays     = (d: number) => {
    const t = new Date(today);
    t.setDate(t.getDate() + d);
    return t.toISOString().slice(0, 10);
  };

  const [jobRole,     setJobRole]     = useState<string>(candidate.roleTitle ?? "");
  const [ctcAnnual,   setCtcAnnual]   = useState<string>(initialCtc);
  const [joiningDate, setJoiningDate] = useState<string>(inDays(14));
  // Acceptance deadline — defaults to today + 5 days to match clause 24
  // of NB Media's offer letter T&C ("on or before five days of issuance
  // of this letter, failing which this employee agreement shall stand
  // automatically withdrawn"). Always strictly before joining so the
  // candidate must accept BEFORE they're due to start.
  const [expiresAt,   setExpiresAt]   = useState<string>(inDays(5));
  const [body,        setBody]        = useState<string>("");
  const [file,        setFile]        = useState<{ name: string; mime: string; base64: string; size: number } | null>(null);
  const [sendNow,     setSendNow]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Generate offer letter from the .docx template ───────────────
  // Calls the server-side template-preview endpoint, which fills the
  // actual NB Media offer-letter .docx via XML find/replace and
  // returns the resulting body text. The PDF the candidate receives
  // is rendered from the SAME .docx with the SAME substitutions, so
  // what HR sees in the textarea matches the final PDF.
  const [generating, setGenerating] = useState(false);
  const generate = async () => {
    setError(null);
    if (!jobRole.trim()) { setError("Set the Job Role before generating."); return; }
    setGenerating(true);
    try {
      const res = await fetch("/api/hr/hiring/offers/template-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateName:      candidate.fullName,
          jobRole:            jobRole.trim(),
          annualCtcINR:       ctcAnnual ? Number(ctcAnnual) : null,
          joiningDate:        joiningDate        || null,
          acceptanceDeadline: expiresAt          || null,
          // Letter date defaults to "today" server-side when omitted.
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Couldn't render template (${res.status})`);
      }
      const j = await res.json();
      if (typeof j?.text !== "string") throw new Error("Unexpected response shape");
      setBody(j.text);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't generate from template");
    } finally {
      setGenerating(false);
    }
  };

  // Preview shows the body HR has generated. If nothing's been
  // generated yet, openPreview triggers a generate first so the
  // preview never opens empty.
  const openPreview = async () => {
    setError(null);
    if (!jobRole.trim()) { setError("Set the Job Role before previewing."); return; }
    if (!body) await generate();
    setPreviewOpen(true);
  };
  const previewBody = body || "";

  const handleFile = (f: File) => {
    if (f.size > 4 * 1024 * 1024) {
      setError("File exceeds 4 MB. Pick a smaller PDF.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf(",");
      setFile({
        name:   f.name,
        mime:   f.type || "application/pdf",
        base64: idx >= 0 ? result.slice(idx + 1) : result,
        size:   f.size,
      });
      setError(null);
    };
    reader.onerror = () => setError("Couldn't read the file.");
    reader.readAsDataURL(f);
  };

  const save = async () => {
    setError(null);
    if (ctcAnnual && !Number.isFinite(Number(ctcAnnual))) {
      setError("Annual CTC must be a number."); return;
    }
    setSaving(true);
    try {
      let extra: any = {};
      if (sendNow) {
        // Short cover email — the full offer letter rides as a PDF
        // attachment, NOT as the email body. The server auto-renders
        // the PDF from buildOfferLetterHTML when autoGeneratePdf=true
        // and HR didn't upload a pre-made one.
        const firstName  = candidate.fullName.split(" ")[0] ?? candidate.fullName;
        const subject    = `Congratulations on Your Selection as "${jobRole}" at NB Media`;
        const deadlineFmt = expiresAt ? fmtDate(expiresAt) : "the deadline below";
        const coverText = `Dear ${firstName},

Greetings from NB Media!

We are pleased to extend an offer of employment to you for the position of "${jobRole}". Your formal offer letter (Word document) is attached to this email.

Kindly review the attached document, sign it, and confirm your acceptance by ${deadlineFmt}. Failure to accept by the deadline will render this offer null and void automatically.

For any questions, feel free to reach out to the HR Department.

Warms Regards,
HR Department
NB-Media`;
        extra = {
          emailSubject:    subject,
          // Email body (the short cover) IS HTML — keep the <br/> for
          // line breaks. SMTP clients render this directly.
          emailBody:       coverText.replace(/\n/g, "<br/>"),
          // Tell the server to render the offer letter HTML to PDF
          // and attach it. The server skips this when HR uploaded a
          // pre-made PDF (that one wins).
          autoGeneratePdf: true,
          jobRole,
          // offerBody is PLAIN TEXT — the PDF renderer wraps it in a
          // <div class="body"> with white-space: pre-wrap, so \n
          // becomes a real line break. Don't convert to <br/> here or
          // the tags get escaped and shown as literal text in the PDF.
          offerBody:       body || null,
        };
      }
      const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ctcAnnual:          ctcAnnual ? Number(ctcAnnual) : null,
          joiningDate:        joiningDate || null,
          expiresAt:          expiresAt   || null,
          // Stored as plain text in OfferLetter.bodyHtml (the column
          // name predates this refactor). The serve flow reads it and
          // passes straight to the PDF renderer; same rendering rule
          // as offerBody above.
          bodyHtml:           body || null,
          attachmentFileName: file?.name,
          attachmentMime:     file?.mime,
          attachmentBase64:   file?.base64,
          sendNow,
          ...extra,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't save offer");
      }
      onCreated();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Live pay-breakdown peek — gives HR a glance at how the entered CTC
  // splits across components, so they can sanity-check before opening
  // the full preview.
  const livePeek = useMemo(
    () => computePayBreakdown(ctcAnnual ? Number(ctcAnnual) : null),
    [ctcAnnual],
  );

  const candidateInitial = (candidate.fullName.match(/\b([A-Za-z])/g) ?? [])
    .slice(0, 2).join("").toUpperCase() || "?";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white text-[13px] font-bold shrink-0">
              {candidateInitial}
            </span>
            <div className="min-w-0">
              <h3 className="text-[15.5px] font-semibold text-slate-900 truncate">New offer · {candidate.fullName}</h3>
              <p className="text-[11.5px] text-slate-500 truncate">
                {candidate.email}
                {candidate.jobSalaryRange && <span className="text-slate-400"> · Posted salary: <span className="font-mono">{candidate.jobSalaryRange}</span></span>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-slate-50/40">
          {/* ── Step 1 — Offer details ───────────────────────── */}
          <SectionCard
            num={1}
            title="Offer details"
            hint="What's on the table — role, package, key dates."
          >
            <div className="space-y-4">
              <FieldLabel label="Job role">
                <input
                  value={jobRole} onChange={(e) => setJobRole(e.target.value)}
                  placeholder="e.g. Video Editor"
                  className="w-full h-11 px-3.5 rounded-lg border border-slate-200 bg-white text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                />
              </FieldLabel>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FieldLabel label="Annual CTC (₹)">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                      <IndianRupee size={13} />
                    </span>
                    <input
                      type="text" inputMode="decimal"
                      value={ctcAnnual} onChange={(e) => setCtcAnnual(e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="600000"
                      className="w-full h-11 pl-8 pr-3 rounded-lg border border-slate-200 bg-white text-[13.5px] font-mono focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                    />
                  </div>
                </FieldLabel>
                <FieldLabel label="Joining date">
                  <DateField value={joiningDate} onChange={setJoiningDate} />
                  <p className="mt-1 text-[10px] text-slate-400">When the candidate is expected to start.</p>
                </FieldLabel>
                <FieldLabel label="Acceptance deadline">
                  <DateField value={expiresAt} onChange={setExpiresAt} />
                  <p className="mt-1 text-[10px] text-slate-400">
                    Last day the candidate can sign &amp; accept. Per offer T&amp;C clause 24, default is 5 days from today — always before joining.
                  </p>
                </FieldLabel>
              </div>

              {/* Live CTC peek — populates as HR types the CTC */}
              {livePeek && (
                <div className="rounded-lg bg-blue-50/60 border border-blue-100 px-3.5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
                  <span className="inline-flex items-center gap-1 font-semibold text-[#1d4ed8]">
                    <Sparkles size={11} /> {livePeek.annualLPA} LPA
                  </span>
                  <span className="text-slate-600">
                    Monthly: <span className="font-semibold text-slate-900">₹{fmtINR(livePeek.totalMonthly)}</span>
                  </span>
                  <span className="text-slate-500">
                    Basic ₹{fmtINR(livePeek.basic)} · HRA ₹{fmtINR(livePeek.hra)} · Special ₹{fmtINR(livePeek.special)}
                  </span>
                </div>
              )}
            </div>
          </SectionCard>

          {/* ── Step 2 — Offer letter ───────────────────────── */}
          <SectionCard
            num={2}
            title="Offer letter"
            hint="Generate the NB Media template with name, role, CTC, and dates auto-merged. Preview the full multi-page document before sending."
            action={
              <div className="flex items-center gap-2">
                <button
                  onClick={generate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-[12px] font-semibold shadow-sm"
                ><Sparkles size={13} /> {generating ? "Generating…" : "Generate"}</button>
                <button
                  onClick={openPreview}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-blue-400 text-white text-[12px] font-semibold shadow-sm"
                ><Eye size={13} /> Preview</button>
              </div>
            }
          >
            {body ? (
              <div>
                <textarea
                  value={body} onChange={(e) => setBody(e.target.value)} rows={12}
                  className="w-full px-3.5 py-3 rounded-lg border border-slate-200 bg-white text-[13px] font-mono leading-[1.65] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
                />
                <p className="mt-2 text-[10.5px] text-slate-400">
                  Edit any line in place — your changes flow into the printed PDF and the email body.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white py-8 px-6 text-center">
                <Sparkles size={22} className="mx-auto text-slate-300 mb-2" />
                <p className="text-[12.5px] text-slate-700 font-medium">No body drafted yet</p>
                <p className="mt-1 text-[11px] text-slate-500 max-w-md mx-auto leading-relaxed">
                  Hit <strong>Generate</strong> to draft the letter inline, or <strong>Preview</strong> to see the formatted multi-page document without committing.
                </p>
              </div>
            )}
          </SectionCard>

          {/* ── Step 3 — Pre-made PDF (optional) ─────────────── */}
          <SectionCard
            num={3}
            title="Pre-made PDF"
            hint="Optional — attach a designed PDF if HR already has one. The generated body still goes out as the email content."
          >
            {file ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white shrink-0">
                    <FileText size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-semibold text-slate-900 truncate">{file.name}</p>
                    <p className="text-[10.5px] text-slate-500">{(file.size / 1024).toFixed(1)} KB · {file.mime}</p>
                  </div>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="text-[11.5px] font-semibold text-rose-600 hover:bg-rose-50 h-8 px-3 rounded-md"
                >Remove</button>
              </div>
            ) : (
              <label className="rounded-lg border-2 border-dashed border-slate-200 bg-white px-6 py-5 flex items-center gap-4 cursor-pointer hover:border-[#3b82f6] hover:bg-blue-50/30 transition-colors">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <FileText size={18} />
                </span>
                <div className="flex-1">
                  <p className="text-[12.5px] font-semibold text-slate-800">Drop a PDF here, or click to browse</p>
                  <p className="text-[10.5px] text-slate-500 mt-0.5">PDF / DOCX · max 4 MB</p>
                </div>
                <span className="inline-flex items-center justify-center h-8 px-3 rounded-md bg-slate-900 text-white text-[11.5px] font-semibold">Choose file</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf,.docx,.doc"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  className="hidden"
                />
              </label>
            )}
          </SectionCard>

          {/* ── Step 4 — Send option ───────────────────────── */}
          <SectionCard num={4} title="Send to candidate" hint="Save as draft and send later, or email immediately on save.">
            <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-[#3b82f6]">
              <input
                type="checkbox" checked={sendNow}
                onChange={(e) => setSendNow(e.target.checked)}
                className="h-4 w-4 mt-0.5 rounded border-slate-300 accent-[#3b82f6]"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-slate-900">
                  Email this offer right now
                </p>
                <p className="text-[11.5px] text-slate-500 mt-0.5">
                  To: <span className="font-mono">{candidate.email}</span> · Body + uploaded PDF (if any) go out as the email content.
                </p>
              </div>
            </label>
          </SectionCard>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 inline-flex items-center gap-1.5 text-[12px] text-rose-700">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-white rounded-b-2xl flex items-center justify-between gap-3">
          <p className="text-[10.5px] text-slate-400 max-w-sm hidden sm:block">
            {sendNow
              ? "✓ Will be saved AND emailed to the candidate immediately."
              : "Draft only — you can send from the offers list later."}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-10 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
            <button
              onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[13px] font-semibold shadow-sm"
            >
              {sendNow ? <Send size={14} /> : <Check size={14} />}
              {saving ? "Saving…" : sendNow ? "Save & send" : "Save as draft"}
            </button>
          </div>
        </div>
      </div>

      {previewOpen && (
        <OfferPreviewModal
          body={previewBody}
          candidateName={candidate.fullName}
          jobRole={jobRole}
          annualCtcINR={ctcAnnual ? Number(ctcAnnual) : null}
          joiningDate={joiningDate || null}
          acceptanceDeadline={expiresAt || null}
          onUseDraft={() => { setBody(previewBody); setPreviewOpen(false); }}
          dirty={body !== "" && body !== previewBody}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

// ── Offer preview — embeds the ACTUAL PDF (rendered from the .docx
// template via Word/LO) inside an iframe so HR sees the same file
// the candidate receives. No HTML approximation, no overlay tricks.
function OfferPreviewModal({
  candidateName, jobRole, annualCtcINR, joiningDate, acceptanceDeadline,
  onClose,
}: {
  body?: string;     // kept for API compat — no longer used
  candidateName: string;
  jobRole: string;
  annualCtcINR: number | null;
  joiningDate: string | null;
  acceptanceDeadline: string | null;
  dirty?: boolean;     // kept for API compat — no longer used
  onUseDraft?: () => void; // kept for API compat — no longer used
  onClose: () => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Fetch the actual PDF (same one the candidate gets) and create a
  // blob URL for the iframe to point at. Revoke on unmount so we
  // don't leak the blob.
  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/hr/hiring/offers/template-preview?format=pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateName,
            jobRole,
            annualCtcINR,
            joiningDate,
            acceptanceDeadline,
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `Render failed (${res.status})`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setPdfUrl(createdUrl);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Couldn't render the preview PDF");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [candidateName, jobRole, annualCtcINR, joiningDate, acceptanceDeadline]);

  const download = () => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = `Offer Letter - ${candidateName || "Candidate"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[94vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Offer letter preview</h3>
            <p className="text-[11px] text-slate-500">
              Rendered from the NB Media template — this is the EXACT PDF the candidate will receive.
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <XIcon size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden bg-slate-100 p-3">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500">
              <div className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-[#3b82f6] animate-spin" />
              <p className="mt-3 text-[12.5px]">Rendering offer letter…</p>
              <p className="mt-0.5 text-[10.5px] text-slate-400">Filling the .docx template + converting to PDF</p>
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-rose-600 px-6 text-center">
              <p className="text-[13px] font-semibold">Couldn't render the preview PDF</p>
              <p className="mt-1 text-[11.5px] text-slate-600">{error}</p>
              <p className="mt-3 text-[10.5px] text-slate-500 max-w-md">
                On the VPS this needs LibreOffice installed (<span className="font-mono">apt install libreoffice --no-install-recommends</span>). Locally it uses Microsoft Word if available.
              </p>
            </div>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              title="Offer Letter Preview"
              className="w-full h-full bg-white rounded-md border border-slate-200 shadow-sm"
              style={{ minHeight: "70vh" }}
            />
          ) : null}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Close</button>
          <button onClick={download} disabled={!pdfUrl}
            className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm"
          ><Printer size={13} /> Download PDF</button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

// Step-numbered section card — gives the New Offer modal the
// "1 → 2 → 3 → 4" flow without screaming wizard-style. Title + hint
// on the left, optional action buttons on the right.
function SectionCard({
  num, title, hint, action, children,
}: {
  num: number;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-[#1d4ed8] text-[11px] font-bold ring-1 ring-blue-100 shrink-0">
            {num}
          </span>
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-slate-900">{title}</h3>
            {hint && <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

// Label wrapper for form fields — consistent label-on-top styling.
function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}


function fmtINR(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
