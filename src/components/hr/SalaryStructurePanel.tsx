"use client";

// Salary Structure panel rendered on the user-profile page. Mirrors the
// onboarding wizard's "Compensation" step so HR admins can fill in or
// adjust a user's salary after onboarding (or for legacy users who were
// imported before the wizard existed).
//
// Visibility rules are enforced by the parent page: HR admin tier OR the
// profile owner can SEE this panel; only HR admin tier can SAVE.

import { useEffect, useState } from "react";
import useSWR, { mutate } from "swr";
import { fetcher } from "@/lib/swr";
import {
  CheckCircle2, AlertCircle, IndianRupee, Save, Wallet, Info, Lock, Calendar,
} from "lucide-react";
import CustomSelect from "@/components/ui/CustomSelect";

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
    monthlyStipend: isIntern ? String(parseFloat(s.basic || "0") || "") : "",
    bonusIncluded: !!s.bonusIncluded,
    pfEligible: !!s.pfEligible,
    structureType: s.structureType || "Range Based",
    taxRegime: s.taxRegime || "New Regime (Section 115BAC)",
    effectiveFrom: s.effectiveFrom ? s.effectiveFrom.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
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
      ctc:           stipend * 12,
      basic:         stipend,
      hra:           0,
      specialAllowance: 0,
      pfEmployee: 0, pfEmployer: 0,
      esiEmployee: 0, esiEmployer: 0,
      tds: 0, professionalTax: 0,
      effectiveFrom: f.effectiveFrom,
    };
  }
  // Regular employee.
  const annual = parseFloat(f.annualSalary || "0") || 0;
  // Standard 50/50 basic-vs-rest split as a starting point (HR can refine
  // through the dedicated payroll page if they want a finer breakup).
  const basic   = Math.round(annual * 0.5);
  const hra     = Math.round(basic * 0.5);
  const special = Math.max(0, annual - basic - hra);
  return {
    userId,
    salaryType:    "regular",
    payGroup:      f.payGroup || null,
    bonusIncluded: !!f.bonusIncluded,
    taxRegime:     f.taxRegime || null,
    structureType: f.structureType || null,
    pfEligible:    !!f.pfEligible,
    ctc:           annual,
    basic, hra,
    specialAllowance: special,
    pfEmployee: 0, pfEmployer: 0,
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
        </div>
      </div>

      <form onSubmit={onSave} className="space-y-5 px-6 py-5">
        {/* ── Top row: Salary Type + Effective From ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={cls.label}>Salary Type</label>
            <select
              value={form.salaryType}
              onChange={(e) => set("salaryType", e.target.value as FormState["salaryType"])}
              disabled={!canEdit}
              className={cls.field}
            >
              <option>Regular Employee</option>
              <option>Intern</option>
            </select>
          </div>
          <div>
            <label className={cls.label}>Effective From</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => set("effectiveFrom", e.target.value)}
                disabled={!canEdit}
                className={`${cls.field} pl-8`}
              />
            </div>
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
    </section>
  );
}
