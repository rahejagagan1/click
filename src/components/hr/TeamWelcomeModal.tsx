"use client";

// Team Welcome — fired from the HR onboard page right after a new
// employee is successfully created. Pre-loads template #11 ("Cheers
// to New Faces! Introducing X to the Team NB Media") via the shared
// EmailComposer so HR can edit, attach a profile photo, preview, then
// send to the whole company.

import { useEffect, useMemo, useRef, useState } from "react";
import { X, ImagePlus } from "lucide-react";
import { teamWelcomeEmail } from "@/lib/email/hr-templates";
import EmailComposer, { type EmailComposerPayload } from "./hiring/EmailComposer";

export default function TeamWelcomeModal({
  newJoiner, onClose, onSent,
}: {
  newJoiner: {
    fullName:    string;
    firstName:   string;
    jobRole:     string;
    homeCity?:   string;
    priorRole?:  string;
    managerName?: string;
    officeLocation?: string;
    phone?:      string;
    workEmail:   string;
    pronoun?:    "he" | "she" | "they";
  };
  onClose: () => void;
  onSent?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Optional new-joiner photo — attached to the welcome email so the team
  // can put a face to the name. Onboarding doesn't capture a photo, so HR
  // picks one here; it rides the composer's normal attachment pipeline.
  const [photo, setPhoto] = useState<{ filename: string; contentType?: string; contentBase64: string; size: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const initialAttachments = useMemo(() => (photo ? [photo] : []), [photo]);

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // let HR re-pick the same file after removing
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { alert("Photo is larger than 4 MB — pick a smaller image."); return; }
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result ?? ""); const i = s.indexOf(","); res(i >= 0 ? s.slice(i + 1) : s); };
        r.onerror = () => rej(r.error ?? new Error("read failed"));
        r.readAsDataURL(f);
      });
      setPhoto({ filename: f.name, contentType: f.type || "image/jpeg", contentBase64: b64, size: f.size });
    } catch { alert("Couldn't read that image — try another file."); }
  };

  const tpl = teamWelcomeEmail({
    newJoinerName: newJoiner.fullName,
    firstName:     newJoiner.firstName,
    homeCity:      newJoiner.homeCity      || undefined,
    priorRole:     newJoiner.priorRole     || undefined,
    jobRole:       newJoiner.jobRole,
    managerName:   newJoiner.managerName   || undefined,
    officeLocation: newJoiner.officeLocation || undefined,
    phone:         newJoiner.phone         || undefined,
    workEmail:     newJoiner.workEmail,
    pronoun:       newJoiner.pronoun ?? "they",
  });

  const send = async (p: EmailComposerPayload) => {
    const res = await fetch("/api/hr/team/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: p.subject,
        body:    p.bodyHtml,
        attachments: p.attachments.map(({ filename, contentType, contentBase64 }) =>
          ({ filename, contentType, contentBase64 })),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || "Couldn't send team welcome");
    }
    onSent?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900">Welcome {newJoiner.firstName} to the team</h3>
            <p className="text-[11px] text-slate-500">
              Announces the new joiner to every active employee. Sent as BCC so the team list isn't exposed.
            </p>
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* New-joiner photo — attaches to the welcome email. */}
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
            {photo ? (
              <img src={`data:${photo.contentType || "image/jpeg"};base64,${photo.contentBase64}`} alt={`${newJoiner.firstName}`} className="h-12 w-12 rounded-full object-cover ring-1 ring-slate-200" />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 text-slate-400"><ImagePlus size={18} /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-slate-800">{newJoiner.firstName}'s photo</p>
              <p className="text-[11px] text-slate-500">
                {photo ? `Attached · ${Math.max(1, Math.round(photo.size / 1024))} KB` : "Optional — attaches to the welcome email so the team can put a face to the name."}
              </p>
            </div>
            {photo ? (
              <button type="button" onClick={() => setPhoto(null)} className="text-[11.5px] font-medium text-slate-500 hover:text-rose-600">Remove</button>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="h-8 px-3 rounded-lg bg-[#008CFF] text-white text-[11.5px] font-semibold hover:bg-[#0070cc] transition-colors">Choose photo</button>
            )}
          </div>

          <EmailComposer
            candidateName={newJoiner.fullName}
            jobRole={newJoiner.jobRole}
            defaultTo="(All active employees — BCC)"
            initialSubject={tpl.subject}
            initialBody={tpl.body}
            initialAttachments={initialAttachments}
            showTemplatePicker={false}
            recipientEditable={false}
            context="team_welcome"
            submitLabel="Send to team"
            onCancel={onClose}
            onSend={send}
          />
        </div>
      </div>
    </div>
  );
}
