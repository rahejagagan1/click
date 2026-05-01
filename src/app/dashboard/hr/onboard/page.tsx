"use client";
import { useState, useMemo, useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/swr";
import { useRouter } from "next/navigation";
import { User as UserIcon, Briefcase, Settings as SettingsIcon, IndianRupee, Check, X } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { JOB_TITLES } from "@/lib/job-titles";
import { DEPARTMENTS } from "@/lib/departments";
import CustomSelect from "@/components/ui/CustomSelect";
import KekaImportModal from "@/components/hr/KekaImportModal";
import type { KekaRow, KekaFormPatch } from "@/lib/keka-import";
import { Upload as UploadIcon } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// LocalStorage key for the draft. Bump the suffix if the Form shape changes
// incompatibly — otherwise a stale draft can crash the next load.
// ─────────────────────────────────────────────────────────────────────────────
const DRAFT_KEY = "nb.hr.onboard.draft.v1";

function fmtRel(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 5_000)      return "just now";
  if (diff < 60_000)     return `${Math.floor(diff / 1_000)}s ago`;
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme tokens — match the rest of the HR module.
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  shell:   "bg-[#f1f5f9] dark:bg-[#0b1220]",
  card:    "bg-white dark:bg-[#001529] border border-slate-200 dark:border-white/[0.06]",
  input:   "w-full h-9 px-3 bg-white dark:bg-[#0a1526] border border-slate-200 dark:border-white/[0.08] rounded-lg text-[13px] text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:border-[#008CFF]/60",
  label:   "text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider",
  section: "text-[14px] font-semibold text-slate-800 dark:text-white",
  t1:      "text-slate-800 dark:text-white",
  t2:      "text-slate-600 dark:text-slate-300",
  t3:      "text-slate-400 dark:text-slate-500",
};

// ─────────────────────────────────────────────────────────────────────────────
// Form state shape — one place, flat, easy to scan.
// ─────────────────────────────────────────────────────────────────────────────
type Form = {
  // Step 1 — Basic
  workCountry:     string;
  firstName:       string;
  middleName:      string;
  lastName:        string;
  displayName:     string;
  gender:          string;
  dateOfBirth:     string;
  nationality:     string;
  numberSeries:    string;
  employeeNumber:  string;
  workEmail:       string;
  mobileCountry:   string;
  mobileNumber:    string;

  // Step 2 — Job
  joiningDate:       string;
  jobTitle:          string;
  secondaryJobTitle: string;
  timeType:          string;
  legalEntity:       string;
  businessUnit:      string;
  department:        string;
  location:          string;
  workerType:        string;
  reportingManagerId: string;
  dottedLineManagerId: string;
  probationPolicy:   string;
  noticePeriodDays:  string;
  jobLocation:       string;
  internshipEndDate: string;

  // Step 3 — Work
  inviteToLogin:    boolean;
  enableOnboarding: boolean;
  leavePlan:        string;
  holidayList:      string;
  attendanceTracking: boolean;
  shiftId:          string;
  weeklyOff:        string;
  attendanceNumber: string;
  timeTrackingPolicy: string;
  penalizationPolicy: string;
  orgLevel:         string;
  role:             string;

  // Step 4 — Compensation (fields visible, not persisted to DB)
  salaryType:    string;   // "Regular Employee" | "Intern" — gates which fields show
  payGroup:      string;
  annualSalary:  string;
  basicPay:      string;   // Intern-only stipend / monthly basic
  bonusIncluded: boolean;
  pfEligible:    boolean;
  salaryStructure: string;
  taxRegime:     string;
};

