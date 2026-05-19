"use client";

// HR Offboarding console — two tabs:
//   • Initiate Exit — pick an active employee, fill exit details, submit.
//     Triggers an email to the leaver + a heads-up email + in-app
//     notification to CEO / HR / their manager / admins / developers.
//     Also flips User.isActive=false so they stop appearing in active
//     people lists.
//   • Past Exits — table of every exit on file with clearance checkboxes
//     (assets / docs / final settlement / exit interview) and a Status
//     selector (notice_period / cleared / offboarded).

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { isHRAdmin } from "@/lib/access";
import {
  UserMinus, Search, AlertCircle, CheckCircle2, X, Save, Paperclip, HelpCircle,
} from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import PopupPanel from "@/components/ui/PopupPanel";

type EmpProfile = {
  designation?: string | null;
  department?: string | null;
  employmentType?: string | null;
  joiningDate?: string | null;
  noticePeriodDays?: number | null;
};
type Employee = {
  id: number;
  name: string;
  email: string;
  profilePictureUrl?: string | null;
  employeeProfile?: EmpProfile | null;
};
type Exit = {
  id: number; userId: number; userName: string; userEmail: string;
  designation: string | null; department: string | null;
  exitType: string; resignationDate: string; lastWorkingDay: string;
  noticePeriodDays: number; reason: string | null; notes: string | null;
  status: string;
  assetsReturned: boolean; documentsHandled: boolean;
  finalSettlementDone: boolean; exitInterviewDone: boolean;
  okToRehire: boolean;
  createdAt: string;
};

const EXIT_TYPES = [
  { value: "resignation",   label: "Resignation"   },
  { value: "termination",   label: "Termination"   },
  { value: "contract_end",  label: "Contract End"  },
  { value: "retirement",    label: "Retirement"    },
  { value: "other",         label: "Other"         },
];

