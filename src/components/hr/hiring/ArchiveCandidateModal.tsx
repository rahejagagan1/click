"use client";

// Archive Candidate — Keka-parity modal. HR picks a canonical reason
// (Not Qualified / Position Filled / Out of Budget / etc.), optionally
// writes a closing email (CC/BCC supported), and the action:
//   1. Moves the candidate to the rejected stage.
//   2. Persists reason + note + archivedAt on JobApplication.
//   3. Sends the closing email (if subject + body present).
//   4. Adds an `archived` row to CandidateActivity.
// All of that is one backend call to action="archive".

import { useEffect, useState } from "react";
import { mutate as globalMutate } from "swr";
import { X, ChevronDown, AlertCircle, Eye } from "lucide-react";

interface Candidate {
  id: number;
  fullName: string;
  email: string;
  roleTitle: string | null;
}

// Canonical archive reasons — match the Keka list shown in the
// reference screenshots so HR reports can group cleanly across both
// systems if/when imports happen.
export const ARCHIVE_REASONS = [
  "Not Qualified",
  "Candidate Not Interested",
  "Candidate Not Reachable",
  "Not Suitable",
  "Not Fit for the current need",
  "Over Qualified",
  "Under Qualified",
  "Out of Budget",
  "Position Filled",
  "No Relocation",
  "Sample not Submitted",
  "Sample rejected",
  "Resume Missing",
  "Failed in Background Check",
  "Declined Offer",
  "Candidate backout",
  "Didn't accept the offer",
  "Documents not matched",
  "Missing Documents",
  "Retained by current employer",
  "Negative Feedback",
];

export default function ArchiveCandidateModal({
  candidate, onClose, onDone,
}: {
  candidate: Candidate;
  onClose: () => void;
  onDone?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [reason, setReason]   = useState(ARCHIVE_REASONS[4]); // Not Fit
  const [note, setNote]       = useState("");
  const [cc, setCc]           = useState("");
  const [bcc, setBcc]         = useState("");
  const [showCc, setShowCc]   = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const fname  = (candidate.fullName ?? "").split(/\s+/)[0] ?? candidate.fullName;
  const role   = candidate.roleTitle ?? "the role";
  const [subject, setSubject] = useState(`Your application for ${role} at NB Media`);
  const [body, setBody]       = useState(
`Dear ${candidate.fullName},

Greetings from NB Media!

We thank you for your application for the ${role} position at NB Media. We appreciate you for showing interest in joining our company and we thank you for investing your precious time and efforts in applying to our company.

We're fortunate to have received a lot of interest in this role, resulting in a very competitive selection process and after the careful evaluation of your application, we regret to inform you that unfortunately this time we won't be able to move forward with your application.

We wish you the best for your future endeavours.

Regards,
NB Media Hiring Team`);
  const [sendEmail, setSendEmail] = useState(true);
  const [preview, setPreview]     = useState(false);
  const [saving, setSaving]       = useState(false);

  const splitEmails = (s: string) =>
    s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

  const confirm = async () => {
    if (!reason) return alert("Pick a reason");
    setSaving(true);
    const res = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "archive",
        reason,
        note: note.trim() || null,
        subject: sendEmail ? subject.trim() : null,
        body:    sendEmail ? body.replace(/\n/g, "<br/>") : null,
        cc:      sendEmail ? splitEmails(cc)  : [],
        bcc:     sendEmail ? splitEmails(bcc) : [],
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j?.error || "Couldn't archive candidate");
      return;
    }
    globalMutate("/api/hr/hiring/candidates");
    onDone?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-slate-900 truncate">Archive {candidate.fullName}</h3>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-[12px] text-rose-700 flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>
              Archiving moves the candidate to the rejected stage. Their history stays — you can roll back later from the archived view.
            </span>
          </div>

          <Field label="Reason for archiving">
            <div className="relative">
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="appearance-none w-full h-10 pl-3.5 pr-9 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
              >
                {ARCHIVE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>

          <Field label="Internal note (optional, not sent to candidate)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything the team should know about this archive decision."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]"
            />
          </Field>

          <label className="inline-flex items-center gap-2.5 text-[12.5px] text-slate-700 cursor-pointer">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-[#3b82f6]" />
            Send a closing email to the candidate
          </label>

          {sendEmail && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11.5px] font-semibold text-slate-600">To: <span className="text-slate-800">{candidate.email}</span></p>
                <div className="flex items-center gap-2 text-[11.5px] font-semibold">
                  {!showCc  && <button onClick={() => setShowCc(true)}  className="text-[#3b82f6] hover:underline">CC</button>}
                  {!showBcc && <button onClick={() => setShowBcc(true)} className="text-[#3b82f6] hover:underline">BCC</button>}
                </div>
              </div>
              {showCc && (
                <Field label="CC">
                  <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="email1, email2"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
                </Field>
              )}
              {showBcc && (
                <Field label="BCC">
                  <input value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="email1, email2"
                    className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
                </Field>
              )}
              <Field label="Subject">
                <input value={subject} onChange={(e) => setSubject(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              </Field>
              <Field label="Body">
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              </Field>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Cancel</button>
          {sendEmail && (
            <button onClick={() => setPreview(true)} className="h-9 px-4 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] text-[12.5px] font-semibold text-slate-700 inline-flex items-center gap-1.5">
              <Eye size={13} /> Preview Email
            </button>
          )}
          <button onClick={confirm} disabled={saving}
            className="h-9 px-5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm">
            {saving ? "Archiving…" : "Confirm"}
          </button>
        </div>

        {preview && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50" onClick={() => setPreview(false)}>
            <div onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[80vh] flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-[15px] font-semibold text-slate-900">Preview Email</h3>
                <button onClick={() => setPreview(false)} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
                  <X size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-3 text-[13px]">
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">To</p>
                  <p className="mt-1 text-slate-800">{candidate.fullName} &lt;{candidate.email}&gt;</p>
                  {cc && <p className="mt-1 text-[11.5px] text-slate-500">CC: {cc}</p>}
                  {bcc && <p className="mt-1 text-[11.5px] text-slate-500">BCC: {bcc}</p>}
                </div>
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Subject</p>
                  <p className="mt-1 text-slate-800 font-semibold">{subject}</p>
                </div>
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">Body</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-slate-700">{body}</pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
