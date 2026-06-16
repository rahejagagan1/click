"use client";

// Team Welcome — fired from the HR onboard page right after a new
// employee is successfully created. Pre-loads template #11 ("Cheers
// to New Faces! Introducing X to the Team NB Media") via the shared
// EmailComposer so HR can edit, attach a profile photo, preview, then
// send to the whole company.

import { useEffect } from "react";
import { X } from "lucide-react";
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
          <EmailComposer
            candidateName={newJoiner.fullName}
            jobRole={newJoiner.jobRole}
            defaultTo="(All active employees — BCC)"
            initialSubject={tpl.subject}
            initialBody={tpl.body}
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