const EMPTY: Form = {
  workCountry: "India", firstName: "", middleName: "", lastName: "",
  displayName: "", gender: "male", dateOfBirth: "", nationality: "India",
  numberSeries: "NB Media series", employeeNumber: "", workEmail: "",
  mobileCountry: "+91", mobileNumber: "",
  joiningDate: new Date().toISOString().slice(0, 10),
  jobTitle: "", secondaryJobTitle: "", timeType: "Full Time",
  legalEntity: "NB Media Productions", businessUnit: "", department: "",
  location: "Mohali", workerType: "Regular Employee",
  reportingManagerId: "", dottedLineManagerId: "",
  probationPolicy: "Regular Employees", noticePeriodDays: "30",
  jobLocation: "Mohali", internshipEndDate: "",
  inviteToLogin: true, enableOnboarding: true,
  leavePlan: "Regular Leave Plan", holidayList: "Default Holiday List",
  attendanceTracking: true, shiftId: "", weeklyOff: "Standard Weekly Off",
  attendanceNumber: "", timeTrackingPolicy: "On-Site Capture",
  penalizationPolicy: "Default",
  orgLevel: "member", role: "member",
  salaryType: "Regular Employee",
  payGroup: "NB Media", annualSalary: "",
  basicPay: "",
  bonusIncluded: false, pfEligible: false,
  salaryStructure: "Range Based", taxRegime: "New Regime (Section 115BAC)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export default function OnboardEmployeePage() {
  const router = useRouter();
  const [step, setStep]       = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm]       = useState<Form>(EMPTY);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");

  // Keka import state — modal visibility + a small banner telling HR
  // which row was just pulled in. The set of HRM IDs already onboarded
  // in this session keeps the modal from offering "Pre-fill" twice for
  // the same employee after a save.
  const [importOpen, setImportOpen] = useState(false);
  const [importedFrom, setImportedFrom] = useState<{ hrm: string; name: string } | null>(null);
  const [importDoneIds, setImportDoneIds] = useState<Set<string>>(() => new Set());

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  const { data: opts, mutate: refreshOpts } = useSWR("/api/hr/onboard/options", fetcher);
  const shifts    = opts?.shifts    ?? [];
  const leaveTypes = opts?.leaveTypes ?? [];
  const managers  = opts?.managers  ?? [];
  const allUsers: Array<{ id: number; name: string }> = opts?.allUsers ?? [];

  // Union of the server-side existing employee IDs and any IDs created
  // in this session — what the modal uses to grey out "already
  // onboarded" rows.
  const mergedOnboardedIds = useMemo(() => {
    const s = new Set<string>(importDoneIds);
    for (const id of (opts?.existingEmployeeIds ?? [])) s.add(id);
    return s;
  }, [importDoneIds, opts?.existingEmployeeIds]);

  // Auto-pick the regular 9 am – 6 pm shift once the shifts list loads.
  // HR can still change the selection manually; we only set it when the
  // form has no shift chosen yet, so we don't clobber an explicit pick.
  useEffect(() => {
    if (form.shiftId) return;
    if (!Array.isArray(shifts) || shifts.length === 0) return;
    const regular = shifts.find(
      (s: any) => s.startTime === "09:00" && s.endTime === "18:00",
    );
    if (regular) setForm((f) => ({ ...f, shiftId: String(regular.id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shifts.length]);

  // Auto-keep display name in sync unless the user edits it themselves.
  const [displayTouched, setDisplayTouched] = useState(false);
  useEffect(() => {
    if (displayTouched) return;
    const dn = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ").trim();
    if (dn !== form.displayName) setForm(f => ({ ...f, displayName: dn }));
  }, [form.firstName, form.middleName, form.lastName, displayTouched]);

  // Auto-fill the Attendance Number with the employee-number prefix (e.g.
  // "HRM" for HRM47). HR can still override it manually — once they type,
  // we stop overwriting.
  const [attendanceTouched, setAttendanceTouched] = useState(false);

  // Handle a row pick from the Keka import modal. Spreads the mapped
  // patch onto the form, marks displayName as touched (so the
  // first/middle/last useEffect doesn't immediately overwrite it), and
  // remembers the HRM ID so the modal won't re-offer the same row.
  const handleImportPick = (row: KekaRow, patch: KekaFormPatch) => {
    setForm((f) => ({
      ...f,
      firstName:           patch.firstName,
      middleName:          patch.middleName,
      lastName:            patch.lastName,
      displayName:         patch.displayName,
      workEmail:           patch.workEmail,
      gender:              patch.gender,
      dateOfBirth:         patch.dateOfBirth,
      mobileCountry:       patch.mobileCountry,
      mobileNumber:        patch.mobileNumber,
      employeeNumber:      patch.employeeNumber,
      joiningDate:         patch.joiningDate,
      jobTitle:            patch.jobTitle,
      department:          patch.department,
      workerType:          patch.workerType,
      timeType:            patch.timeType,
      location:            patch.location,
      jobLocation:         patch.jobLocation,
      noticePeriodDays:    patch.noticePeriodDays,
      internshipEndDate:   patch.internshipEndDate,
      leavePlan:           patch.leavePlan,
      reportingManagerId:  patch.reportingManagerId,
      // Salary tab is left untouched on purpose — HR enters it.
    }));
    setDisplayTouched(true);
    setAttendanceTouched(false);  // attendance auto-derive will re-fire from the new HRM id
    setImportedFrom({ hrm: row.employeeNumber, name: row.displayName });
    setStep(1);                   // always start the review at the first step
  };

  // ── Existing-user lookup by Work Email ────────────────────────────
  // Type a name or email — the dropdown suggests matching User rows so
  // HR can link to a Google-OAuth user instead of duplicating them.
  // Picking auto-fills first / last / display name.
  type LookupBanner =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "match-fresh"; name: string }
    | { kind: "match-onboarded"; name: string; employeeId: string }
    | { kind: "none" };
  const [lookup, setLookup] = useState<LookupBanner>({ kind: "idle" });
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Pull the active EmployeeNumberSeries so the form can show the
  // next-allocatable employee number as a hint ("Next: HRM47").
  const { data: numberSeries } = useSWR<any[]>("/api/hr/number-series", fetcher);
  const activeSeries = (Array.isArray(numberSeries) ? numberSeries : []).find((s: any) => s.isActive) ?? (Array.isArray(numberSeries) ? numberSeries[0] : null);
  const nextEmployeeId = activeSeries
    ? `${activeSeries.prefix}${activeSeries.nextNumber}`
    : "";
  // Prefix from whichever ID is in play: a manually-typed employeeNumber
  // wins (lets HR pick a different series mid-form), otherwise fall back
  // to the active series. Strip trailing digits to get just "HRM" out of
  // "HRM47" or whatever HR typed.
  const employeeIdPrefix = ((form.employeeNumber || nextEmployeeId).match(/^[A-Za-z]+/)?.[0]) ?? "";
  useEffect(() => {
    if (attendanceTouched) return;
    if (employeeIdPrefix && employeeIdPrefix !== form.attendanceNumber) {
      setForm(f => ({ ...f, attendanceNumber: employeeIdPrefix }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeIdPrefix, attendanceTouched]);

  useEffect(() => {
    const q = form.workEmail.trim().toLowerCase();
    if (q.length < 2) {
      setSuggestions([]);
      setLookup({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setLookup({ kind: "loading" });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hr/employees?search=${encodeURIComponent(q)}`);
        if (!res.ok) {
          if (!cancelled) { setSuggestions([]); setLookup({ kind: "none" }); }
          return;
        }
        if (cancelled) return;
        const rows: any[] = await res.json();
        setSuggestions(rows.slice(0, 6));
        const exact = rows.find((u) => String(u.email ?? "").toLowerCase() === q);
        if (!exact) { setLookup({ kind: "none" }); return; }
        const fullName = String(exact.name ?? "").trim();
        if (exact.employeeProfile) {
          setLookup({
            kind: "match-onboarded",
            name: fullName,
            employeeId: exact.employeeProfile.employeeId ?? "—",
          });
          return;
        }
        const firstSpace = fullName.indexOf(" ");
        const fName = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
        const lName = firstSpace === -1 ? ""       : fullName.slice(firstSpace + 1);
        setForm((f) => ({
          ...f,
          firstName:   f.firstName  || fName,
          lastName:    f.lastName   || lName,
          displayName: displayTouched ? f.displayName : (fullName || f.displayName),
        }));
        setLookup({ kind: "match-fresh", name: fullName });
      } catch {
        if (!cancelled) setLookup({ kind: "idle" });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.workEmail, displayTouched]);

  const pickSuggestion = (u: any) => {
    const email = String(u.email ?? "").toLowerCase();
    const fullName = String(u.name ?? "").trim();
    const firstSpace = fullName.indexOf(" ");
    const fName = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
    const lName = firstSpace === -1 ? ""       : fullName.slice(firstSpace + 1);
    setForm((f) => ({
      ...f,
      workEmail:   email,
      firstName:   fName || f.firstName,
      lastName:    lName || f.lastName,
      displayName: displayTouched ? f.displayName : (fullName || f.displayName),
    }));
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // ── Draft autosave ──────────────────────────────────────────────────
  // Persists the entire wizard state to localStorage so users can reload
  // the page, close the tab, or come back days later and continue where
  // they left off. Debounced 500ms so we don't hammer storage on every
  // keystroke. Cleared on successful submit + on the Discard button.
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const [draftSavedAt,    setDraftSavedAt]    = useState<number | null>(null);
  const [draftLoaded,     setDraftLoaded]     = useState(false);

  // Restore on mount (runs once — client-only to avoid hydration issues).
  useEffect(() => {
    if (typeof window === "undefined") { setDraftLoaded(true); return; }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.form)  setForm({ ...EMPTY, ...parsed.form });
        if (parsed?.step && parsed.step >= 1 && parsed.step <= 4) {
          setStep(parsed.step as 1 | 2 | 3 | 4);
        }
        if (parsed?.displayTouched) setDisplayTouched(true);
        if (parsed?.savedAt) {
          setDraftRestoredAt(parsed.savedAt);
          setDraftSavedAt(parsed.savedAt);
        }
      }
    } catch { /* malformed draft — ignore and start fresh */ }
    setDraftLoaded(true);
  }, []);

  // Save on any meaningful change, debounced. Only starts AFTER the initial
  // restore completes so the first "write" isn't the empty default form
  // overwriting a real draft that's about to be loaded.
  useEffect(() => {
    if (!draftLoaded) return;
    if (typeof window === "undefined") return;
    const t = setTimeout(() => {
      try {
        const savedAt = Date.now();
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ form, step, displayTouched, savedAt })
        );
        setDraftSavedAt(savedAt);
      } catch { /* storage full / private mode — silent */ }
    }, 500);
    return () => clearTimeout(t);
  }, [form, step, displayTouched, draftLoaded]);

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setForm(EMPTY);
    setStep(1);
    setDisplayTouched(false);
    setDraftRestoredAt(null);
    setDraftSavedAt(null);
  };

  // Tick every 20s so the relative "Draft saved Xm ago" label refreshes
  // while the user is still on the page.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  // ── Validation per step ─────────────────────────────────────────────
  const stepValid = useMemo(() => {
    if (step === 1) return !!(form.firstName && form.lastName && form.workEmail);
    if (step === 2) return !!(form.joiningDate && form.jobTitle);
    return true;
  }, [step, form]);

  // ── Submit ──────────────────────────────────────────────────────────
  const submit = async () => {
    setError(""); setSuccess(""); setSaving(true);
    try {
      const payload: any = {
        name:  [form.firstName, form.middleName, form.lastName].filter(Boolean).join(" ").trim(),
        email: form.workEmail,
        role:  form.role,
        orgLevel: form.orgLevel,
        managerId: form.reportingManagerId ? Number(form.reportingManagerId) : undefined,
        inlineManagerId: form.dottedLineManagerId ? Number(form.dottedLineManagerId) : undefined,
        inviteToLogin:    form.inviteToLogin,
        enableOnboarding: form.enableOnboarding,
        profile: {
          employeeId: form.employeeNumber || undefined,
          designation: form.jobTitle || undefined,
          department:  form.department || undefined,
          businessUnit: form.businessUnit || undefined,
          employmentType:
            form.workerType === "Intern"     ? "intern"
            : form.timeType === "Part Time"  ? "parttime"
            : "fulltime",
          workLocation: form.location?.toLowerCase().includes("remote") ? "remote" : "office",
          joiningDate:  form.joiningDate || undefined,
          phone:        form.mobileNumber ? `${form.mobileCountry} ${form.mobileNumber}` : undefined,
          dateOfBirth:  form.dateOfBirth || undefined,
          gender:       form.gender || undefined,
          noticePeriodDays: Number(form.noticePeriodDays) || 30,
        },
        shiftId: form.shiftId ? Number(form.shiftId) : undefined,
        // New hires start at zero across the board. Sick Leave accrues
        // 1 day / month from then on (handled by the leave-accrual helper);
        // other types stay at 0 unless HR adjusts them in the matrix.
        leaveBalances: leaveTypes.map((lt: any) => ({ leaveTypeId: lt.id, totalDays: 0 })),
        // ── Compensation: persist to SalaryStructure ──
        // For interns we send only the monthly basic; the API derives ctc =
        // basic × 12 and zeroes out HRA / PF / etc. For regular employees
        // we send the annual CTC and the API runs the full breakup.
        compensation: form.salaryType === "Intern"
          ? {
              salaryType:      "intern",
              monthlyBasic:    Number(form.basicPay) || 0,
              effectiveFrom:   form.joiningDate || undefined,
            }
          : {
              salaryType:      "regular",
              payGroup:        form.payGroup,
              annualCtc:       Number(form.annualSalary) || 0,
              bonusIncluded:   form.bonusIncluded,
              pfEligible:      form.pfEligible,
              taxRegime:       form.taxRegime,
              structureType:   form.salaryStructure,
              effectiveFrom:   form.joiningDate || undefined,
            },
      };

      const res  = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to onboard");

      setSuccess(
        data.isUpdate
          ? `${data.name}'s existing account was linked and onboarding details saved.`
          : `${data.name} onboarded successfully.`
      );
      // Mark this HRM ID as done so the import modal dims it on the
      // next file-pick. State is intentionally session-only — a fresh
      // page load resets it, matching how the draft is wiped below.
      if (form.employeeNumber) {
        setImportDoneIds((s) => new Set(s).add(form.employeeNumber));
      }
      // Wipe the draft so the next visit starts clean.
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      // Bounce back to HR Admin so HR can either pick the next employee
      // from the same Keka import or jump elsewhere in the dashboard.
      setTimeout(() => router.push("/dashboard/hr/admin"), 1400);
    } catch (e: any) {
      setError(e?.message || "Failed to onboard");
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  const steps = [
    { n: 1, label: "Basic Details",   Icon: UserIcon },
    { n: 2, label: "Job Details",     Icon: Briefcase },
    { n: 3, label: "Work Details",    Icon: SettingsIcon },
    { n: 4, label: "Compensation",    Icon: IndianRupee },
  ] as const;

  return (
    <div className={`min-h-screen ${C.shell}`}>
      {/* ── Header with stepper ── */}
      <div className={`${C.card} border-b px-6 py-4 rounded-none`}>
        <div className="flex items-center justify-between">
          <div className="flex items-start gap-4">
            <div>
              <h1 className={`text-[17px] font-semibold ${C.t1}`}>Add Employee Wizard</h1>
              <p className={`text-[12px] ${C.t3} mt-0.5`}>
                Onboard a new employee and optionally invite them to ClickUp
              </p>
            </div>
            {/* Draft status — shows "restored" on first load, then flips to
                "saved" as the user makes edits. */}
            {draftSavedAt && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {draftRestoredAt && draftRestoredAt === draftSavedAt
                    ? `Draft restored · ${fmtRel(draftRestoredAt)}`
                    : `Draft saved · ${fmtRel(draftSavedAt)}`}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Discard the saved draft and start over?")) clearDraft();
                  }}
                  className="text-[11px] text-slate-500 hover:text-red-500 underline-offset-2 hover:underline"
                >
                  Discard
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard/hr/people")}
              className="h-9 px-4 text-[13px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/5"
            >Cancel</button>
            {step > 1 && (
              <button
                onClick={() => setStep(s => (s - 1) as any)}
                className="h-9 px-5 text-[13px] font-semibold text-[#008CFF] border border-[#008CFF]/40 rounded-lg hover:bg-[#008CFF]/5"
              >Back</button>
            )}
            {step < 4 ? (
              <button
                onClick={() => stepValid && setStep(s => (s + 1) as any)}
                disabled={!stepValid}
                className="h-9 px-6 bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold"
              >Continue</button>
            ) : (
              <button
                onClick={submit}
                disabled={saving}
                className="h-9 px-6 bg-[#008CFF] hover:bg-[#0070cc] disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold"
              >{saving ? "Saving..." : "Finish"}</button>
            )}
          </div>
        </div>

        {/* Stepper row */}
        <div className="flex items-center gap-2 mt-5 justify-center">
          {steps.map((s, i) => {
            const done    = step > s.n;
            const current = step === s.n;
            return (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                  done    ? "bg-emerald-500 text-white"
                  : current ? "bg-[#008CFF] text-white"
                            : "bg-slate-200 dark:bg-white/10 text-slate-500"
                }`}>{done ? <Check size={13} /> : s.n}</div>
                <span className={`text-[11px] font-bold tracking-widest uppercase ${
                  current ? "text-[#008CFF]" : "text-slate-500 dark:text-slate-400"
                }`}>{s.label}</span>
                {i < steps.length - 1 && (
                  <div className={`w-10 h-px ${done ? "bg-emerald-400" : "bg-slate-300 dark:bg-white/10"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Banners ── */}
      {error && (
        <div className="px-6 pt-4">
          <div className="flex items-start gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-500 text-[12.5px]">
            <X className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        </div>
      )}
      {success && (
        <div className="px-6 pt-4">
          <div className="flex items-start gap-2 px-4 py-2.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-[12.5px]">
            <Check className="w-4 h-4 shrink-0 mt-0.5" /> {success}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="p-6 max-w-5xl mx-auto">
        {/* Import-from-Keka entry point. Sits above the form so HR sees
            it before they start typing. The "Imported …" pill below
            confirms which row was just pulled in. */}
        {step === 1 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#008CFF]/10 text-[#008CFF]">
                <UploadIcon size={16} />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-slate-800 dark:text-white">Import from Keka</p>
                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Upload a Keka CSV / Excel export once — pre-fill steps 1, 2, 3 for each employee in seconds.
                </p>
                {importedFrom && (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Imported {importedFrom.hrm} · {importedFrom.name}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-[#008CFF]/30 bg-[#008CFF]/5 px-3.5 py-2 text-[12.5px] font-semibold text-[#008CFF] transition-colors hover:bg-[#008CFF]/10 hover:border-[#008CFF]/50"
            >
              <UploadIcon size={13} />
              {importedFrom ? "Pick another row" : "Upload & pick row"}
            </button>
          </div>
        )}

        {step === 1 && (
          <StepCard title="Employee Details">
            <Grid cols={1}>
              <Field label="Work Country">
                <CustomSelect listKey="workCountry" defaults={["India", "USA", "UK", "UAE", "Singapore"]}
                  value={form.workCountry} onChange={v => set("workCountry", v)} />
              </Field>
            </Grid>
            <Grid>
              <Field label="First Name" required>
                <Input v={form.firstName} set={v => set("firstName", v)} placeholder="Write first name" />
              </Field>
              <Field label="Middle Name">
                <Input v={form.middleName} set={v => set("middleName", v)} placeholder="Write middle name (optional)" />
              </Field>
              <Field label="Last Name" required>
                <Input v={form.lastName} set={v => set("lastName", v)} placeholder="Write last name" />
              </Field>
              <Field label="Display Name" required>
                <Input v={form.displayName} set={v => { set("displayName", v); setDisplayTouched(true); }} />
              </Field>
              <Field label="Gender" required>
                <CustomSelect listKey="gender" defaults={["male", "female", "other"]}
                  value={form.gender} onChange={v => set("gender", v)} required />
              </Field>
              <Field label="Date of Birth" required>
                <DatePicker value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} />
              </Field>
              <Field label="Nationality">
                <CustomSelect listKey="nationality" defaults={["India", "USA", "UK", "Other"]}
                  value={form.nationality} onChange={v => set("nationality", v)} />
              </Field>
              <Field label="Number Series">
                <Select v={form.numberSeries} set={v => set("numberSeries", v)} opts={["NB Media series"]} />
              </Field>
              <Field
                label="Employee Number"
                hint={
                  nextEmployeeId
                    ? `Auto-generates as ${nextEmployeeId} if left empty`
                    : "Auto-generated if empty (e.g. HRM47)"
                }
              >
                <Input
                  v={form.employeeNumber}
                  set={(v) => set("employeeNumber", v)}
                  placeholder={nextEmployeeId || "e.g. HRM47"}
                />
              </Field>
            </Grid>

            <SectionTitle>Contact Details</SectionTitle>
            <Grid>
              <Field label="Work Email" required>
                <div className="relative">
                  <Input
                    type="email"
                    v={form.workEmail}
                    set={(v) => { set("workEmail", v); setShowSuggestions(true); }}
                    placeholder="Type a name or email…"
                  />
                  {showSuggestions && suggestions.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-white/[0.08] dark:bg-[#0a1526]">
                      {suggestions.map((u: any) => {
                        const initials = String(u.name ?? "?")
                          .split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase();
                        const onboarded = !!u.employeeProfile;
                        return (
                          <li key={u.id}>
                            <button
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); pickSuggestion(u); }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#008CFF]/[0.06]"
                            >
                              {u.profilePictureUrl ? (
                                <img src={u.profilePictureUrl} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#008CFF] text-[10px] font-bold text-white">{initials}</span>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-white">{u.name || u.email}</p>
                                <p className="truncate text-[11px] text-slate-500">{u.email}</p>
                              </div>
                              {onboarded && (
                                <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-100">Onboarded</span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {lookup.kind === "loading" && suggestions.length === 0 && (
                  <p className="mt-1.5 text-[11px] text-slate-400">Searching…</p>
                )}
                {lookup.kind === "match-fresh" && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Linking to existing user · <strong>{lookup.name}</strong>
                  </p>
                )}
                {lookup.kind === "match-onboarded" && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Already onboarded as <strong>{lookup.employeeId}</strong> ({lookup.name})
                  </p>
                )}
              </Field>
              <Field label="Mobile Number">
                <div className="flex gap-2">
                  <div className="w-20">
                    <Select v={form.mobileCountry} set={v => set("mobileCountry", v)} opts={["+91", "+1", "+44", "+971"]} />
                  </div>
                  <Input v={form.mobileNumber} set={v => set("mobileNumber", v)} placeholder="Write mobile number" />
                </div>
              </Field>
            </Grid>
          </StepCard>
        )}

        {step === 2 && (
          <StepCard title="Employment Details">
            <Grid>
              <Field label="Joining Date" required>
                <DatePicker value={form.joiningDate} onChange={v => set("joiningDate", v)} futureYears={2} />
              </Field>
              <Field label="Job Title" required>
                {/* CustomSelect: keeps the canonical JOB_TITLES list as
                    non-deletable defaults, plus surfaces "+ Add custom"
                    so HR can extend the list without a code deploy. */}
                <CustomSelect
                  listKey="jobTitle"
                  defaults={JOB_TITLES}
                  value={form.jobTitle}
                  onChange={v => set("jobTitle", v)}
                  placeholder="Select job title"
                  required
                />
              </Field>
              <Field label="Secondary Job Title">
                <Select
                  v={form.secondaryJobTitle}
                  set={v => set("secondaryJobTitle", v)}
                  opts={[{ value: "", label: "— None —" }, ...JOB_TITLES]}
                />
              </Field>
              <Field label="Time Type" required>
                <CustomSelect listKey="timeType" defaults={["Full Time", "Part Time"]}
                  value={form.timeType} onChange={v => set("timeType", v)} required />
              </Field>
            </Grid>

            <SectionTitle>Organisational Details</SectionTitle>
            <Grid>
              <Field label="Legal Entity" required>
                <Input v={form.legalEntity} set={v => set("legalEntity", v)} />
              </Field>
              <Field label="Business Unit">
                <CustomSelect listKey="businessUnit" defaults={["NB Media"]}
                  value={form.businessUnit} onChange={v => set("businessUnit", v)} />
              </Field>
              <Field label="Department" required>
                {/* CustomSelect: defaults are the seven core departments
                    (non-deletable); HR can append more via "+ Add
                    custom". Persisted in OptionList so they show up for
                    everyone, not just one browser. */}
                <CustomSelect
                  listKey="department"
                  defaults={DEPARTMENTS}
                  value={form.department}
                  onChange={v => set("department", v)}
                  placeholder="Select a department"
                  required
                />
              </Field>
              <Field label="Location" required>
                <CustomSelect listKey="location" defaults={["Mohali", "Remote", "Hybrid"]}
                  value={form.location} onChange={v => set("location", v)} required />
              </Field>
              <Field label="Worker Type" required>
                <Select v={form.workerType} set={v => set("workerType", v)} opts={["Regular Employee", "Intern"]} />
              </Field>
              <Field label="Reporting Manager" required>
                <Select
                  v={form.reportingManagerId}
                  set={v => set("reportingManagerId", v)}
                  opts={[{ value: "", label: "— Select —" }, ...managers.map((m: any) => ({ value: String(m.id), label: `${m.name} · ${m.orgLevel}` }))]}
                />
              </Field>
              <Field label="Inline Manager">
                <Select
                  v={form.dottedLineManagerId}
                  set={v => set("dottedLineManagerId", v)}
                  opts={[{ value: "", label: "— None —" }, ...managers.map((m: any) => ({ value: String(m.id), label: m.name }))]}
                />
              </Field>
            </Grid>

            <SectionTitle>Employment Terms</SectionTitle>
            <Grid>
              <Field label="Probation Policy" required>
                <CustomSelect
                  listKey="probationPolicy"
                  defaults={["Interns (3 Months)", "Interns (6 Months)", "Interns (12 Months)", "Regular Employees"]}
                  value={form.probationPolicy} onChange={v => set("probationPolicy", v)}
                  required
                />
              </Field>
              <Field label="Notice Period (days)" required>
                <Input type="number" v={form.noticePeriodDays} set={v => set("noticePeriodDays", v)} placeholder="30" />
              </Field>
              <Field label="Job Location" required>
                <CustomSelect listKey="jobLocation" defaults={["Mohali", "Delhi", "Mumbai", "Remote"]}
                  value={form.jobLocation} onChange={v => set("jobLocation", v)} required />
              </Field>
              {form.workerType === "Intern" && (
                <Field label="Internship End Date">
                  <DatePicker value={form.internshipEndDate} onChange={v => set("internshipEndDate", v)} futureYears={2} />
                </Field>
              )}
            </Grid>
          </StepCard>
        )}

        {step === 3 && (
          <StepCard title="Onboarding Settings">
            <div className="space-y-3">
              <Toggle
                checked={form.inviteToLogin}
                onChange={v => set("inviteToLogin", v)}
                label="Invite employee to login"
                hint="Sends a welcome email with a link to sign in via Google using this work email — no password is set, the dashboard is Google-OAuth only."
              />
              <Toggle
                checked={form.enableOnboarding}
                onChange={v => set("enableOnboarding", v)}
                label="Enable onboarding flow"
                hint="On their first sign-in we'll redirect them to a short wizard to confirm contact details (mobile, address, emergency contact) before they see the dashboard."
              />
            </div>

            <SectionTitle>Access</SectionTitle>
            <Grid>
              <Field label="Org Level">
                <Select v={form.orgLevel} set={v => set("orgLevel", v)} opts={[
                  "member", "production_team", "sub_lead", "lead",
                  "manager", "hr_manager", "hod", "special_access", "ceo",
                ]} />
              </Field>
              <Field label="Role">
                <Select v={form.role} set={v => set("role", v)} opts={["member", "admin"]} />
              </Field>
            </Grid>

            <SectionTitle>Leave Settings</SectionTitle>
            <Grid>
              <Field label="Leave Plan">
                <CustomSelect listKey="leavePlan" defaults={["Regular Leave Plan", "Intern Leave Plan"]}
                  value={form.leavePlan} onChange={v => set("leavePlan", v)} />
              </Field>
              <Field label="Holiday List">
                <CustomSelect listKey="holidayList" defaults={["Default Holiday List"]}
                  value={form.holidayList} onChange={v => set("holidayList", v)} />
              </Field>
            </Grid>
            {leaveTypes.length > 0 && (
              <p className={`text-[11px] ${C.t3} mt-1`}>
                {leaveTypes.length} leave types will be credited: {leaveTypes.map((l: any) => `${l.code} (${l.daysPerYear}d)`).join(", ")}
              </p>
            )}

            <SectionTitle>Attendance Settings</SectionTitle>
            <Toggle
              checked={form.attendanceTracking}
              onChange={v => set("attendanceTracking", v)}
              label="Attendance Tracking"
              hint="Track daily clock-in/clock-out for this employee."
            />
            <Grid>
              <Field label="Shift" required>
                <Select
                  v={form.shiftId}
                  set={v => set("shiftId", v)}
                  opts={[{ value: "", label: "— Select —" }, ...shifts.map((s: any) => ({ value: String(s.id), label: `${s.name} (${s.startTime}–${s.endTime})` }))]}
                />
              </Field>
              <Field label="Weekly Off">
                <CustomSelect listKey="weeklyOff" defaults={["Standard Weekly Off", "Saturday Off Alt"]}
                  value={form.weeklyOff} onChange={v => set("weeklyOff", v)} />
              </Field>
              <Field label="Attendance Number">
                <Input
                  v={form.attendanceNumber}
                  set={v => { setAttendanceTouched(true); set("attendanceNumber", v); }}
                  placeholder={employeeIdPrefix || "Auto-fills from employee number"}
                />
              </Field>
              <Field label="Time Tracking Policy">
                <CustomSelect listKey="timeTrackingPolicy" defaults={["On-Site Capture", "Remote Capture", "Hybrid"]}
                  value={form.timeTrackingPolicy} onChange={v => set("timeTrackingPolicy", v)} />
              </Field>
              <Field label="Penalization Policy">
                <CustomSelect listKey="penalizationPolicy" defaults={["Default", "Strict", "Lenient"]}
                  value={form.penalizationPolicy} onChange={v => set("penalizationPolicy", v)} />
              </Field>
            </Grid>
          </StepCard>
        )}

        {step === 4 && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-6">
            <StepCard title="Compensation">
              <Grid>
                <Field label="Salary Type" required>
                  <Select v={form.salaryType} set={v => set("salaryType", v)} opts={["Regular Employee", "Intern"]} />
                </Field>
              </Grid>

              {form.salaryType === "Intern" ? (
                // Interns are paid a flat monthly stipend — no PF, bonus,
                // tax regime, structure, etc. Keep the surface area tiny
                // on purpose so HR doesn't accidentally fill in fields
                // that don't apply to a stipend.
                <Grid>
                  <Field label="Monthly Stipend (INR / month)" required>
                    <Input type="number" v={form.basicPay} set={v => set("basicPay", v)} placeholder="Enter monthly stipend" />
                  </Field>
                </Grid>
              ) : (
                <>
                  <Grid>
                    <Field label="Pay Group">
                      <CustomSelect listKey="payGroup" defaults={["NB Media", "Contractor"]}
                        value={form.payGroup} onChange={v => set("payGroup", v)} />
                    </Field>
                    <Field label="Annual Salary (INR)">
                      <Input type="number" v={form.annualSalary} set={v => set("annualSalary", v)} placeholder="Enter annual salary" />
                    </Field>
                  </Grid>

                  <SectionTitle>Bonus Details</SectionTitle>
                  <label className={`flex items-center gap-2 text-[12.5px] ${C.t2}`}>
                    <input type="checkbox" checked={form.bonusIncluded} onChange={e => set("bonusIncluded", e.target.checked)} />
                    Bonus included in annual salary of INR {Number(form.annualSalary || 0).toLocaleString("en-IN")}
                  </label>
                  <button className="h-8 px-3 text-[12px] font-semibold text-[#008CFF] border border-[#008CFF]/40 rounded-lg hover:bg-[#008CFF]/5 w-fit">+ Add Bonus</button>

                  <SectionTitle>Payroll Settings</SectionTitle>
                  <label className={`flex items-center gap-2 text-[12.5px] ${C.t2}`}>
                    <input type="checkbox" checked={form.pfEligible} onChange={e => set("pfEligible", e.target.checked)} />
                    Provident fund (PF) eligible
                  </label>
                  <div className="px-3 py-2 bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-lg text-[11.5px]">
                    ESI is not applicable for the selected Pay Group
                  </div>

                  <Grid>
                    <Field label="Salary Structure Type">
                      <CustomSelect listKey="salaryStructure" defaults={["Range Based", "Fixed"]}
                        value={form.salaryStructure} onChange={v => set("salaryStructure", v)} />
                    </Field>
                    <Field label="Tax Regime">
                      <CustomSelect listKey="taxRegime" defaults={["New Regime (Section 115BAC)", "Old Regime"]}
                        value={form.taxRegime} onChange={v => set("taxRegime", v)} />
                    </Field>
                  </Grid>
                </>
              )}
              <p className={`text-[10.5px] ${C.t3} italic`}>
                Saved to the employee's salary structure on submit.
              </p>
            </StepCard>

            {/* Salary Breakup preview */}
            <div className={`${C.card} rounded-2xl p-5 h-fit`}>
              <p className={`text-[14px] font-semibold ${C.t1}`}>
                {form.salaryType === "Intern" ? "Stipend Summary" : "Salary Breakup"}
              </p>
              <p className={`text-[10.5px] ${C.t3} uppercase tracking-widest mt-3`}>Effective From</p>
              <p className={`text-[13px] ${C.t1} mt-0.5`}>{new Date(form.joiningDate || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>

              {form.salaryType === "Intern" ? (
                <div className="mt-5 pt-3 border-t border-slate-200 dark:border-white/[0.06]">
                  <div className="flex items-center justify-between text-[12.5px] font-semibold">
                    <span className={C.t1}>Monthly Stipend</span>
                    <span className={`${C.t1} font-mono`}>
                      {Number(form.basicPay || 0).toLocaleString("en-IN")} / mo
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11.5px]">
                    <span className={C.t2}>Annualised</span>
                    <span className={`${C.t2} font-mono`}>
                      {(Number(form.basicPay || 0) * 12).toLocaleString("en-IN")} / yr
                    </span>
                  </div>
                  <p className={`text-[10.5px] ${C.t3} mt-3 leading-relaxed`}>
                    Interns are paid a flat monthly stipend — no PF, ESI,
                    bonuses, or tax-regime selection.
                  </p>
                </div>
              ) : (
                <>
                  {/* Column headers — monthly first, annual second (matches the
                      policy table in the Keka screenshots). */}
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest mt-5 pb-1 border-b border-slate-200 dark:border-white/[0.06]">
                    <span className={C.t3}>Component</span>
                    <span className={C.t3}>Monthly / Annually</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {salaryBreakup(Number(form.annualSalary) || 0, form.pfEligible).map(([label, monthly, annual]) => (
                      <div key={label} className="flex items-center justify-between text-[12px]">
                        <span className={C.t2}>{label}</span>
                        <span className={`${C.t1} font-mono`}>
                          {monthly.toLocaleString("en-IN")} / {annual.toLocaleString("en-IN")}
                        </span>
                      </div>
                    ))}
                    <div className="pt-2 mt-2 border-t border-slate-200 dark:border-white/[0.08] flex items-center justify-between text-[12.5px] font-semibold">
                      <span className={C.t1}>CTC</span>
                      <span className={`${C.t1} font-mono`}>
                        {Math.round(Number(form.annualSalary || 0) / 12).toLocaleString("en-IN")} / {Number(form.annualSalary || 0).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                  <p className={`text-[10.5px] ${C.t3} mt-3 leading-relaxed`}>
                    {form.pfEligible
                      ? "PF is 12% of Basic, capped at ₹1,800/month (₹15,000 basic ceiling)."
                      : "PF is disabled — enable the toggle above to include it."}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <KekaImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onPick={handleImportPick}
        managers={managers}
        allUsers={allUsers}
        onboardedIds={mergedOnboardedIds}
        onBulkComplete={(createdHrmIds) => {
          // Add bulk-created IDs to the session set so re-opening the
          // modal greys them immediately, then refresh the canonical
          // list from the server (picks up the freshly-created rows).
          setImportDoneIds((s) => {
            const next = new Set(s);
            createdHrmIds.forEach((id) => next.add(id));
            return next;
          });
          refreshOpts();
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny presentational helpers — keep the page file self-contained.
// ─────────────────────────────────────────────────────────────────────────────
function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${C.card} rounded-2xl p-6 space-y-5`}>
      <h2 className={C.section}>{title}</h2>
      {children}
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className={`${C.section} pt-3`}>{children}</h3>;
}
function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  const cls = cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2";
  return <div className={`grid ${cls} gap-4`}>{children}</div>;
}
function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={C.label}>{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className={`text-[10.5px] ${C.t3} mt-0.5`}>{hint}</p>}
    </div>
  );
}
function Input({ v, set, type = "text", placeholder }: {
  v: string;
  set: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return <input type={type} value={v} onChange={e => set(e.target.value)} placeholder={placeholder} className={C.input} />;
}

function Select({ v, set, opts }: { v: string; set: (v: string) => void; opts: (string | { value: string; label: string })[] }) {
  return (
    <select value={v} onChange={e => set(e.target.value)} className={C.input}>
      {opts.map(o => {
        const { value, label } = typeof o === "string" ? { value: o, label: o } : o;
        return <option key={value} value={value}>{label}</option>;
      })}
    </select>
  );
}
function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5 ${
          checked ? "bg-[#008CFF]" : "bg-slate-200 dark:bg-white/10"
        }`}
      >
        <span className={`block w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`} />
      </button>
      <div>
        <p className={`text-[13px] font-medium ${C.t1}`}>{label}</p>
        {hint && <p className={`text-[11px] ${C.t3} mt-0.5`}>{hint}</p>}
      </div>
    </label>
  );
}

// Salary breakdown — matches the NB Media policy:
//   Basic              50% of monthly CTC
//   HRA                20%
//   PF (if enabled)    min(Basic × 12%, ₹1,800/mo)   — statutory cap on ₹15k basic
//   Dearness Allowance 10%
//   Conveyance         7.5%
//   Medical Allowance  Flat ₹1,250/mo (₹15,000/yr)
//   Special Allowance  Remaining balance
// Returns [label, monthly, annual] tuples in display order.
function salaryBreakup(annual: number, pfEligible: boolean): [string, number, number][] {
  const monthly = annual / 12;
  const basic      = Math.round(monthly * 0.50);
  const hra        = Math.round(monthly * 0.20);
  const da         = Math.round(monthly * 0.10);
  const conveyance = Math.round(monthly * 0.075);
  const medical    = 1250;
  const pf = pfEligible ? Math.min(Math.round(basic * 0.12), 1800) : 0;

  const consumed = basic + hra + da + conveyance + medical + pf;
  const special  = Math.max(0, Math.round(monthly) - consumed);

  const row = (l: string, m: number): [string, number, number] => [l, m, m * 12];

  const rows: [string, number, number][] = [row("Basic", basic), row("HRA", hra)];
  if (pfEligible) rows.push(row("PF", pf));
  rows.push(
    row("Dearness Allowance",  da),
    row("Conveyance Allowance", conveyance),
    row("Medical Allowance",    medical),
    row("Special Allowance",    special),
  );
  return rows;
}
