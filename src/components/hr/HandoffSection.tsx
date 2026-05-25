"use client";

// Standardised "Handoff Details" section used by every leave-style
// request form (Leave / WFH / On Duty / Half Day / Comp Off). Implements
// the company's leave-application format:
//
//   • POC in Absence — single employee picker; selected user gets
//     auto-emailed as the named point of contact. Always required.
//   • Work Status — multi-line summary of current tasks. Always required.
//   • Time of Unavailability — free-text time-window(s) when the
//     employee will be away from their workstation. WFH-only; required
//     when shown so every WFH request makes availability explicit.
//
// Pure presentational + state-up component: parent owns the state, the
// section just renders the controls and emits `onChange` callbacks.
// Keeps the form file small and the validation logic in one place
// (parent's submit handler).

import EmployeePicker, { type PickerUser } from "@/components/hr/EmployeePicker";

export default function HandoffSection({
  poc, onPocChange,
  workStatus, onWorkStatusChange,
  unavailability, onUnavailabilityChange,
  /**
   * When true, render the "Time of Unavailability" field. WFH-only —
   * leave / on-duty / comp-off omit it (the employee isn't around to
   * be unavailable; the whole day is the "unavailable" window).
   */
  showUnavailability = false,
}: {
  poc: PickerUser[];
  onPocChange: (next: PickerUser[]) => void;
  workStatus: string;
  onWorkStatusChange: (v: string) => void;
  unavailability?: string;
  onUnavailabilityChange?: (v: string) => void;
  showUnavailability?: boolean;
}) {
  return (
    <section>
      {/* Header line — mirrors the Section helper used by the
          rest of the Request Leave panel so visual rhythm stays
          consistent. */}
      <h3 className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 mb-3">
        Handoff Details
      </h3>

      <div className="space-y-4">
        {/* POC in Absence — single employee. The EmployeePicker is
            multi-select by default; the parent enforces "single" by
            slicing to [0] before reading and refusing to pass more
            than one user back. We mirror that constraint here by
            only ever invoking onPocChange with at-most-one entry. */}
        <div>
          <FieldLabel required>POC in Absence</FieldLabel>
          <EmployeePicker
            selected={poc.slice(0, 1)}
            onChange={(next) => onPocChange(next.slice(-1))}
            placeholder="Search employee covering for you"
          />
          <FieldHint>
            They'll get an email so they know they're covering for you.
          </FieldHint>
        </div>

        {/* Work Status — multi-line textarea. 4 rows matches the doc's
            spec; placeholder nudges the employee toward bullet-point
            style ("• Task A — 80% done; • Task B — handed to X"). */}
        <div>
          <FieldLabel required>Work Status</FieldLabel>
          <textarea
            value={workStatus}
            onChange={(e) => onWorkStatusChange(e.target.value)}
            rows={4}
            required
            placeholder="Current status of your tasks + any pending work…"
            className="w-full px-3 py-2.5 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] focus:ring-2 focus:ring-[#008CFF]/15 resize-none transition-colors"
          />
        </div>

        {/* Time of Unavailability — WFH-only. Required when shown
            (per the locked design): even "Available all day" is an
            acceptable answer, but the field can't be left blank.
            The parent enforces this in its submit handler. */}
        {showUnavailability && (
          <div>
            <FieldLabel required>Time of Unavailability</FieldLabel>
            <input
              type="text"
              value={unavailability ?? ""}
              onChange={(e) => onUnavailabilityChange?.(e.target.value)}
              required
              placeholder='e.g. "2-4 PM for school pickup" or "Available all day"'
              className="w-full h-10 px-3 bg-white dark:bg-[#0a1e3a] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF] focus:ring-2 focus:ring-[#008CFF]/15 transition-colors"
            />
            <FieldHint>
              Mention any windows you'll be away from your workstation.
            </FieldHint>
          </div>
        )}
      </div>
    </section>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-1.5">
      {children}
      {required ? <span className="text-rose-500 ml-1">*</span> : null}
    </label>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[10.5px] text-slate-500 dark:text-slate-400">{children}</p>
  );
}
