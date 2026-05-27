"use client";

// Salary Structure panel rendered on the user-profile page. Mirrors the
// onboarding wizard's "Compensation" step so HR admins can fill in or
// adjust a user's salary after onboarding (or for legacy users who were
// imported before the wizard existed).
//
// Visibility rules are enforced by the parent page: HR admin tier OR the
// profile owner can SEE this panel; only HR admin tier can SAVE.

import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  CheckCircle2, AlertCircle, IndianRupee, Save, Wallet, Info, Lock, Calendar,
  MoreVertical, Plus, X, Paperclip,
} from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";
import SelectField from "@/components/ui/SelectField";
import { DatePicker } from "@/components/ui/date-picker";
import { DateField } from "@/components/ui/date-field";

type Props = {
  userId: number;
  canEdit: boolean;
};

type ApiStructure = {
  id: number;
  userId: number;
  salaryType: string;
  payGroup: string | null;
  bonusIncluded: boolean;
  taxRegime: string | null;
  structureType: string | null;
  pfEligible: boolean;
  ctc: string;
  basic: string;
  hra: string;
  specialAllowance: string;
  pfEmployee: string;
  pfEmployer: string;
  esiEmployee: string;
  esiEmployer: string;
  tds: string;
  professionalTax: string;
  effectiveFrom: string;
};

type FormState = {
  salaryType: "Regular Employee" | "Intern";
  payGroup: string;
  annualSalary: string;       // regular: CTC; intern: 0 (we store stipend × 12 as basic)
  monthlyStipend: string;     // intern only
  bonusIncluded: boolean;
  pfEligible: boolean;
  structureType: string;      // "Range Based" | "Fixed"
  taxRegime: string;          // "New Regime (Section 115BAC)" | "Old Regime"
  effectiveFrom: string;      // YYYY-MM-DD
};

const EMPTY_FORM: FormState = {
  salaryType: "Regular Employee",
  payGroup: "NB Media",
  annualSalary: "",
  monthlyStipend: "",
  bonusIncluded: false,
  pfEligible: false,
  structureType: "Range Based",
  taxRegime: "New Regime (Section 115BAC)",
  effectiveFrom: new Date().toISOString().slice(0, 10),
};