const STATUS_TONES: Record<string, string> = {
  notice_period: "bg-amber-50 text-amber-700 ring-amber-200",
  cleared:       "bg-blue-50 text-blue-700 ring-blue-200",
  offboarded:    "bg-slate-100 text-slate-600 ring-slate-200",
};

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function OffboardPage() {
  const { data: session } = useSession();
  const me = session?.user as any;
  // Mirrors src/lib/access.ts:isHRAdmin — was missing special_access.
  const canManage = isHRAdmin(me);

  const [tab, setTab] = useState<"initiate" | "past">("initiate");

  if (!canManage) {
    return (
      <div className="px-6 py-12 text-center text-slate-500 text-[14px]">
        You don't have access to the Offboarding console.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 max-w-6xl">
      <header className="mb-5">
        <h1 className="text-[20px] font-bold text-slate-800 inline-flex items-center gap-2">
          <UserMinus size={20} className="text-rose-500" /> Offboard Employee
        </h1>
        <p className="mt-1 text-[12.5px] text-slate-500">
          Record exits, fire goodbye / heads-up emails, and track clearance.
        </p>
      </header>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {[
          { k: "initiate", l: "Initiate Exit" },
          { k: "past",     l: "Past Exits"    },
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

      {tab === "initiate" && <InitiateExitTab />}
      {tab === "past"     && <PastExitsTab     />}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Initiate Exit — picks an active employee, fills exit details
 * ─────────────────────────────────────────────────────────────────── */

function InitiateExitTab() {
  const { data: employees } = useSWR<Employee[]>("/api/hr/employees?isActive=true", fetcher);
  const [picked, setPicked] = useState<Employee | null>(null);
  const [query, setQuery]   = useState("");
  const [open, setOpen]     = useState(false);
  const [success, setSuccess] = useState("");

  // Pre-select an employee when ?userId=<id> is in the URL — used by
  // the "Initiate Offboarding" link in the user-profile kebab so HR
  // lands directly on the exit form for that person.
  const searchParams = useSearchParams();
  const preselectId  = Number(searchParams.get("userId") || 0) || null;
  useEffect(() => {
    if (!preselectId || picked || !employees) return;
    const match = employees.find((e) => e.id === preselectId);
    if (match) setPicked(match);
  }, [preselectId, picked, employees]);

  const filtered = useMemo(() => {
    const list = (employees ?? []).filter(e => e.id);
    if (!query.trim()) return list.slice(0, 12);
    const q = query.trim().toLowerCase();
    return list
      .filter(e => e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q))
      .slice(0, 12);
  }, [employees, query]);

  // Outside-click to close the dropdown.
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // When an employee is picked, the page swaps from "search + right rail"
  // to a full-width inline exit form (no modal overlay). The search comes
  // back when the user cancels or successfully submits.
  if (picked) {
    return (
      <InitiateExitForm
        employee={picked}
        onCancel={() => setPicked(null)}
        onSubmitted={(name) => {
          setPicked(null);
          setSuccess(`Exit recorded for ${name}. Goodbye email sent and stakeholders notified.`);
          mutate("/api/hr/exits");
          // Invalidate every cached key that might still show this person
          // as active — employee listings, the global search bar, and any
          // mention-pickers — so they disappear immediately without a hard
          // refresh.
          mutate((k: any) => typeof k === "string" && (
            k.startsWith("/api/hr/employees") ||
            k.startsWith("/api/search")
          ));
        }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-5">
        {/* Employee picker — selecting reveals the full-page Initiate
            Exit form (below). Inlined (no <Card>) so the absolute
            dropdown isn't clipped by overflow-hidden. */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-[13.5px] font-semibold text-slate-800">Find employee</h3>
          </div>
          <div className="p-5">
            <div ref={pickerRef} className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="Search by name or email…"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#0f6ecd]"
              />
              <PopupPanel
                open={open}
                triggerRef={pickerRef}
                onClose={() => setOpen(false)}
                maxHeight={320}
                className="bg-white border border-slate-200 rounded-lg shadow-2xl overflow-y-auto"
              >
                  {filtered.length === 0 ? (
                    <p className="px-3 py-3 text-[12.5px] text-slate-500">
                      {query ? "No matching employees." : "No active employees."}
                    </p>
                  ) : (
                    filtered.map(e => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => { setPicked(e); setOpen(false); setQuery(""); }}
                        className="w-full text-left px-3 py-2 hover:bg-[#0f6ecd]/5 border-b border-slate-50 last:border-0"
                      >
                        <p className="text-[13px] font-semibold text-slate-800">{e.name}</p>
                        <p className="text-[11.5px] text-slate-500 truncate">
                          {e.email}{e.employeeProfile?.designation ? ` · ${e.employeeProfile.designation}` : ""}
                          {e.employeeProfile?.department  ? ` · ${e.employeeProfile.department}`  : ""}
                        </p>
                      </button>
                    ))
                  )}
              </PopupPanel>
            </div>
            <p className="mt-2 text-[11.5px] text-slate-500">
              Select an active employee to open the initiate-exit form.
            </p>
          </div>
        </section>

        {success && (
          <div className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12.5px] px-3 py-2.5 rounded-lg">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>{success}</span>
          </div>
        )}
      </div>

      {/* Right rail — what happens on submit */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-[13px] font-semibold text-slate-800 mb-3">What happens next</h3>
          <ul className="space-y-3 text-[12.5px] text-slate-600">
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>Employee account is marked <strong>inactive</strong> — they can no longer sign in.</span></li>
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>A goodbye email goes to the employee with their last working day on record.</span></li>
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>CEO, HR managers, admins, developers, and their reporting manager get an email + in-app notification.</span></li>
            <li className="flex gap-2"><span className="text-emerald-500 mt-0.5">●</span><span>The exit lands in the <strong>Past Exits</strong> tab where you can tick off clearance items.</span></li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

/* ── Keka-style "Initiate exit" full-page form ────────────────────────── */

const RESIGNATION_REASONS = [
  "Better opportunity",
  "Career growth",
  "Higher studies",
  "Personal reasons",
  "Relocation",
  "Health",
  "Family commitments",
  "Other",
];
const TERMINATION_REASONS = [
  "Performance",
  "Misconduct",
  "Position eliminated",
  "Attendance issues",
  "Policy violation",
  "Contract end",
  "Other",
];

function addDaysISO(iso: string, days: number) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function InitiateExitForm({
  employee,
  onCancel,
  onSubmitted,
}: {
  employee: Employee;
  onCancel: () => void;
  onSubmitted: (name: string) => void;
}) {
  const profile      = employee.employeeProfile ?? {};
  const workerType   = profile.employmentType || "Fulltime";
  const department   = profile.department || "—";
  const joiningDate  = profile.joiningDate ?? null;
  const noticeDays   = Number.isFinite(Number(profile.noticePeriodDays)) ? Number(profile.noticePeriodDays) : 30;
  const today        = new Date().toISOString().slice(0, 10);

  const [initiatedBy, setInitiatedBy]           = useState<"employee" | "company">("employee");
  const [hadDiscussion, setHadDiscussion]       = useState<"yes" | "no">("yes");
  const [discussionSummary, setDiscussionSummary] = useState("");
  const [reason, setReason]                     = useState("");
  const [noticeDate, setNoticeDate]             = useState(today);
  const [lwdChoice, setLwdChoice]               = useState<"original" | "other">("original");
  const [lwdOther, setLwdOther]                 = useState("");
  const [okToRehire, setOkToRehire]             = useState(false);
  const [comments, setComments]                 = useState("");
  const [attachment, setAttachment]             = useState<File | null>(null);
  const [attachError, setAttachError]           = useState("");
  const [saving, setSaving]                     = useState(false);
  const [error, setError]                       = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 5 MB cap — keeps the base64-into-notes approach reasonable without
  // a separate Blob-storage backend. Tweak if HR needs to attach
  // larger files down the road.
  const MAX_ATTACH_BYTES = 5 * 1024 * 1024;

  const pickFile = () => {
    setAttachError("");
    fileInputRef.current?.click();
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachError("");
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (f.size > MAX_ATTACH_BYTES) {
      setAttachError(`File too large (max ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)} MB).`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setAttachment(f);
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("File read failed"));
      reader.onload  = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(file);
    });

  const originalLwd     = addDaysISO(noticeDate, noticeDays);
  const lastWorkingDay  = lwdChoice === "original" ? originalLwd : lwdOther;
  const initiatedLabel  = initiatedBy === "employee" ? "Resignation" : "Termination";
  const reasonOptions   = initiatedBy === "employee" ? RESIGNATION_REASONS : TERMINATION_REASONS;

  const submit = async () => {
    setError("");
    if (!reason) { setError(`${initiatedBy === "employee" ? "Reason for resignation" : "Reason for termination"} is required.`); return; }
    if (!lastWorkingDay) { setError("Last working day is required."); return; }
    setSaving(true);
    try {
      // Fold the Keka-style extras (discussion summary, rehire flag,
      // additional comments) into the existing `notes` column as
      // structured text so no DB migration is needed.
      const notesParts: string[] = [];
      if (hadDiscussion === "yes" && discussionSummary.trim()) {
        notesParts.push(`Discussion: ${discussionSummary.trim()}`);
      } else if (hadDiscussion === "no") {
        notesParts.push("Discussion with employee: No.");
      }
      if (comments.trim()) notesParts.push(`Comments: ${comments.trim()}`);
      // Attachment: read as data URL and stash in notes. Not ideal long
      // term (a Blob-storage backend would be cleaner) but unblocks HR
      // without a schema change. Capped at MAX_ATTACH_BYTES above.
      if (attachment) {
        try {
          const dataUrl = await readFileAsDataUrl(attachment);
          notesParts.push(`Attachment: ${attachment.name} (${attachment.type || "file"}, ${attachment.size} bytes)\nData URL: ${dataUrl}`);
        } catch {
          // Don't block submission on a flaky read — record that it failed
          // so HR knows to re-attach.
          notesParts.push(`Attachment: ${attachment.name} — failed to encode, please re-attach.`);
        }
      }

      const res = await fetch("/api/hr/exits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId:           employee.id,
          exitType:         initiatedBy === "employee" ? "resignation" : "termination",
          resignationDate:  noticeDate,
          lastWorkingDay,
          noticePeriodDays: noticeDays,
          reason,
          notes:            notesParts.join("\n"),
          okToRehire,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Submission failed");
      onSubmitted(employee.name);
    } catch (e: any) {
      setError(e?.message || "Submission failed");
    } finally {
      setSaving(false);
    }
  };

  const nameInitials = (employee.name ?? "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div className="rounded-xl bg-white border border-slate-200 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
      {/* Header — inline page header with a back button */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12.5px] font-medium text-slate-600 hover:bg-slate-100"
            title="Back to employee search"
          >
            ← Back
          </button>
          <h3 className="text-[16px] font-bold text-slate-800">
            Initiate exit - <span>{employee.name}</span>
          </h3>
        </div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700">
          <X size={20} />
        </button>
      </div>

      {/* Body */}
      <div className="px-6 py-5 space-y-6">
          {/* Employee chip */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#0f6ecd] to-[#0a5fb3] text-white flex items-center justify-center text-[15px] font-bold overflow-hidden shrink-0">
                {employee.profilePictureUrl
                  ? <img src={employee.profilePictureUrl} alt={employee.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  : nameInitials}
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-slate-800 truncate">{employee.name}</p>
                <p className="text-[11.5px] text-slate-500 truncate">{profile.designation || "—"}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-[11.5px]">
              <div>
                <p className="text-slate-500 mb-0.5">Worker type</p>
                <p className="text-slate-800 font-medium capitalize">{workerType}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Department</p>
                <p className="text-slate-800 font-medium truncate">{department}</p>
              </div>
              <div>
                <p className="text-slate-500 mb-0.5">Date of joining</p>
                <p className="text-slate-800 font-medium">{joiningDate ? fmtDate(joiningDate) : "—"}</p>
              </div>
            </div>
          </div>

          {/* Initiated by */}
          <div>
            <p className="text-[12.5px] font-semibold text-slate-800 mb-2">
              What is the reason for initiating this exit?
            </p>
            <div className="flex gap-6">
              <Radio
                checked={initiatedBy === "employee"}
                onChange={() => { setInitiatedBy("employee"); setReason(""); }}
                label="Employee wants to resign"
              />
              <Radio
                checked={initiatedBy === "company"}
                onChange={() => { setInitiatedBy("company"); setReason(""); }}
                label="Company decides to terminate"
              />
            </div>
          </div>

          {/* Discussion */}
          <div>
            <p className="text-[12.5px] font-semibold text-slate-800 mb-2">
              Did you have discussion with employee regarding this?
            </p>
            <div className="flex gap-6">
              <Radio checked={hadDiscussion === "yes"} onChange={() => setHadDiscussion("yes")} label="Yes" />
              <Radio checked={hadDiscussion === "no"}  onChange={() => setHadDiscussion("no")}  label="No"  />
            </div>
          </div>

          {hadDiscussion === "yes" && (
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">Discussion Summary</label>
              <textarea
                rows={3}
                value={discussionSummary}
                onChange={(e) => setDiscussionSummary(e.target.value)}
                placeholder="Type here"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
              />
            </div>
          )}

          {/* Reason + notice date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">
                Reason for {initiatedBy === "employee" ? "resignation" : "termination"}
              </label>
              <NiceSelect
                value={reason}
                onChange={setReason}
                placeholder="Select Reason"
                options={reasonOptions}
              />
            </div>
            <div>
              <label className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">
                {initiatedBy === "employee" ? "Resignation date" : "Termination notice date"}
                <span title="The date the resignation / termination notice was submitted or issued." className="ml-1 inline-flex align-middle text-slate-400 hover:text-slate-600 cursor-help">
                  <HelpCircle size={12} />
                </span>
              </label>
              <DateField value={noticeDate} onChange={setNoticeDate} className="w-full" />
            </div>
          </div>

          {/* Recommended last working day */}
          <div>
            <p className="text-[12.5px] font-semibold text-slate-800 mb-2">Recommended last working day?</p>
            <div className="space-y-2">
              <Radio
                checked={lwdChoice === "original"}
                onChange={() => setLwdChoice("original")}
                label={
                  <span>
                    Original notice period - <span className="font-semibold text-slate-800">{originalLwd ? fmtDate(originalLwd) : "—"}</span>
                  </span>
                }
              />
              <div className="flex items-center gap-3">
                <Radio
                  checked={lwdChoice === "other"}
                  onChange={() => setLwdChoice("other")}
                  label="Other:"
                />
                {lwdChoice === "other" && (
                  <DateField
                    value={lwdOther}
                    onChange={setLwdOther}
                    min={new Date().toISOString().slice(0, 10)}
                    className="w-44"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Ok to rehire */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={okToRehire}
              onChange={(e) => setOkToRehire(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#0f6ecd] focus:ring-[#0f6ecd]"
            />
            <span className="text-[13px] text-slate-700">Mark employee as Ok to rehire</span>
          </label>

          {/* Additional comments */}
          <div>
            <label className="block text-[12.5px] font-semibold text-slate-800 mb-1.5">Additional comments</label>
            <textarea
              rows={3}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Type here"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
            />
          </div>

          {/* Add attachment — opens the OS file picker. Selected file is
              base64-encoded into the existing `notes` column on submit
              (5 MB cap) so no schema change is needed. */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={onFilePicked}
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif,.heic"
            />
            {attachment ? (
              <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px]">
                <Paperclip size={13} className="text-slate-500" />
                <span className="text-slate-800 font-medium">{attachment.name}</span>
                <span className="text-slate-500">({(attachment.size / 1024).toFixed(1)} KB)</span>
                <button
                  type="button"
                  onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  className="text-slate-400 hover:text-rose-600"
                  title="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={pickFile}
                className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[#0f6ecd] hover:text-[#0a5fb3]"
              >
                <Paperclip size={13} /> Add attachment
                <span title={`PDF / DOC / image up to ${Math.round(MAX_ATTACH_BYTES / 1024 / 1024)} MB`} className="text-slate-400 hover:text-slate-600">
                  <HelpCircle size={12} />
                </span>
              </button>
            )}
            {attachError && (
              <p className="mt-1 text-[11.5px] text-rose-600">{attachError}</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-[12.5px] px-3 py-2.5 rounded-lg">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onCancel}
            className="h-9 px-4 rounded-lg border border-[#0f6ecd] text-[13px] font-semibold text-[#0f6ecd] hover:bg-[#0f6ecd]/5 disabled:opacity-60"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || !reason || !lastWorkingDay}
            className="h-9 px-5 rounded-lg bg-rose-500 hover:bg-rose-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-[13px] font-semibold"
          >
            {saving ? "Initiating…" : "Initiate exit"}
          </button>
        </div>
    </div>
  );
}

/**
 * Branded dropdown replacement for native <select> — Chromium ignores most
 * CSS on <option> elements, leaving the OS focus highlight (black on
 * Linux/Brave) showing through and looking unprofessional. This builds a
 * fully-styleable button + popover instead, so hover / focus / selected
 * states match the rest of the app.
 */
function NiceSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-9 px-3 pr-8 text-left border border-slate-200 rounded-lg text-[13px] bg-white text-slate-800 focus:outline-none focus:border-[#0f6ecd] flex items-center"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={value ? "text-slate-800" : "text-slate-400"}>
          {value || placeholder}
        </span>
        <svg
          className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <PopupPanel
        open={open}
        triggerRef={ref}
        onClose={() => setOpen(false)}
        maxHeight={288}
        className="bg-white border border-slate-200 rounded-lg shadow-2xl overflow-y-auto py-1"
      >
        <ul role="listbox">
          {options.map((opt) => {
            const active = opt === value;
            return (
              <li key={opt}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => { onChange(opt); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-[13px] transition-colors ${
                    active
                      ? "bg-[#0f6ecd]/10 text-[#0f6ecd] font-semibold"
                      : "text-slate-700 hover:bg-[#0f6ecd]/5 hover:text-[#0f6ecd]"
                  }`}
                >
                  {opt}
                </button>
              </li>
            );
          })}
        </ul>
      </PopupPanel>
    </div>
  );
}

function Radio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: React.ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <span
        className={`h-4 w-4 rounded-full border-2 flex items-center justify-center transition-colors ${
          checked ? "border-violet-600" : "border-slate-300"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-violet-600" />}
      </span>
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="text-[13px] text-slate-700">{label}</span>
    </label>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Past Exits — list + clearance checkboxes
 * ─────────────────────────────────────────────────────────────────── */

function PastExitsTab() {
  const { data: rows, isLoading } = useSWR<Exit[]>("/api/hr/exits", fetcher);
  const [open, setOpen] = useState<Exit | null>(null);

  if (isLoading) return <p className="text-[13px] text-slate-400 py-6 text-center">Loading…</p>;
  const list = rows ?? [];

  if (list.length === 0) {
    return (
      <div className="bg-white border border-dashed border-slate-200 rounded-xl py-12 text-center text-slate-400 text-[13px]">
        No exits recorded yet.
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500">
            <th className="text-left px-4 py-3">Employee</th>
            <th className="text-left px-4 py-3">Type</th>
            <th className="text-left px-4 py-3">Last Day</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-left px-4 py-3">Clearance</th>
            <th className="text-left px-4 py-3">Rehire</th>
            <th className="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => {
            const tone = STATUS_TONES[r.status] || STATUS_TONES.notice_period;
            const checked = [r.assetsReturned, r.documentsHandled, r.finalSettlementDone, r.exitInterviewDone].filter(Boolean).length;
            return (
              <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/40">
                <td className="px-4 py-3 align-top">
                  {/* Name is a link to the (now-inactive) profile so HR
                      can still review the person's old attendance, leaves,
                      assets, etc. The /api/hr/people/[id] endpoint doesn't
                      filter by isActive, so the page renders for offboarded
                      users too. */}
                  <Link
                    href={`/dashboard/hr/people/${r.userId}`}
                    className="text-[13.5px] font-semibold text-slate-800 hover:text-[#0f6ecd] hover:underline"
                  >
                    {r.userName}
                  </Link>
                  <p className="text-[11.5px] text-slate-500">
                    {r.userEmail}{r.designation ? ` · ${r.designation}` : ""}
                  </p>
                </td>
                <td className="px-4 py-3 align-top text-[12.5px] text-slate-700 capitalize">
                  {r.exitType.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-3 align-top text-[12.5px] text-slate-700 tabular-nums">
                  {fmtDate(r.lastWorkingDay)}
                </td>
                <td className="px-4 py-3 align-top">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone}`}>
                    {r.status.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-[12.5px] text-slate-600 tabular-nums">
                  {checked} / 4
                </td>
                <td className="px-4 py-3 align-top">
                  {r.okToRehire ? (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-500/20">
                      Ok to rehire
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-right">
                  <button
                    onClick={() => setOpen(r)}
                    className="text-[12px] font-semibold text-[#0f6ecd] hover:underline"
                  >
                    Manage →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {open && <ExitManageModal exit={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ExitManageModal({ exit, onClose }: { exit: Exit; onClose: () => void }) {
  const [status, setStatus] = useState(exit.status);
  const [assetsReturned, setAssetsReturned] = useState(exit.assetsReturned);
  const [documentsHandled, setDocumentsHandled] = useState(exit.documentsHandled);
  const [finalSettlementDone, setFinalSettlementDone] = useState(exit.finalSettlementDone);
  const [exitInterviewDone, setExitInterviewDone] = useState(exit.exitInterviewDone);
  const [okToRehire, setOkToRehire] = useState(exit.okToRehire);
  const [notes, setNotes] = useState(exit.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [reactivating, setReactivating] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/hr/exits/${exit.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, assetsReturned, documentsHandled, finalSettlementDone, exitInterviewDone, okToRehire, notes }),
      });
      mutate("/api/hr/exits");
      // Status drives User.isActive — invalidate every cached key that
      // surfaces active/inactive state so the change shows up instantly
      // in the directory, the top-bar search, and @-mention pickers.
      mutate((k: any) => typeof k === "string" && (
        k.startsWith("/api/hr/employees") ||
        k.startsWith("/api/search")
      ));
      onClose();
    } finally { setSaving(false); }
  };

  // Reactivate — flips User.isActive back to true and deletes the exit
  // row so the employee reappears in active directories and can sign in
  // again. Historical attendance / leaves / posts are untouched.
  const reactivate = async () => {
    const ok = window.confirm(
      `Bring ${exit.userName} back as an active employee?\n\n` +
      `• Their account will be re-enabled (they can sign in).\n` +
      `• They will reappear in the directory and search.\n` +
      `• This exit record will be removed from Past Exits.\n` +
      `• Their old attendance, leaves, and history stay intact.`,
    );
    if (!ok) return;
    setReactivating(true);
    try {
      const res = await fetch(`/api/hr/exits/${exit.id}/reactivate`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.error || "Reactivate failed");
        return;
      }
      mutate("/api/hr/exits");
      mutate((k: any) => typeof k === "string" && (
        k.startsWith("/api/hr/employees") ||
        k.startsWith("/api/search")
      ));
      onClose();
    } catch (e: any) {
      alert(e?.message || "Reactivate failed");
    } finally {
      setReactivating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">{exit.userName}</h3>
            <p className="text-[11.5px] text-slate-500">
              {exit.exitType.replace(/_/g, " ")} · last day {fmtDate(exit.lastWorkingDay)}
            </p>
          </div>
          <button onClick={onClose}><X size={18} className="text-slate-400 hover:text-slate-700" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Status</p>
            <div className="flex gap-1.5">
              {["notice_period", "cleared", "offboarded"].map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={`px-3 h-8 rounded-full text-[11.5px] font-semibold ring-1 ring-inset transition-colors ${
                    status === s ? STATUS_TONES[s] : "bg-white text-slate-600 ring-slate-200 hover:ring-[#0f6ecd]"
                  }`}
                >
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Clearance</p>
            <div className="space-y-1.5">
              <Check label="Assets returned"          checked={assetsReturned}      onChange={setAssetsReturned} />
              <Check label="Documents handled"        checked={documentsHandled}    onChange={setDocumentsHandled} />
              <Check label="Final settlement done"    checked={finalSettlementDone} onChange={setFinalSettlementDone} />
              <Check label="Exit interview completed" checked={exitInterviewDone}   onChange={setExitInterviewDone} />
            </div>
          </div>

          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Rehire</p>
            <Check label="Ok to rehire this employee" checked={okToRehire} onChange={setOkToRehire} />
          </div>

          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 mb-2">Notes</p>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd] resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-200">
          <button
            onClick={reactivate}
            disabled={saving || reactivating}
            className="h-9 px-4 rounded-lg border border-emerald-300 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Re-enable this employee — account is restored and exit record is removed"
          >
            {reactivating ? "Reactivating…" : "Reactivate employee"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-9 px-4 text-[13px] text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button
              onClick={save}
              disabled={saving || reactivating}
              className="h-9 px-5 rounded-lg bg-[#0f6ecd] hover:bg-[#0a5fb3] text-white text-[13px] font-semibold disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              <Save size={13} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  Tiny presentational helpers
 * ─────────────────────────────────────────────────────────────────── */

const ipt = "w-full h-9 px-3 border border-slate-200 rounded-lg text-[13px] text-slate-800 focus:outline-none focus:border-[#0f6ecd]";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-[13.5px] font-semibold text-slate-800">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-slate-700 mb-1.5">
        {label}{required ? <span className="text-rose-500"> *</span> : null}
      </label>
      {children}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer text-[13px] text-slate-700 hover:text-slate-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-[#0f6ecd] focus:ring-[#0f6ecd]"
      />
      <span>{label}</span>
    </label>
  );
}
