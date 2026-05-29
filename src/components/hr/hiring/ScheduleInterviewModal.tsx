"use client";

// Schedule Interview — Keka-parity modal.
//
//   Three interview modes:
//     • online        — Meet/Zoom/Teams link; defaults to {{MeetingLink}}
//                       placeholder until the Google Calendar integration
//                       is wired (see GOOGLE_MEET_SETUP.md in repo root).
//     • face_to_face  — On-site; HR enters the address as the location.
//     • self_schedule — Sends the candidate a slot picker (placeholder
//                       for now — just emails a "pick a time" link).
//
// On submit:
//   1. POST /api/hr/hiring/candidates/[id] with action=scheduleInterview
//      (existing backend path — captures the Interview row + activity).
//   2. POST /api/hr/hiring/candidates/[id] with action=sendEmail to mail
//      the candidate the schedule + meeting link.
//
// The two calls are sequential because the Interview row is the
// source of truth and we want to email the candidate only after it
// lands. If the email fails the row stays — HR can resend later.

import { useEffect, useMemo, useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { fetcher } from "@/lib/swr";
import { DateField } from "@/components/ui/date-field";
import {
  X, Calendar, Clock, Users, Video, MapPin, Send, Eye, ChevronDown,
  Paperclip, FileText, Check,
} from "lucide-react";

type InterviewKind = "online" | "face_to_face" | "self_schedule";

interface UserRow { id: number; name: string; email?: string }
interface Candidate {
  id: number;
  fullName: string;
  email: string;
  roleTitle: string | null;
  jobOpeningId: number;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

export default function ScheduleInterviewModal({
  candidate, defaultKind, onClose, onDone,
}: {
  candidate: Candidate;
  defaultKind?: InterviewKind;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [kind, setKind] = useState<InterviewKind>(defaultKind ?? "online");
  const [panelIds, setPanelIds] = useState<number[]>([]);
  // Default: tomorrow 10:30 AM.
  const tomorrow = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 30, 0, 0);
    return d;
  }, []);
  const [date, setDate]         = useState(tomorrow.toISOString().slice(0, 10));
  const [time, setTime]         = useState("10:30");
  const [duration, setDuration] = useState(60);
  const [title, setTitle]       = useState(`${kind === "online" ? "Online" : kind === "face_to_face" ? "On-site" : "Self-schedule"} Interview`);
  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [subject, setSubject]   = useState(
    `${kind === "online" ? "Online Interview" : kind === "face_to_face" ? "Onsite Interview" : "Pick your interview slot"} — ${candidate.fullName} with NB Media`,
  );
  const [body, setBody]         = useState(defaultBody(candidate, kind, date, time, duration));
  const [attachJd, setAttachJd] = useState(true);
  const [paneTab, setPaneTab]   = useState<"email" | "note">("email");
  const [noteToPanel, setNoteToPanel] = useState("");
  const [preview, setPreview]   = useState(false);
  const [saving, setSaving]     = useState(false);

  // Refresh subject + body whenever the kind changes so HR sees the
  // right defaults without manually retyping.
  useEffect(() => {
    setTitle(`${kind === "online" ? "Online" : kind === "face_to_face" ? "On-site" : "Self-schedule"} Interview`);
    setSubject(`${kind === "online" ? "Online Interview" : kind === "face_to_face" ? "Onsite Interview" : "Pick your interview slot"} — ${candidate.fullName} with NB Media`);
    setBody(defaultBody(candidate, kind, date, time, duration));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // ?all=true → include regular employees in the panel picker.
  const { data: usersData } = useSWR<{ users?: UserRow[] } | UserRow[]>("/api/users?all=true", fetcher);
  const users: UserRow[] = Array.isArray(usersData)
    ? usersData : Array.isArray((usersData as any)?.users) ? (usersData as any).users : [];

  const submit = async () => {
    if (!title.trim())                  return alert("Title required");
    if (!date || !time)                 return alert("Date and time required");
    if (!subject.trim() || !body.trim()) return alert("Subject and body are required");
    const scheduledAt = new Date(`${date}T${time}`);
    if (isNaN(scheduledAt.getTime()))   return alert("Invalid date/time");

    setSaving(true);
    try {
      // Step 1 — create the Interview row. For kind=online the backend
      // mints a Google Meet link automatically; we read it from the
      // response below.
      const r1 = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "scheduleInterview",
          kind,
          title: title.trim(),
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: duration,
          location: kind === "online" ? (meetingLink || "{{MeetingLink}}") : location.trim() || null,
          note: noteToPanel.trim() || null,
        }),
      });
      if (!r1.ok) {
        const j = await r1.json().catch(() => ({}));
        throw new Error(j?.error || "Couldn't schedule interview");
      }
      const r1Json: any = await r1.json().catch(() => ({}));
      const autoMeetUrl: string | null = r1Json?.interview?.meetingUrl ?? null;

      // Step 2 — mail the candidate. The body is plaintext-with-
      // newlines; backend converts to <br/> before sending.
      // Prefer the manually-pasted link, then the auto-created one,
      // then a clearly-unfilled placeholder so HR notices.
      const linkForBody = meetingLink || autoMeetUrl || "{{MeetingLink — fill in before sending}}";
      const finalBody = body
        .replaceAll("{{CandidateName}}", candidate.fullName)
        .replaceAll("{{JobTitle}}",       candidate.roleTitle ?? "your application")
        .replaceAll("{{InterviewDate}}",  scheduledAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))
        .replaceAll("{{MeetingLink}}",    linkForBody);
      const r2 = await fetch(`/api/hr/hiring/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sendEmail",
          to: candidate.email,
          subject: subject.trim(),
          body: finalBody.replace(/\n/g, "<br/>"),
        }),
      });
      if (!r2.ok) {
        const j = await r2.json().catch(() => ({}));
        // Don't blow up — Interview is already saved.
        alert(`Interview scheduled, but email failed: ${j?.error || "unknown error"}. You can resend from the candidate drawer.`);
      }

      globalMutate("/api/hr/hiring/candidates");
      onDone?.();
      onClose();
    } catch (e: any) {
      alert(e?.message || "Failed to schedule");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[720px] bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-slate-900 truncate">
              Schedule {kind === "online" ? "Online" : kind === "face_to_face" ? "Face-to-Face" : "Self-schedule"} Interview with {candidate.fullName}
            </h3>
            {candidate.roleTitle && <p className="text-[11.5px] text-slate-500 truncate">{candidate.roleTitle}</p>}
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        {/* Kind toggle */}
        <div className="px-5 pt-4">
          <div className="inline-flex p-1 rounded-lg border border-slate-200 bg-slate-50">
            <KindButton active={kind === "online"}       onClick={() => setKind("online")}       Icon={Video}   label="Online" />
            <KindButton active={kind === "face_to_face"} onClick={() => setKind("face_to_face")} Icon={MapPin}  label="Face to Face" />
            <KindButton active={kind === "self_schedule"} onClick={() => setKind("self_schedule")} Icon={Calendar} label="Self-schedule" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Panel + schedule */}
          <Field label="Panel Members">
            <UserMultiPicker
              all={users}
              selected={panelIds}
              onChange={setPanelIds}
              placeholder="Select interviewers"
            />
          </Field>

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4">
              <Field label="Interview Date">
                <DateField value={date} onChange={setDate} />
              </Field>
            </div>
            <div className="col-span-4">
              <Field label="Start Time">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              </Field>
            </div>
            <div className="col-span-4">
              <Field label="Duration">
                <div className="relative">
                  <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}
                    className="appearance-none w-full h-10 pl-3 pr-9 rounded-lg border border-slate-200 bg-white text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]">
                    {DURATIONS.map((m) => <option key={m} value={m}>{m} min</option>)}
                  </select>
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </Field>
            </div>
          </div>

          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
          </Field>

          {kind === "online" && (
            <Field label="Meeting link (Google Meet / Zoom / Teams)">
              <input value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="Leave blank to auto-create a Google Meet link"
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
              <p className="mt-1 text-[10.5px] text-slate-400">
                Leave blank and a Google Meet link is created automatically. Or paste your own (Zoom / Teams / custom Meet).
              </p>
            </Field>
          )}
          {kind === "face_to_face" && (
            <Field label="Location / address">
              <input value={location} onChange={(e) => setLocation(e.target.value)}
                placeholder="NB Media Office, Mohali (Floor 4, Room 402)"
                className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
            </Field>
          )}

          {/* Email / Note tabs */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center gap-5 border-b border-slate-200 -mb-px">
              {(["email", "note"] as const).map((t) => (
                <button key={t} onClick={() => setPaneTab(t)}
                  className={`py-2.5 border-b-2 text-[12.5px] font-semibold transition-colors ${
                    paneTab === t ? "border-[#3b82f6] text-[#3b82f6]" : "border-transparent text-slate-500 hover:text-slate-900"
                  }`}
                >{t === "email" ? "Email to candidate" : "Note for Interview Panel"}</button>
              ))}
            </div>

            {paneTab === "email" ? (
              <div className="pt-4 space-y-3">
                <Field label="Subject">
                  <input value={subject} onChange={(e) => setSubject(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
                </Field>
                <Field label="Body">
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={9}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
                  <p className="mt-1 text-[10.5px] text-slate-400">
                    Placeholders: <code>{`{{CandidateName}}`}</code> · <code>{`{{JobTitle}}`}</code> · <code>{`{{InterviewDate}}`}</code> · <code>{`{{MeetingLink}}`}</code>
                  </p>
                </Field>
                <label className="inline-flex items-center gap-2.5 text-[12.5px] text-slate-700 cursor-pointer">
                  <input type="checkbox" checked={attachJd} onChange={(e) => setAttachJd(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-[#3b82f6]" />
                  <Paperclip size={13} className="text-slate-400" />
                  Attach job description
                  <span className="text-[10.5px] text-slate-400">(automatic if the job has a JD file)</span>
                </label>
              </div>
            ) : (
              <div className="pt-4">
                <Field label="Note (visible to the interview panel)">
                  <textarea value={noteToPanel} onChange={(e) => setNoteToPanel(e.target.value)} rows={4}
                    placeholder="Anything the panel should know before the interview — strengths, gaps, what to probe."
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
                </Field>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-[12.5px] font-semibold text-slate-700 hover:bg-white">Cancel</button>
          <button onClick={() => setPreview(true)} className="h-9 px-4 rounded-lg border border-slate-200 bg-white hover:border-[#3b82f6] text-[12.5px] font-semibold text-slate-700 inline-flex items-center gap-1.5">
            <Eye size={13} /> Preview Email
          </button>
          <button onClick={submit} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-5 rounded-lg bg-[#3b82f6] hover:bg-[#2563eb] disabled:bg-slate-300 text-white text-[12.5px] font-semibold shadow-sm">
            <Send size={13} /> {saving ? "Scheduling…" : "Send"}
          </button>
        </div>

        {preview && (
          <PreviewModal
            candidate={candidate}
            subject={subject
              .replaceAll("{{CandidateName}}", candidate.fullName)
              .replaceAll("{{JobTitle}}", candidate.roleTitle ?? "your application")}
            body={body
              .replaceAll("{{CandidateName}}", candidate.fullName)
              .replaceAll("{{JobTitle}}",       candidate.roleTitle ?? "your application")
              .replaceAll("{{InterviewDate}}",  new Date(`${date}T${time}`).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))
              .replaceAll("{{MeetingLink}}",    meetingLink || "{{MeetingLink}}")}
            onClose={() => setPreview(false)}
          />
        )}
      </div>
    </div>
  );
}

function KindButton({ active, onClick, Icon, label }: { active: boolean; onClick: () => void; Icon: any; label: string }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded text-[12px] font-semibold transition-colors ${
        active ? "bg-white text-[#3b82f6] shadow-sm" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
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

function PreviewModal({
  candidate, subject, body, onClose,
}: { candidate: Candidate; subject: string; body: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[80vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-slate-900">Preview Email</h3>
          <button onClick={onClose} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3 text-[13px]">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">To</p>
            <p className="mt-1 text-slate-800">{candidate.fullName} &lt;{candidate.email}&gt;</p>
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
  );
}

function defaultBody(c: Candidate, kind: InterviewKind, date: string, time: string, duration: number): string {
  const when = new Date(`${date}T${time}`);
  const whenStr = isNaN(when.getTime())
    ? "{{InterviewDate}}"
    : when.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const fname = (c.fullName ?? "").split(/\s+/)[0] ?? c.fullName;
  const role  = c.roleTitle ?? "your application";
  const hrEmail = process.env.NEXT_PUBLIC_HR_CONTACT_EMAIL || "hr@nbmediaproductions.com";
  const hrLine = `If you have any queries, please reach out to the HR Department — HR Manager: ${hrEmail}.`;

  if (kind === "online") {
    return `Hi ${fname},

We are excited about your interview at NB Media for the post of ${role}.

Your Online Interview is scheduled on ${whenStr} (duration: ${duration} minutes).

Join the meeting using this link: {{MeetingLink}}

${hrLine}

NB Media Hiring Team`;
  }
  if (kind === "face_to_face") {
    return `Hi ${fname},

We are excited about your interview at NB Media for the post of ${role}.

Your Onsite Interview is scheduled on ${whenStr} (duration: ${duration} minutes) at our office. Please bring a photo ID and your resume.

${hrLine}

NB Media Hiring Team`;
  }
  return `Hi ${fname},

Thanks for applying for the role of ${role} at NB Media. Please pick a time that works for you using the link below — the slot is roughly ${duration} minutes.

{{MeetingLink}}

${hrLine}

NB Media Hiring Team`;
}

// ── User multi-picker (lightweight inline version) ─────────────────

function UserMultiPicker({
  all, selected, onChange, placeholder,
}: { all: UserRow[]; selected: number[]; onChange: (ids: number[]) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ]       = useState("");
  const selectedUsers   = all.filter((u) => selected.includes(u.id));
  const filtered = q.trim()
    ? all.filter((u) => (u.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
                        (u.email ?? "").toLowerCase().includes(q.toLowerCase()))
        .filter((u) => !selected.includes(u.id))
    : all.filter((u) => !selected.includes(u.id)).slice(0, 30);

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5 mb-2">
        {selectedUsers.map((u) => (
          <span key={u.id} className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-full bg-blue-50 text-[#1d4ed8] text-[11.5px] font-semibold ring-1 ring-[#3b82f6]/20">
            {u.name}
            <button onClick={() => onChange(selected.filter((id) => id !== u.id))}
              className="inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-[#3b82f6]/20">
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <button onClick={() => setOpen(!open)} type="button"
        className="w-full text-left inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-dashed border-slate-300 text-[12.5px] text-slate-500 hover:border-[#3b82f6] hover:text-[#3b82f6]">
        <Users size={13} /> {placeholder}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl border border-slate-200 bg-white shadow-lg p-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search interviewers"
            className="w-full h-9 px-3 rounded-lg border border-slate-200 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 focus:border-[#3b82f6]" />
          <div className="mt-2 max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[12px] text-slate-400">No users.</p>
            ) : filtered.map((u) => (
              <button key={u.id} onClick={() => { onChange([...selected, u.id]); setQ(""); }}
                className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded text-[12.5px] hover:bg-blue-50 hover:text-[#1d4ed8]">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[10.5px] font-bold text-slate-600">
                  {u.name?.slice(0, 1).toUpperCase() ?? "?"}
                </span>
                <span className="min-w-0">
                  <p className="font-semibold truncate text-slate-800">{u.name}</p>
                  {u.email && <p className="text-[10.5px] text-slate-500 truncate">{u.email}</p>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