// Map a saved API structure → form state (best-effort; same logic the
// onboarding wizard would use after re-loading a draft).
function apiToForm(s: ApiStructure | null): FormState {
  if (!s) return EMPTY_FORM;
  const isIntern = s.salaryType === "intern";
  return {
    salaryType: isIntern ? "Intern" : "Regular Employee",
    payGroup: s.payGroup || "NB Media",
    annualSalary: isIntern ? "" : String(parseFloat(s.ctc || "0") || ""),
    // For interns, the source-of-truth annual figure is `ctc`. Deriving
    // the form's monthly stipend off `ctc / 12` rather than off `basic`
    // means we don't care whether the underlying row is a legacy save
    // (basic stored as monthly) or a post-fix save (basic stored as
    // annual) — both have a correct `ctc` value, so both load right.
    monthlyStipend: isIntern ? String(Math.round((parseFloat(s.ctc || "0") || 0) / 12) || "") : "",
    bonusIncluded: !!s.bonusIncluded,
    pfEligible: !!s.pfEligible,
    structureType: s.structureType || "Range Based",
    taxRegime: s.taxRegime || "New Regime (Section 115BAC)",
    effectiveFrom: s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

// Fixed-amount components used by the regular-employee split.
// All annual figures so they match how the rest of the payroll engine
// stores numbers (payslip divides by 12 at generation time).
const MEDICAL_ALLOWANCE_ANNUAL  = 15000;   // ₹15,000 / yr = ₹1,250 / month
const PF_EMPLOYEE_ANNUAL_FIXED  = 21600;   // ₹21,600 / yr = ₹1,800 / month (12% × ₹15k cap)
const PF_EMPLOYER_ANNUAL_FIXED  = 21600;   // matched employer contribution (not part of CTC)

// Compute the per-component annual amounts for a regular employee given
// the entered annual CTC and the pfEligible flag. Returns `special < 0`
// when the CTC is too low to cover the fixed portions — onSave checks
// this and refuses to submit (per the "block / show error" UX choice).
//
// Split rule:
//   Basic   = 50%  of CTC
//   HRA     = 20%  of CTC
//   DA      = 10%  of CTC
//   Conv    =  7.5% of CTC
//   Medical = fixed ₹15,000 / year
//   PF (Emp) = fixed ₹21,600 / year when pfEligible
//   Special = CTC − (sum of the above)
function regularSplit(annualCtc: number, pfEligible: boolean) {
  const basic   = Math.round(annualCtc * 0.50);
  const hra     = Math.round(annualCtc * 0.20);
  const da      = Math.round(annualCtc * 0.10);
  const conv    = Math.round(annualCtc * 0.075);
  const medical = MEDICAL_ALLOWANCE_ANNUAL;
  const pfEmp   = pfEligible ? PF_EMPLOYEE_ANNUAL_FIXED : 0;
  const pfEmpr  = pfEligible ? PF_EMPLOYER_ANNUAL_FIXED : 0;
  const special = annualCtc - (basic + hra + da + conv + medical + pfEmp);
  return { basic, hra, da, conv, medical, pfEmp, pfEmpr, special };
}

// Form state → POST body for /api/hr/payroll/salary-structure. Mirrors
// the field mapping the onboarding submit handler does.
function formToApi(f: FormState, userId: number) {
  if (f.salaryType === "Intern") {
    const stipend = parseFloat(f.monthlyStipend || "0") || 0;
    return {
      userId,
      salaryType:    "intern",
      payGroup:      null,
      bonusIncluded: false,
      taxRegime:     null,
      structureType: null,
      pfEligible:    false,
      // Both `ctc` and `basic` are stored as ANNUAL figures here —
      // matching how regular employees' rows are saved (basic = annual
      // amount, divided by 12 only at display time). Older intern rows
      // stored `basic` as the monthly amount and the breakup display
      // misrendered them as ₹2,916/month; storing × 12 is the canonical
      // fix and keeps the data model uniform across salary types.
      ctc:           stipend * 12,
      basic:         stipend * 12,
      hra:           0,
      specialAllowance: 0,
      pfEmployee: 0, pfEmployer: 0,
      esiEmployee: 0, esiEmployer: 0,
      tds: 0, professionalTax: 0,
      effectiveFrom: f.effectiveFrom,
    };
  }
  // Regular employee — per the company's CTC split formula.
  const annual = parseFloat(f.annualSalary || "0") || 0;
  const s = regularSplit(annual, !!f.pfEligible);
  return {
    userId,
    salaryType:    "regular",
    payGroup:      f.payGroup || null,
    bonusIncluded: !!f.bonusIncluded,
    taxRegime:     f.taxRegime || null,
    structureType: f.structureType || null,
    pfEligible:    !!f.pfEligible,
    ctc:           annual,
    basic:               s.basic,
    hra:                 s.hra,
    dearnessAllowance:   s.da,
    conveyanceAllowance: s.conv,
    medicalAllowance:    s.medical,
    specialAllowance:    s.special,
    pfEmployee:  s.pfEmp,
    pfEmployer:  s.pfEmpr,
    esiEmployee: 0, esiEmployer: 0,
    tds: 0, professionalTax: 0,
    effectiveFrom: f.effectiveFrom,
  };
}

const cls = {
  field: "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 disabled:bg-slate-50 disabled:text-slate-500",
  label: "block text-[11.5px] font-semibold text-slate-600 mb-1",
};

export default function SalaryStructurePanel({ userId, canEdit }: Props) {
  const apiUrl = `/api/hr/payroll/salary-structure?userId=${userId}`;
  const { data, isLoading } = useSWR<ApiStructure | null>(apiUrl, fetcher);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // 3-dots menu + Add Bonus modal — admin-only.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showBonusModal, setShowBonusModal] = useState(false);
  // Close the dots menu on outside click / Escape so it behaves like the
  // rest of the dashboard's overflow menus.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  // Sync form once the data arrives. We don't re-sync on every data
  // change to avoid clobbering local edits — only when the underlying
  // record id changes (re-fetched from server).
  useEffect(() => {
    setForm(apiToForm(data ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSavedAt(null);
    if (form.salaryType === "Intern" && !form.monthlyStipend) {
      setError("Enter the monthly stipend.");
      return;
    }
    if (form.salaryType === "Regular Employee" && !form.annualSalary) {
      setError("Enter the annual salary.");
      return;
    }
    // Block-and-warn: when the CTC is too low for the fixed portions
    // (Medical ₹15k/yr + optional PF ₹21.6k/yr) the formula's Special
    // Allowance would go negative. Show the exact minimum so HR knows
    // what to bump to.
    if (form.salaryType === "Regular Employee") {
      const annual = parseFloat(form.annualSalary || "0") || 0;
      const split  = regularSplit(annual, !!form.pfEligible);
      if (split.special < 0) {
        const minAnnual = form.pfEligible
          ? Math.ceil((MEDICAL_ALLOWANCE_ANNUAL + PF_EMPLOYEE_ANNUAL_FIXED) / 0.125)
          : Math.ceil(MEDICAL_ALLOWANCE_ANNUAL / 0.125);
        const minMonthly = Math.ceil(minAnnual / 12);
        setError(
          `CTC is too low for the salary formula. ` +
          `With PF ${form.pfEligible ? "ON" : "OFF"} the minimum annual CTC is ` +
          `₹${minAnnual.toLocaleString("en-IN")} (≈ ₹${minMonthly.toLocaleString("en-IN")} / month).`
        );
        return;
      }
    }
    if (!form.effectiveFrom) {
      setError("Pick an effective-from date.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/payroll/salary-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToApi(form, userId)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      setSavedAt(Date.now());
      mutate(apiUrl);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      </section>
    );
  }

  const isIntern = form.salaryType === "Intern";

  // Pastel tint that drives the header accent — emerald for intern,
  // brand blue for regular. Keeps the card on-brand without dominating.
  const tint = isIntern ? "#059669" : "#3b82f6";
  const effectiveFromLabel = data && form.effectiveFrom
    ? new Date(form.effectiveFrom).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      {/* Top accent strip — fades to transparent so it reads as a refined
          tag rather than a hard line. */}
      <span
        aria-hidden
        className="block h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${tint}, ${tint}80 60%, transparent)` }}
      />

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 border-b border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1"
            style={{ background: `${tint}14`, color: tint, boxShadow: `inset 0 0 0 1px ${tint}33` }}
          >
            <Wallet size={18} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Salary structure</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {effectiveFromLabel
                ? <>Effective from <span className="font-medium text-slate-700">{effectiveFromLabel}</span></>
                : "No structure assigned yet."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {!canEdit && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-600">
              <Lock size={10} /> Read-only
            </span>
          )}
          {data && (
            <span
              className="inline-flex h-6 items-center rounded-full px-2.5 text-[10.5px] font-bold uppercase tracking-wider ring-1"
              style={{ background: `${tint}14`, color: tint, boxShadow: `inset 0 0 0 1px ${tint}33` }}
            >
              {isIntern ? "Intern" : "Regular"}
            </span>
          )}
          {/* 3-dots menu — admin-only "+ Add Bonus" entry. Hidden when
              the viewer can't edit (no point dangling an action they
              can't run). */}
          {canEdit && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Salary actions"
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <MoreVertical size={15} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setShowBonusModal(true); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                  >
                    <Plus size={13} className="text-[#3b82f6]" />
                    Add Bonus
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-5 px-6 py-5">
        {/* ── Top row: Salary Type + Effective From ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Salary Type</label>
            <SelectField
              value={form.salaryType}
              onChange={(v) => set("salaryType", v as FormState["salaryType"])}
              disabled={!canEdit}
              options={["Regular Employee", "Intern"]}
              className={cls.field}
            />
          </div>
          <div>
            <label className={cls.label}>Effective From</label>
            <DateField
              value={form.effectiveFrom}
              onChange={(v) => set("effectiveFrom", v)}
              disabled={!canEdit}
              className="w-full"
            />
          </div>
        </div>

        {isIntern ? (
          <>
            {/* ── Compensation section header ── */}
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Compensation</p>
              <label className={cls.label}>Monthly Stipend (INR / month)</label>
              <div className="relative">
                <IndianRupee className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="number"
                  value={form.monthlyStipend}
                  onChange={(e) => set("monthlyStipend", e.target.value)}
                  disabled={!canEdit}
                  placeholder="Enter monthly stipend"
                  className={`${cls.field} pl-8`}
                />
              </div>
              {form.monthlyStipend && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Annualised: <span className="font-mono font-semibold text-slate-700">
                    ₹{(Number(form.monthlyStipend || 0) * 12).toLocaleString("en-IN")}
                  </span>
                </p>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
              <Info size={14} className="mt-0.5 shrink-0 text-emerald-600" />
              <p className="text-[11.5px] leading-relaxed text-emerald-700">
                Interns are paid a flat monthly stipend — no PF, ESI, bonuses, or tax-regime selection.
              </p>
            </div>
          </>
        ) : (
          <>
            {/* ── Compensation section ── */}
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Compensation</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={cls.label}>Pay Group</label>
                  <CustomSelect
                    listKey="payGroup"
                    defaults={["NB Media", "Contractor"]}
                    value={form.payGroup}
                    onChange={(v) => set("payGroup", v)}
                    disabled={!canEdit}
                    readOnlyOptions={!canEdit}
                  />
                </div>
                <div>
                  <label className={cls.label}>Annual Salary (INR)</label>
                  <div className="relative">
                    <IndianRupee className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="number"
                      value={form.annualSalary}
                      onChange={(e) => set("annualSalary", e.target.value)}
                      disabled={!canEdit}
                      placeholder="Enter annual salary"
                      className={`${cls.field} pl-8`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* ── Bonus + Payroll Settings, side-by-side on wider screens ── */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Bonus</p>
                <label className="inline-flex items-start gap-2 text-[12.5px] leading-snug text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.bonusIncluded}
                    onChange={(e) => set("bonusIncluded", e.target.checked)}
                    disabled={!canEdit}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6]/30"
                  />
                  <span>
                    Bonus included in annual salary of{" "}
                    <span className="font-mono font-semibold text-slate-800">
                      ₹{Number(form.annualSalary || 0).toLocaleString("en-IN")}
                    </span>
                  </span>
                </label>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-3.5 py-3">
                <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Payroll settings</p>
                <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.pfEligible}
                    onChange={(e) => set("pfEligible", e.target.checked)}
                    disabled={!canEdit}
                    className="h-4 w-4 rounded border-slate-300 text-[#3b82f6] focus:ring-[#3b82f6]/30"
                  />
                  Provident fund (PF) eligible
                </label>
                <div className="mt-2 flex items-start gap-1.5 rounded-md bg-sky-50 px-2 py-1.5">
                  <Info size={11} className="mt-0.5 shrink-0 text-sky-600" />
                  <p className="text-[10.5px] leading-snug text-sky-700">
                    ESI is not applicable for the selected Pay Group.
                  </p>
                </div>
              </div>
            </div>

            {/* ── Structure + tax regime ── */}
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Tax & Structure</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={cls.label}>Salary Structure Type</label>
                  <CustomSelect
                    listKey="salaryStructure"
                    defaults={["Range Based", "Fixed"]}
                    value={form.structureType}
                    onChange={(v) => set("structureType", v)}
                    disabled={!canEdit}
                    readOnlyOptions={!canEdit}
                  />
                </div>
                <div>
                  <label className={cls.label}>Tax Regime</label>
                  <CustomSelect
                    listKey="taxRegime"
                    defaults={["New Regime (Section 115BAC)", "Old Regime"]}
                    value={form.taxRegime}
                    onChange={(v) => set("taxRegime", v)}
                    disabled={!canEdit}
                    readOnlyOptions={!canEdit}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {savedAt && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            <span>Salary structure saved.</span>
          </div>
        )}

        {canEdit && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={14} />
              {saving ? "Saving…" : data ? "Update salary structure" : "Save salary structure"}
            </button>
          </div>
        )}
      </form>

      {showBonusModal && (
        <AddBonusModal
          userId={userId}
          onClose={() => setShowBonusModal(false)}
        />
      )}
    </section>
  );
}

// ── Add Bonus modal ────────────────────────────────────────────────
// Keka-style dialog: bonus type (with custom values), amount with INR
// prefix, payment status (Due in future / Paid in past), payout date,
// optional note. Saves to /api/hr/payroll/bonus.
function AddBonusModal({ userId, onClose }: { userId: number; onClose: () => void }) {
  const [bonusType, setBonusType]         = useState("");
  const [amount, setAmount]               = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"due_future" | "paid_past">("due_future");
  const [date, setDate]                   = useState("");
  const [note, setNote]                   = useState("");
  const [attachment, setAttachment]       = useState<File | null>(null);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState("");

  const dateLabel = paymentStatus === "due_future" ? "Payout due on" : "Paid on";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amt = Number(amount);
    if (!bonusType.trim())                   { setError("Pick or create a bonus type.");        return; }
    if (!Number.isFinite(amt) || amt <= 0)   { setError("Enter a positive amount.");            return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))   { setError(`Pick the ${dateLabel.toLowerCase()} date.`); return; }
    // Match the server's 10 MB ceiling so we fail fast without burning
    // an upload round-trip on a too-big file.
    if (attachment && attachment.size > 10 * 1024 * 1024) {
      setError("Attachment must be 10 MB or smaller.");
      return;
    }
    setSaving(true);
    try {
      // Multipart when a file is attached so the bytes can ride along
      // with the rest of the fields; JSON otherwise (cheaper to parse,
      // and still what every legacy caller of this endpoint sends).
      let res: Response;
      if (attachment) {
        const fd = new FormData();
        fd.append("userId", String(userId));
        fd.append("amount", String(amt));
        if (note.trim()) fd.append("reason", note.trim());
        fd.append("effectiveDate", date);
        fd.append("bonusType", bonusType.trim());
        fd.append("paymentStatus", paymentStatus);
        fd.append("attachment", attachment);
        res = await fetch("/api/hr/payroll/bonus", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/hr/payroll/bonus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            amount: amt,
            reason: note.trim() || null,
            effectiveDate: date,
            bonusType: bonusType.trim(),
            paymentStatus,
          }),
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Save failed");
      onClose();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-[15px] font-bold text-slate-800">Add Bonus</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={14} />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-5 px-6 py-5">
          {/* ── Bonus Type ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Bonus Type</label>
            {/* Reuses the global CustomSelect: defaults are common bonus
                categories; HR can "+ Add custom value" for one-offs. */}
            <CustomSelect
              listKey="bonusType"
              defaults={[
                "Performance Incentive",
                "Retention Bonus",
                "Referral Bonus",
                "Diwali Bonus",
                "Advance Salary",
                "Bonus Pay",
                "Arrear",
                "Travel Reimbursement",
                "Reimbursed PF",
                "Business Expense Reimbursement",
                "Joining Bonus",
                "Project Delivery Bonus",
                "Spot Award",
              ]}
              value={bonusType}
              onChange={setBonusType}
              placeholder="Select or create bonus"
            />
          </div>

          {/* ── Amount ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Bonus amount</label>
            <div className="flex">
              <span className="inline-flex h-9 items-center rounded-l-lg border border-r-0 border-slate-200 bg-slate-50 px-3 text-[12px] font-semibold text-slate-500">
                INR
              </span>
              <input
                type="number" min="1" step="any"
                value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                className="h-9 flex-1 rounded-r-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15"
              />
            </div>
          </div>

          {/* ── Payment status ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-2">Payment status</label>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="bonus-payment-status"
                  checked={paymentStatus === "due_future"}
                  onChange={() => setPaymentStatus("due_future")}
                  className="h-4 w-4 text-[#3b82f6] border-slate-300 focus:ring-[#3b82f6]/30"
                />
                Due in future
              </label>
              <label className="inline-flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                <input
                  type="radio"
                  name="bonus-payment-status"
                  checked={paymentStatus === "paid_past"}
                  onChange={() => setPaymentStatus("paid_past")}
                  className="h-4 w-4 text-[#3b82f6] border-slate-300 focus:ring-[#3b82f6]/30"
                />
                Paid in past <span className="text-slate-400">(outside payroll)</span>
              </label>
            </div>
          </div>

          {/* ── Date — label changes with the payment status. Uses the
              shared DatePicker (Day/Month/Year dropdowns) so the styling
              matches the rest of the app instead of falling back to the
              browser's native picker. */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">{dateLabel}</label>
            <div className="max-w-md">
              <DatePicker
                value={date}
                onChange={setDate}
                // Bonuses can be backdated (paid_past) or scheduled
                // ahead (due_future) — give the year dropdown a
                // generous range covering past structures + a few
                // years of forward planning.
                yearStart={new Date().getFullYear() - 5}
                futureYears={5}
              />
            </div>
          </div>

          {/* ── Note ── */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">Note</label>
            <textarea
              rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 placeholder-slate-400 focus:border-[#3b82f6] focus:outline-none focus:ring-2 focus:ring-[#3b82f6]/15 resize-none"
            />
          </div>

          {/* ── Attachment (optional) ── PDF / Word / image, ≤ 10 MB.
              Stored as BYTEA on EmployeeBonus so the file survives
              Docker redeploys (same model as ViolationActionFile). */}
          <div>
            <label className="block text-[12px] font-semibold text-slate-700 mb-1.5">
              Attachment <span className="font-normal text-slate-400">(optional)</span>
            </label>
            {attachment ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2 text-[12.5px] text-slate-700">
                  <Paperclip size={13} className="shrink-0 text-slate-500" />
                  <span className="truncate">{attachment.name}</span>
                  <span className="shrink-0 text-slate-400">
                    ({(attachment.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                  aria-label="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/40 px-3 py-3 text-[12.5px] text-slate-600 hover:border-[#3b82f6] hover:bg-[#3b82f6]/5">
                <Paperclip size={13} className="text-slate-500" />
                <span>Choose file</span>
                <span className="text-slate-400">— PDF, Word, or image (≤ 10 MB)</span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.rtf,.odt,.txt,.md,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3.5">
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={submit as any} disabled={saving}
            className="h-9 px-5 rounded-lg bg-[#3b82f6] text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#2563eb] disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
